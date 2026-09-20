import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Inject,
  HttpException,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import type { RecordingPackService } from '@vision/application';

export const RECORDINGS = Symbol('recordings');
export type RecordingApiOptions = {
  service: RecordingPackService;
  accessKey: string;
  origin: string;
};
const actor = { actorType: 'USER', actorId: 'local-creative-director' } as const;
const id = z.string().uuid();
const digest = (s: string) => createHash('sha256').update(s).digest();

@Controller('api')
export class RecordingController {
  private readonly sessions = new Map<string, { csrf: string; expires: number }>();
  private attempts = 0;
  private window = Date.now();
  constructor(@Inject(RECORDINGS) private readonly options: RecordingApiOptions) {}
  private origin(req: IncomingMessage) {
    if (req.headers.origin !== this.options.origin) throw new HttpException('ORIGIN_REJECTED', 403);
  }
  private session(req: IncomingMessage, write = false) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('__Host-vce='))
      ?.slice('__Host-vce='.length);
    const s = cookie ? this.sessions.get(cookie) : undefined;
    if (!s || s.expires < Date.now()) {
      if (cookie) this.sessions.delete(cookie);
      throw new HttpException('AUTH_REQUIRED', 401);
    }
    if (write) {
      this.origin(req);
      if (req.headers['x-csrf-token'] !== s.csrf) throw new HttpException('CSRF_REJECTED', 403);
    }
    return s;
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof DomainError) throw new HttpException(e.code, 422);
      if (e instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      throw new HttpException('RECORDING_OPERATION_FAILED', 409);
    }
  }
  @Post('session')
  login(
    @Req() req: IncomingMessage,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.origin(req);
    if (Date.now() - this.window > 300000) {
      this.window = Date.now();
      this.attempts = 0;
    }
    if (++this.attempts > 20) throw new HttpException('AUTH_RATE_LIMITED', 429);
    const input = z.object({ accessKey: z.string().min(32).max(256) }).safeParse(body);
    if (
      !input.success ||
      !timingSafeEqual(digest(input.data.accessKey), digest(this.options.accessKey))
    )
      throw new HttpException('AUTH_FAILED', 401);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    this.sessions.clear();
    this.sessions.set(token, { csrf, expires: Date.now() + 8 * 3600000 });
    res.setHeader(
      'Set-Cookie',
      `__Host-vce=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return { csrf };
  }
  @Get('session')
  sessionInfo(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    return { csrf: this.session(req).csrf };
  }
  @Post('logout')
  logout(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.session(req, true);
    this.sessions.clear();
    res.setHeader(
      'Set-Cookie',
      '__Host-vce=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    );
    return { ok: true };
  }
  @Get('recording-packs')
  packs(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.session(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.safe(() => this.options.service.packs());
  }
  @Post('recording-requests/:id/upload')
  upload(@Param('id') requestId: string, @Req() req: IncomingMessage) {
    this.session(req, true);
    return this.safe(async () => {
      id.parse(requestId);
      if (req.headers['content-type'] !== 'application/octet-stream')
        throw new DomainError('BINARY_UPLOAD_REQUIRED');
      // Hard request timeout bounds interrupted/slow uploads. No filenames or URLs are accepted.
      const timer = setTimeout(() => req.destroy(), 120000);
      try {
        return await this.options.service.upload(
          actor,
          requestId,
          req,
          z.string().optional().parse(req.headers['x-content-sha256']),
        );
      } finally {
        clearTimeout(timer);
      }
    });
  }
  @Post('recordings/:id/selection')
  selection(@Param('id') takeId: string, @Body() body: unknown, @Req() req: IncomingMessage) {
    this.session(req, true);
    return this.safe(async () =>
      this.options.service.select(
        actor,
        id.parse(takeId),
        z
          .object({ status: z.enum(['SELECTED', 'REJECTED', 'UPLOADED']) })
          .strict()
          .parse(body).status,
      ),
    );
  }
  @Get('assets/:id/preview')
  async preview(
    @Param('id') assetId: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    this.session(req);
    const result = await this.safe(async () =>
      this.options.service.preview(actor, id.parse(assetId)),
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', result.bytes.byteLength);
    res.end(result.bytes);
  }
}
