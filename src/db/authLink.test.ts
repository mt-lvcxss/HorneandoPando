import { describe, expect, it } from 'vitest';
import { parseAuthLink } from './authLink';

const base = 'http://localhost:5173/auth/confirmado';

describe('parseAuthLink', () => {
  it('reconoce el formato de las plantillas propias (token_hash)', () => {
    expect(parseAuthLink(new URL(`${base}?token_hash=abc123&type=email`))).toEqual({
      kind: 'token_hash',
      tokenHash: 'abc123',
      type: 'email',
    });
  });

  it('reconoce el formato de las plantillas por defecto de Supabase (sesión en el fragmento)', () => {
    expect(
      parseAuthLink(new URL(`${base}#access_token=at&expires_in=3600&refresh_token=rt&token_type=bearer&type=signup`)),
    ).toEqual({ kind: 'session', accessToken: 'at', refreshToken: 'rt', type: 'signup' });
  });

  it('reconoce el flujo PKCE', () => {
    expect(parseAuthLink(new URL(`${base}?code=xyz`))).toEqual({ kind: 'pkce', code: 'xyz' });
  });

  it('informa enlaces vencidos o usados', () => {
    expect(
      parseAuthLink(
        new URL(`${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`),
      ),
    ).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' });
  });

  it('el error tiene prioridad sobre cualquier token', () => {
    expect(parseAuthLink(new URL(`${base}?token_hash=abc&error_code=otp_expired`)).kind).toBe('error');
  });

  it('detecta enlaces incompletos', () => {
    expect(parseAuthLink(new URL(base))).toEqual({ kind: 'missing' });
    expect(parseAuthLink(new URL(`${base}#access_token=solo-uno`))).toEqual({ kind: 'missing' });
  });
});
