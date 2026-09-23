import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  Get,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

export const LOCAL_SESSION = Symbol('local-session');

export type LocalSessionOptions = {
  accessKey: string;
  origin: string;
  now?: () => number;
};

type SessionState = {
  csrf: string;
  expires: number;
};

const digest = (value: string) => createHash('sha256').update(value).digest();
const SESSION_TTL_SECONDS = 28_800;
const LOGIN_WINDOW_MS = 300_000;
const MAX_LOGIN_FAILURES = 20;
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const loginInput = z.object({ accessKey: z.string().min(32).max(256) }).strict();

// Body-parser runs before controllers. Its JSON syntax errors can echo credential fragments.
@Catch()
export class LocalAuthExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<IncomingMessage>();
    const path = req.url?.split('?')[0]?.replace(/\/$/, '').toLowerCase();
    if (
      exception instanceof BadRequestException &&
      req.method === 'POST' &&
      (path === '/api/session' || path === '/api/logout')
    ) {
      host.switchToHttp().getResponse<ServerResponse>().setHeader('Cache-Control', 'no-store');
      return super.catch(new HttpException('AUTH_INVALID_INPUT', 400), host);
    }
    return super.catch(exception, host);
  }
}

export class LocalSessionService {
  private readonly sessions = new Map<string, SessionState>();
  private failures = 0;
  private windowStartedAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: LocalSessionOptions) {
    const origin = URL.parse(options.origin);
    if (
      !loginInput.safeParse({ accessKey: options.accessKey }).success ||
      !origin ||
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.origin !== options.origin
    ) {
      throw new Error('LOCAL_AUTH_NOT_CONFIGURED');
    }
    this.now = options.now ?? Date.now;
  }

  private requireOrigin(req: IncomingMessage) {
    if (req.headers.origin !== this.options.origin) throw new HttpException('ORIGIN_REJECTED', 403);
  }

  require(req: IncomingMessage, write = false) {
    const cookies = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.split('=', 1)[0] === '__Host-vce');
    const cookie =
      cookies?.length === 1 && /^__Host-vce=[a-f0-9]{64}$/.test(cookies[0]!)
        ? cookies[0]!.slice('__Host-vce='.length)
        : undefined;

    const session = cookie ? this.sessions.get(cookie) : undefined;
    if (!session || session.expires <= this.now()) {
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
    res.setHeader('Cache-Control', 'no-store');
    this.requireOrigin(req);

    const now = this.now();
    if (now - this.windowStartedAt >= LOGIN_WINDOW_MS) {
      this.failures = 0;
    }

    // One bounded, process-local bucket: forwarded addresses cannot create new buckets.
    if (this.failures >= MAX_LOGIN_FAILURES) throw new HttpException('AUTH_RATE_LIMITED', 429);

    const input = loginInput.safeParse(body);
    if (
      !input.success ||
      !timingSafeEqual(digest(input.data.accessKey), digest(this.options.accessKey))
    ) {
      if (this.failures === 0) this.windowStartedAt = now;
      this.failures += 1;
      throw new HttpException('AUTH_FAILED', 401);
    }

    this.failures = 0;
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');

    this.sessions.clear();
    this.sessions.set(token, {
      csrf,
      expires: now + SESSION_TTL_SECONDS * 1_000,
    });

    res.setHeader(
      'Set-Cookie',
      `__Host-vce=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_SECONDS}`,
    );

    return { csrf };
  }

  logout(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    this.require(req, true);
    this.sessions.clear();
    res.setHeader('Set-Cookie', `__Host-vce=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);
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
