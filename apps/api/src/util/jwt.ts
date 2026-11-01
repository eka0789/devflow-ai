/** Minimal HS256 JWT implementation (no external dependency). */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 60 * 60 * 12; // 12h

interface Header {
  alg: 'HS256';
  typ: 'JWT';
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signJwt(
  claims: { sub: string; email: string },
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { ...claims, iat, exp: iat + ttlSeconds };
  const header: Header = { alg: 'HS256', typ: 'JWT' };
  const head = Buffer.from(JSON.stringify(header)).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${head}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const head = parts[0]!;
  const body = parts[1]!;
  const mac = parts[2]!;

  const expected = Buffer.from(sign(`${head}.${body}`, secret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let header: Header;
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as Header;
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof payload.sub !== 'string') return null;
  return payload;
}
