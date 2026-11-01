import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../src/util/crypto.js';
import { signJwt, verifyJwt } from '../src/util/jwt.js';
import { unifiedDiff } from '../src/util/diff.js';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const hash = hashPassword('s3cret-password');
    expect(verifyPassword('s3cret-password', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword('s3cret-password', 'garbage')).toBe(false);
  });

  it('produces unique salts per hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('secret encryption at rest', () => {
  it('roundtrips plaintext', () => {
    const enc = encryptSecret('ghp_example_token_123', 'app-secret');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc, 'app-secret')).toBe('ghp_example_token_123');
  });

  it('fails with the wrong key or tampered payload', () => {
    const enc = encryptSecret('data', 'key-a');
    expect(decryptSecret(enc, 'key-b')).toBeNull();
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(decryptSecret(tampered, 'key-a')).toBeNull();
  });
});

describe('jwt', () => {
  it('signs and verifies', () => {
    const token = signJwt({ sub: 'u1', email: 'u1@x.io' }, 'secret');
    const payload = verifyJwt(token, 'secret');
    expect(payload?.sub).toBe('u1');
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0);
  });

  it('rejects tampered tokens, wrong keys and expired tokens', () => {
    const token = signJwt({ sub: 'u1', email: 'u1@x.io' }, 'secret');
    expect(verifyJwt(token + 'x', 'secret')).toBeNull();
    expect(verifyJwt(token, 'other')).toBeNull();

    const expired = signJwt({ sub: 'u1', email: 'u1@x.io' }, 'secret', -10);
    expect(verifyJwt(expired, 'secret')).toBeNull();
    expect(verifyJwt('not.a.jwt', 'secret')).toBeNull();
  });
});

describe('unified diff', () => {
  it('produces an add diff for new files', () => {
    const diff = unifiedDiff('src/new.ts', '', 'const a = 1;\nconst b = 2;\n');
    expect(diff).toContain('--- a/src/new.ts');
    expect(diff).toContain('+++ b/src/new.ts');
    expect(diff).toContain('+const a = 1;');
  });

  it('marks changed lines with - and +', () => {
    const diff = unifiedDiff('f.txt', 'old line\nshared\n', 'new line\nshared\n');
    expect(diff).toContain('-old line');
    expect(diff).toContain('+new line');
    expect(diff).toContain(' shared');
  });

  it('returns empty for identical content', () => {
    expect(unifiedDiff('f.txt', 'same\n', 'same\n')).toBe('');
  });

  it('renders deletion as removal', () => {
    const diff = unifiedDiff('f.txt', 'gone\n', '');
    expect(diff).toContain('-gone');
  });
});
