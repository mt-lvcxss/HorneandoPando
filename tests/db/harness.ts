import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');
const COMPAT_SQL = join(ROOT, 'database/compat/postgres-sin-supabase.sql');

/**
 * Motor de pruebas:
 *   - por defecto PGlite (PostgreSQL en WebAssembly, sin instalar nada);
 *   - si existe TEST_DATABASE_URL, un servidor PostgreSQL real (15+). Cada prueba usa una base
 *     de datos nueva y temporal. El usuario debe poder crear bases de datos y roles.
 */
const SERVER_URL = process.env.TEST_DATABASE_URL;
export const TEST_ENGINE = SERVER_URL ? 'postgresql' : 'pglite';

export type TestUser = { id: string; email: string; sessionId: string; deviceToken: string };

/** Interfaz mínima común a PGlite y node-postgres. */
export interface SqlDriver {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

async function applySchema(driver: SqlDriver) {
  await driver.exec(readFileSync(COMPAT_SQL, 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await driver.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Falló la migración ${file}: ${(error as Error).message}`);
    }
  }
}

/** Base de datos nueva con la capa de compatibilidad y todas las migraciones del repositorio. */
export async function createTestDb(): Promise<TestDb> {
  if (!SERVER_URL) {
    const lite = new PGlite();
    await applySchema(lite);
    return new TestDb(lite, () => lite.close());
  }

  const dbName = `hp_test_${randomUUID().replace(/-/g, '')}`;
  const admin = new pg.Client({ connectionString: SERVER_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(SERVER_URL);
  url.pathname = `/${dbName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const driver: SqlDriver = {
    query: async (sql, params) => client.query(sql, params as unknown[]) as never,
    exec: (sql) => client.query(sql),
  };
  await applySchema(driver);

  return new TestDb(driver, async () => {
    await client.end();
    const cleanup = new pg.Client({ connectionString: SERVER_URL });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName} with (force)`);
    await cleanup.end();
  });
}

export function newDeviceToken() {
  return randomBytes(32).toString('base64url');
}

export class TestDb {
  constructor(
    readonly pg: SqlDriver,
    readonly close: () => Promise<void>,
  ) {}

  /** Crea un usuario de Auth (confirmado por defecto). */
  async createUser(email: string, opts: { confirmed?: boolean } = {}): Promise<TestUser> {
    const id = randomUUID();
    await this.asSuperuser(() =>
      this.pg.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [
        id,
        email,
        opts.confirmed === false ? null : new Date().toISOString(),
      ]),
    );
    return { id, email, sessionId: randomUUID(), deviceToken: newDeviceToken() };
  }

  /** Ejecuta como el rol `authenticated` con los claims del JWT del usuario (como PostgREST). */
  async asUser<T>(user: Pick<TestUser, 'id' | 'sessionId'>, fn: () => Promise<T>): Promise<T> {
    const claims = JSON.stringify({ sub: user.id, session_id: user.sessionId, role: 'authenticated' });
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
    await this.pg.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await this.pg.exec('reset role');
      await this.pg.query(`select set_config('request.jwt.claims', '', false)`);
    }
  }

  async asAnon<T>(fn: () => Promise<T>): Promise<T> {
    await this.pg.exec('set role anon');
    try {
      return await fn();
    } finally {
      await this.pg.exec('reset role');
    }
  }

  async asService<T>(fn: () => Promise<T>): Promise<T> {
    await this.pg.exec('set role service_role');
    try {
      return await fn();
    } finally {
      await this.pg.exec('reset role');
    }
  }

  async asSuperuser<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Atajo: SELECT que devuelve filas. */
  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const rows = await this.rows<T>(sql, params);
    if (rows.length !== 1) throw new Error(`Se esperaba 1 fila y llegaron ${rows.length}`);
    return rows[0];
  }

  /** Inicia sesión completa (begin_session + verificación por código) y devuelve el usuario listo. */
  async signInVerified(user: TestUser): Promise<TestUser> {
    await this.asUser(user, () => this.rpc('begin_session', [user.deviceToken, 'Prueba']));
    const issued = await this.asService(() =>
      this.one<{ r: { status: string; code: string } }>('select public.issue_device_challenge($1, $2) as r', [
        user.id,
        user.sessionId,
      ]),
    );
    if (issued.r.status !== 'issued') throw new Error(`No se emitió código: ${issued.r.status}`);
    const verified = await this.asUser(user, () => this.rpc('verify_device_code', [user.deviceToken, issued.r.code]));
    if ((verified as { status: string }).status !== 'verified') throw new Error('No se verificó la sesión');
    return user;
  }

  /** Llama a una función pública y devuelve su resultado. */
  async rpc(name: string, args: unknown[] = []) {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const res = await this.pg.query<{ r: unknown }>(`select public.${name}(${placeholders}) as r`, args);
    return res.rows[0]?.r;
  }
}

/** Extrae el código de error de negocio (message) de un error de PostgreSQL. */
export async function expectDbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Se esperaba un error de base de datos y la operación tuvo éxito');
}
