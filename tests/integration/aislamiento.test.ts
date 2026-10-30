/**
 * Prueba de aislamiento contra el proyecto de Supabase de PRUEBAS (nunca producción).
 *
 * Se ejecuta solo si existe .env.test.local con:
 *   TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY, TEST_SUPABASE_SECRET_KEY
 * La clave secreta se usa únicamente aquí para crear y borrar usuarios de prueba.
 *
 *   npm run test:integration
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';

const env = loadEnv('test', process.cwd(), 'TEST_');
const url = env.TEST_SUPABASE_URL;
const publishableKey = env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.TEST_SUPABASE_SECRET_KEY;
const configured = Boolean(url && publishableKey && secretKey);

type Owner = { client: SupabaseClient; userId: string; accountId: string };

const deviceToken = () => randomBytes(32).toString('base64url');

describe.skipIf(!configured)('aislamiento entre cuentas en Supabase real', () => {
  const admin = configured
    ? createClient(url!, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as unknown as SupabaseClient);
  const createdUsers: string[] = [];
  let a: Owner;
  let b: Owner;

  async function createVerifiedOwner(label: string): Promise<Owner> {
    const email = `prueba-${label}-${Date.now()}@example.com`;
    const password = `Clave${randomBytes(8).toString('hex')}1`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw createError;
    createdUsers.push(created.user.id);

    const client = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const token = deviceToken();
    const begin = await client.rpc('begin_session', { p_device_token: token, p_device_label: 'integración' });
    expect(begin.data).toMatchObject({ status: 'verification_required' });

    const sessionId = JSON.parse(Buffer.from(signIn.session!.access_token.split('.')[1]!, 'base64url').toString()).session_id;
    const issued = await admin.rpc('issue_device_challenge', { p_user_id: created.user.id, p_session_id: sessionId });
    const verify = await client.rpc('verify_device_code', { p_device_token: token, p_code: issued.data.code });
    expect(verify.data).toEqual({ status: 'verified' });

    const { data: account } = await client.from('accounts').select('id').single();
    return { client, userId: created.user.id, accountId: account!.id };
  }

  beforeAll(async () => {
    a = await createVerifiedOwner('a');
    b = await createVerifiedOwner('b');
  }, 60_000);

  afterAll(async () => {
    // Los usuarios de prueba conservan su cuenta (on delete restrict); se marcan para limpieza manual.
    for (const id of createdUsers) await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  });

  it('cada cuenta solo ve su propio registro', async () => {
    const { data: fromA } = await a.client.from('accounts').select('id');
    expect(fromA).toEqual([{ id: a.accountId }]);
    const { data: crossRead } = await a.client.from('accounts').select('id').eq('id', b.accountId);
    expect(crossRead).toEqual([]);
  });

  it('no se puede escribir directamente en accounts', async () => {
    const { error } = await a.client.from('accounts').update({ business_name: 'hack' }).eq('id', b.accountId);
    expect(error).not.toBeNull();
  });

  it('un usuario autenticado no puede emitirse códigos de verificación', async () => {
    const { error } = await a.client.rpc('issue_device_challenge', { p_user_id: a.userId, p_session_id: a.userId });
    expect(error).not.toBeNull();
  });

  it('las tablas internas no están expuestas por la API', async () => {
    const { error } = await a.client.schema('private' as 'public').from('audit_log').select('*');
    expect(error).not.toBeNull();
  });

  it('el acceso anónimo no ve cuentas', async () => {
    const anon = createClient(url!, publishableKey!, { auth: { persistSession: false } });
    const { data } = await anon.from('accounts').select('id');
    expect(data ?? []).toEqual([]);
  });
});
