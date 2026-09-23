import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { LocalSessionService } from '../../apps/api/src/auth.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const request = (headers: IncomingMessage['headers'] = {}) => ({ headers }) as IncomingMessage;
const response = () => ({ setHeader: vi.fn() }) as unknown as ServerResponse;

function fixture() {
  let now = 0;
  const service = new LocalSessionService({ accessKey, origin, now: () => now });
  const login = (headers: IncomingMessage['headers'] = {}) => {
    const res = response();
    const body = service.login(request({ origin, ...headers }), res, { accessKey });
    const setCookie = vi
      .mocked(res.setHeader)
      .mock.calls.find(([key]) => key === 'Set-Cookie')![1] as string;
    return { cookie: setCookie.split(';')[0]!, setCookie, csrf: body.csrf };
  };
  return {
    service,
    login,
    setTime: (value: number) => {
      now = value;
    },
  };
}

function rejects(work: () => unknown, status: number, code: string) {
  try {
    work();
    expect.fail('Expected auth rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { getStatus(): number }).getStatus()).toBe(status);
    expect((error as { getResponse(): string }).getResponse()).toBe(code);
  }
}

describe('LocalSessionService security boundary', () => {
  it('fails closed on invalid server auth configuration without echoing it', () => {
    for (const options of [
      { accessKey: 'short-sensitive-value', origin },
      { accessKey, origin: 'null' },
      { accessKey, origin: `${origin}/path` },
      { accessKey, origin: 'https://operator:credential@example.test' },
    ]) {
      expect(() => new LocalSessionService(options)).toThrow('LOCAL_AUTH_NOT_CONFIGURED');
    }
  });

  it('rotates opaque session and CSRF identities and preserves the exact host-only cookie policy', () => {
    const { service, login } = fixture();
    const first = login({ cookie: `__Host-vce=${'a'.repeat(64)}` });
    const second = login({ cookie: first.cookie });
    expect(first.cookie).toMatch(/^__Host-vce=[a-f0-9]{64}$/);
    expect(first.cookie).not.toBe(`__Host-vce=${'a'.repeat(64)}`);
    expect(second.cookie).not.toBe(first.cookie);
    expect(second.csrf).not.toBe(first.csrf);
    expect(second.setCookie.split('; ').slice(1)).toEqual([
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Max-Age=28800',
    ]);
    expect(second.setCookie).not.toContain(accessKey);
    rejects(() => service.require(request({ cookie: first.cookie })), 401, 'AUTH_REQUIRED');
    expect(service.require(request({ cookie: second.cookie })).csrf).toBe(second.csrf);
  });

  it('rejects malformed or ambiguous cookies rather than choosing a client-supplied ordering', () => {
    const { service, login } = fixture();
    const { cookie } = login();
    for (const value of [
      '',
      '__Host-vce=invalid',
      `${cookie}; ${cookie}`,
      `${cookie}; __Host-vce`,
      `__Host-vce=bad; ${cookie}`,
    ]) {
      rejects(() => service.require(request({ cookie: value })), 401, 'AUTH_REQUIRED');
    }
    expect(() => service.require(request({ cookie: `other=value; ${cookie}` }))).not.toThrow();
  });

  it('expires on the server at exactly eight hours, without sliding renewal', () => {
    const { service, login, setTime } = fixture();
    const session = login();
    const req = request({ cookie: session.cookie, origin, 'x-csrf-token': session.csrf });
    setTime(28_800_000 - 1);
    expect(() => service.require(req, true)).not.toThrow();
    setTime(28_800_000);
    rejects(() => service.require(req), 401, 'AUTH_REQUIRED');
    rejects(() => service.require(req, true), 401, 'AUTH_REQUIRED');
  });

  it('binds CSRF to the current session and requires an exact Origin independently', () => {
    const { service, login } = fixture();
    const previous = login();
    const current = login();
    for (const csrf of [undefined, 'wrong', previous.csrf]) {
      rejects(
        () =>
          service.require(request({ cookie: current.cookie, origin, 'x-csrf-token': csrf }), true),
        403,
        'CSRF_REJECTED',
      );
    }
    for (const badOrigin of [
      undefined,
      'null',
      'not a URL',
      'https://external.example',
      `${origin}.evil.test`,
      `${origin}/`,
    ]) {
      const headers = {
        cookie: current.cookie,
        origin: badOrigin,
        'x-csrf-token': current.csrf,
        referer: `${origin}/learning`,
      };
      rejects(() => service.require(request(headers), true), 403, 'ORIGIN_REJECTED');
      rejects(
        () => service.login(request(headers), response(), { accessKey }),
        403,
        'ORIGIN_REJECTED',
      );
    }
    expect(() =>
      service.require(
        request({ cookie: current.cookie, origin, 'x-csrf-token': current.csrf }),
        true,
      ),
    ).not.toThrow();
  });

  it('requires CSRF on logout, revokes server state and deletes the same cookie scope', () => {
    const { service, login } = fixture();
    const session = login();
    const res = response();
    rejects(
      () => service.logout(request({ cookie: session.cookie, origin }), res),
      403,
      'CSRF_REJECTED',
    );
    const req = request({ cookie: session.cookie, origin, 'x-csrf-token': session.csrf });
    expect(service.logout(req, res)).toEqual({ ok: true });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      '__Host-vce=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    );
    rejects(() => service.require(req), 401, 'AUTH_REQUIRED');
    rejects(() => service.require(req, true), 401, 'AUTH_REQUIRED');
  });

  it('rejects malformed credentials with generic errors and without setting cookies', () => {
    const { service } = fixture();
    for (const body of [
      null,
      [],
      {},
      { accessKey: 42 },
      { accessKey: 'short' },
      { accessKey: 'x'.repeat(257) },
      { accessKey, extra: true },
      { accessKey: 'wrong'.repeat(10) },
    ]) {
      const res = response();
      rejects(() => service.login(request({ origin }), res, body), 401, 'AUTH_FAILED');
      expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    }
  });

  it('bounds failures globally, blocks even a correct key at the limit, and recovers at the exact deadline', () => {
    const { service, login, setTime } = fixture();
    const fail = (attempt: number) =>
      service.login(request({ origin, 'x-forwarded-for': `192.0.2.${attempt}` }), response(), {
        accessKey: 'wrong'.repeat(10),
      });
    for (let i = 0; i < 20; i++) rejects(() => fail(i), 401, 'AUTH_FAILED');
    rejects(() => fail(21), 429, 'AUTH_RATE_LIMITED');
    rejects(() => login(), 429, 'AUTH_RATE_LIMITED');
    setTime(299_999);
    rejects(() => login(), 429, 'AUTH_RATE_LIMITED');
    setTime(300_000);
    expect(() => login()).not.toThrow();
    // Successful login resets prior failures and does not consume the failure budget.
    for (let i = 0; i < 25; i++) {
      rejects(() => fail(i), 401, 'AUTH_FAILED');
      expect(() => login()).not.toThrow();
    }
  });
});
