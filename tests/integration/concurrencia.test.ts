/**
 * Concurrencia de inventario contra el proyecto de Supabase de PRUEBAS (resuelve L-4).
 * PGlite tiene una sola conexión; aquí dos sesiones reales compiten por el mismo envase.
 *
 *   npm run test:integration
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';

const env = loadEnv('test', process.cwd(), 'TEST_');
const url = env.TEST_SUPABASE_URL;
const publishableKey = env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.TEST_SUPABASE_SECRET_KEY;
const configured = Boolean(url && publishableKey && secretKey);

const options = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!configured)('concurrencia de inventario en Supabase real', () => {
  const admin = configured ? createClient(url!, secretKey!, options) : (null as unknown as SupabaseClient);
  const createdUsers: string[] = [];
  let deviceA: SupabaseClient;
  let deviceB: SupabaseClient;
  let containerId: string;
  let ingredientId: string;

  /** Inicia y verifica una sesión del mismo usuario en un "dispositivo" nuevo. */
  async function verifiedDevice(userId: string, email: string, password: string) {
    const client = createClient(url!, publishableKey!, options);
    const { data: signIn, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const token = randomBytes(32).toString('base64url');
    await client.rpc('begin_session', { p_device_token: token, p_device_label: 'concurrencia' });
    const sessionId = JSON.parse(Buffer.from(signIn.session!.access_token.split('.')[1]!, 'base64url').toString()).session_id;
    const issued = await admin.rpc('issue_device_challenge', { p_user_id: userId, p_session_id: sessionId });
    const verify = await client.rpc('verify_device_code', { p_device_token: token, p_code: issued.data.code });
    expect(verify.data).toEqual({ status: 'verified' });
    return client;
  }

  async function call<T = Record<string, unknown>>(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    return data as T;
  }

  beforeAll(async () => {
    const email = `prueba-concurrencia-${Date.now()}@example.com`;
    const password = `Clave${randomBytes(8).toString('hex')}1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    createdUsers.push(created.user.id);

    deviceA = await verifiedDevice(created.user.id, email, password);
    deviceB = await verifiedDevice(created.user.id, email, password);

    const ingredient = await call<{ id: string }>(deviceA, 'create_ingredient', {
      p_idempotency_key: randomUUID(), p_name: 'Harina', p_dimension: 'mass',
    });
    ingredientId = ingredient.id;
    const brand = await call<{ id: string }>(deviceA, 'create_brand', {
      p_idempotency_key: randomUUID(), p_ingredient_id: ingredient.id, p_name: 'Prueba',
    });
    const presentation = await call<{ id: string }>(deviceA, 'create_presentation', {
      p_idempotency_key: randomUUID(), p_brand_id: brand.id, p_quantity: 1, p_unit: 'kg',
    });
    await call(deviceA, 'confirm_purchase', {
      p_idempotency_key: randomUUID(),
      p_purchased_on: new Date().toISOString().slice(0, 10),
      p_lines: [{ presentation_id: presentation.id, container_count: 1, paid_total_clp: 1000 }],
    });
    const { data: containers } = await deviceA.from('containers').select('id');
    containerId = containers![0]!.id;
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUsers) await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  });

  it('dos dispositivos que descuentan a la vez nunca consumen más de lo disponible', async () => {
    // 10 mermas de 150 g sobre 1.000 g, repartidas entre los dos dispositivos y lanzadas a la vez.
    const attempts = Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? deviceA : deviceB).rpc('register_container_movement', {
        p_idempotency_key: randomUUID(),
        p_container_id: containerId,
        p_kind: 'waste',
        p_quantity: 150,
      }),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    expect(ok).toHaveLength(6);
    expect(failed.every((r) => r.error!.message === 'INSUFFICIENT_STOCK')).toBe(true);

    const { data: container } = await deviceB.from('containers').select('balance').eq('id', containerId).single();
    expect(Number(container!.balance)).toBe(100);
    const { data: movements } = await deviceB.from('inventory_movements').select('quantity').eq('container_id', containerId);
    expect(movements!.reduce((sum, m) => sum + Number(m.quantity), 0)).toBe(100);
  }, 60_000);

  it('el mismo envío desde dos dispositivos a la vez se registra una sola vez', async () => {
    const key = randomUUID();
    const args = { p_idempotency_key: key, p_container_id: containerId, p_kind: 'waste', p_quantity: 10 };
    const [r1, r2] = await Promise.all([deviceA.rpc('register_container_movement', args), deviceB.rpc('register_container_movement', args)]);

    // Uno registra; el otro recibe la misma respuesta o un aviso de que aún se está procesando.
    const responses = [r1, r2].filter((r) => !r.error).map((r) => (r.data as { id: string }).id);
    expect(new Set(responses).size).toBe(1);
    for (const r of [r1, r2].filter((x) => x.error)) expect(r.error!.message).toBe('IDEMPOTENCY_IN_PROGRESS');

    const { data: stock } = await deviceA.from('ingredient_stock').select('available').eq('ingredient_id', ingredientId).single();
    expect(Number(stock!.available)).toBe(90);
  }, 60_000);
});
