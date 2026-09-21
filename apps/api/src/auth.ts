import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, HttpException, Inject, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

export const LOCAL_SESSION = Symbol('local-session');

export type LocalSessionOptions = {
  accessKey: string;
  origin: string;
};

type SessionState = {
  csrf: string;
  expires: number;
};

const digest = (value: string) => createHash('sha256').update(value).digest();

export class LocalSessionService {
  private readonly sessions = new Map<string, SessionState>();
  private attempts = 0;
  private windowStartedAt = Date.now();

  constructor(private readonly options: LocalSessionOptions) {}

  private requireOrigin(req: IncomingMessage) {
    if (req.headers.origin !== this.options.origin) throw new HttpException('ORIGIN_REJECTED', 403);
  }

  require(req: IncomingMessage, write = false) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('__Host-vce='))
      ?.slice('__Host-vce='.length);

    const session = cookie ? this.sessions.get(cookie) : undefined;
    if (!session || session.expires < Date.now()) {
      if (cookie) this.sessions.delete(cookie);
      throw new HttpException('AUTH_REQUIRED', 401);
    }

    if (write) {
      this.requireOrigin(req);
      if (req.headers['x-csrf-token'] !== session.csrf)
        throw new HttpException('CSRF_REJECTED', 403);
    }

    return session;
  }

  login(req: IncomingMessage, res: ServerResponse, body: unknown) {
    this.requireOrigin(req);

    if (Date.now() - this.windowStartedAt > 300_000) {
      this.windowStartedAt = Date.now();
      this.attempts = 0;
    }

    if (++this.attempts > 20) throw new HttpException('AUTH_RATE_LIMITED', 429);

    const input = z.object({ accessKey: z.string().min(32).max(256) }).safeParse(body);
    if (
      !input.success ||
      !timingSafeEqual(digest(input.data.accessKey), digest(this.options.accessKey))
    ) {
      throw new HttpException('AUTH_FAILED', 401);
    }

    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');

    this.sessions.clear();
    this.sessions.set(token, {
      csrf,
      expires: Date.now() + 8 * 3_600_000,
    });

    res.setHeader(
      'Set-Cookie',
      `__Host-vce=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
    );
    res.setHeader('Cache-Control', 'no-store');

    return { csrf };
  }

  logout(req: IncomingMessage, res: ServerResponse) {
    this.require(req, true);
    this.sessions.clear();
    res.setHeader(
      'Set-Cookie',
      '__Host-vce=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    );
    res.setHeader('Cache-Control', 'no-store');
    return { ok: true };
  }
}

@Controller('api')
export class LocalSessionController {
  constructor(@Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService) {}

  @Post('session')
  login(
    @Req() req: IncomingMessage,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    return this.sessions.login(req, res, body);
  }

  @Get('session')
  info(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    return { csrf: this.sessions.require(req).csrf };
  }

  @Post('logout')
  logout(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    return this.sessions.logout(req, res);
  }
}
