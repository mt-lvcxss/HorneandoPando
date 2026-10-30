import { describe, expect, it } from 'vitest';
import { readConfig } from './env';

const fakeJwt = (payload: object) => `xx.${btoa(JSON.stringify(payload))}.yy`;

describe('readConfig', () => {
  it('acepta una configuración válida', () => {
    const r = readConfig({
      VITE_SUPABASE_URL: 'https://abcxyz.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123',
      VITE_APP_URL: 'http://localhost:5173/',
    });
    expect(r).toEqual({
      ok: true,
      config: { supabaseUrl: 'https://abcxyz.supabase.co', supabaseKey: 'sb_publishable_123', appUrl: 'http://localhost:5173' },
    });
  });

  it('informa los valores faltantes', () => {
    const r = readConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(2);
  });

  it('rechaza claves secretas en el frontend', () => {
    for (const key of ['sb_secret_abc', fakeJwt({ role: 'service_role' })]) {
      const r = readConfig({ VITE_SUPABASE_URL: 'https://abcxyz.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems[0]).toMatch(/SECRETA/);
    }
  });

  it('acepta la clave anon heredada', () => {
    const r = readConfig({
      VITE_SUPABASE_URL: 'https://abcxyz.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: fakeJwt({ role: 'anon' }),
    });
    expect(r.ok).toBe(true);
  });
});
