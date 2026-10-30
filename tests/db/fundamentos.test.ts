import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, expectDbError, newDeviceToken, type TestDb, type TestUser } from './harness';

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

const myAccounts = (user: TestUser) => db.asUser(user, () => db.rows('select id, owner_user_id from public.accounts'));

describe('acceso anónimo', () => {
  it('no puede leer cuentas ni llamar a las RPC', async () => {
    const user = await db.signInVerified(await db.createUser('a@test.cl'));
    expect(user).toBeTruthy();

    expect(await expectDbError(db.asAnon(() => db.rows('select * from public.accounts')))).toMatch(/permission denied/);
    expect(await expectDbError(db.asAnon(() => db.rpc('begin_session', [newDeviceToken(), null])))).toMatch(
      /permission denied/,
    );
    expect(
      await expectDbError(db.asAnon(() => db.rpc('update_business_profile', ['X', null, null, 'America/Santiago', false]))),
    ).toMatch(/permission denied/);
  });
});

describe('inicio de sesión y verificación por dispositivo', () => {
  it('crea la cuenta pero bloquea los datos hasta verificar el dispositivo', async () => {
    const user = await db.createUser('nuevo@test.cl');
    const result = await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, 'Chrome']));
    expect(result).toEqual({ status: 'verification_required', kind: 'owner' });

    // La cuenta existe, pero RLS no la muestra con una sesión sin verificar.
    expect(await db.rows('select id from public.accounts where owner_user_id = $1', [user.id])).toHaveLength(1);
    expect(await myAccounts(user)).toHaveLength(0);

    const err = await expectDbError(
      db.asUser(user, () => db.rpc('update_business_profile', ['Panadería', null, null, 'America/Santiago', false])),
    );
    expect(err).toBe('SESSION_NOT_VALID');
  });

  it('rechaza correos sin confirmar', async () => {
    const user = await db.createUser('sinconfirmar@test.cl', { confirmed: false });
    expect(await expectDbError(db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null])))).toBe(
      'EMAIL_NOT_CONFIRMED',
    );
  });

  it('rechaza tokens de dispositivo con formato inválido', async () => {
    const user = await db.createUser('token@test.cl');
    expect(await expectDbError(db.asUser(user, () => db.rpc('begin_session', ['corto', null])))).toBe(
      'INVALID_DEVICE_TOKEN',
    );
  });

  it('cuenta los intentos fallidos y bloquea el código tras 5 errores', async () => {
    const user = await db.createUser('intentos@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    const issued = (await db.asService(() =>
      db.rpc('issue_device_challenge', [user.id, user.sessionId]),
    )) as { status: string; code: string };
    expect(issued.status).toBe('issued');
    expect(issued.code).toMatch(/^\d{6}$/);

    const wrong = issued.code === '000000' ? '111111' : '000000';
    for (let remaining = 4; remaining >= 1; remaining--) {
      const r = await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, wrong]));
      expect(r).toEqual({ status: 'invalid_code', remaining_attempts: remaining });
    }
    expect(await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, wrong]))).toEqual({
      status: 'too_many_attempts',
      remaining_attempts: 0,
    });
    // Ni siquiera el código correcto sirve después del bloqueo.
    expect(await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, issued.code]))).toEqual({
      status: 'no_active_code',
    });
    expect(await myAccounts(user)).toHaveLength(0);
  });

  it('el código es de un solo uso y solo vale en el navegador que inició la sesión', async () => {
    const user = await db.createUser('unico@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    const issued = (await db.asService(() => db.rpc('issue_device_challenge', [user.id, user.sessionId]))) as {
      code: string;
    };

    expect(
      await expectDbError(db.asUser(user, () => db.rpc('verify_device_code', [newDeviceToken(), issued.code]))),
    ).toBe('DEVICE_MISMATCH');

    expect(await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, issued.code]))).toEqual({
      status: 'verified',
    });
    expect(await myAccounts(user)).toHaveLength(1);

    const challenges = await db.rows<{ consumed_reason: string }>(
      'select consumed_reason from private.device_challenges where user_id = $1',
      [user.id],
    );
    expect(challenges).toEqual([{ consumed_reason: 'verified' }]);
    // Solo se guarda el hash, nunca el código.
    const stored = await db.rows<{ code_hash: string }>('select code_hash from private.device_challenges');
    expect(stored[0].code_hash).not.toContain(issued.code);
  });

  it('un código nuevo invalida el anterior', async () => {
    const user = await db.createUser('reemplazo@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    const first = (await db.asService(() => db.rpc('issue_device_challenge', [user.id, user.sessionId]))) as {
      code: string;
    };
    const second = (await db.asService(() => db.rpc('issue_device_challenge', [user.id, user.sessionId]))) as {
      code: string;
    };
    if (first.code !== second.code) {
      expect(
        await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, first.code])),
      ).toMatchObject({ status: 'invalid_code' });
    }
    expect(await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, second.code]))).toEqual({
      status: 'verified',
    });
  });

  it('sin session_id usa la sesión pendiente más reciente del usuario', async () => {
    const user = await db.createUser('pendiente@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    const issued = (await db.asService(() => db.rpc('issue_device_challenge', [user.id, null]))) as {
      status: string;
      code: string;
    };
    expect(issued.status).toBe('issued');
    expect(await db.asUser(user, () => db.rpc('verify_device_code', [user.deviceToken, issued.code]))).toEqual({
      status: 'verified',
    });
    // Ya no queda ninguna sesión pendiente.
    expect(await db.asService(() => db.rpc('issue_device_challenge', [user.id, null]))).toEqual({ status: 'no_session' });
  });

  it('limita la emisión de códigos a 5 por hora', async () => {
    const user = await db.createUser('limite@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    for (let i = 0; i < 5; i++) {
      const r = (await db.asService(() => db.rpc('issue_device_challenge', [user.id, user.sessionId]))) as {
        status: string;
      };
      expect(r.status).toBe('issued');
    }
    expect(await db.asService(() => db.rpc('issue_device_challenge', [user.id, user.sessionId]))).toEqual({
      status: 'rate_limited',
    });
  });

  it('un usuario autenticado no puede emitirse códigos a sí mismo', async () => {
    const user = await db.createUser('emitir@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    expect(
      await expectDbError(db.asUser(user, () => db.rpc('issue_device_challenge', [user.id, user.sessionId]))),
    ).toMatch(/permission denied/);
  });

  it('un dispositivo verificado no vuelve a pedir código; uno nuevo sí', async () => {
    const user = await db.signInVerified(await db.createUser('confiable@test.cl'));

    const sameDevice = { ...user, sessionId: randomUUID() };
    expect(await db.asUser(sameDevice, () => db.rpc('begin_session', [user.deviceToken, null]))).toEqual({
      status: 'verified',
      kind: 'owner',
    });

    const otherDevice = { ...user, sessionId: randomUUID(), deviceToken: newDeviceToken() };
    expect(await db.asUser(otherDevice, () => db.rpc('begin_session', [otherDevice.deviceToken, null]))).toEqual({
      status: 'verification_required',
      kind: 'owner',
    });
    expect(await myAccounts(otherDevice)).toHaveLength(0);
  });

  it('begin_session es idempotente para la misma sesión', async () => {
    const user = await db.createUser('doble@test.cl');
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]));
    expect(await db.rows('select 1 from public.accounts where owner_user_id = $1', [user.id])).toHaveLength(1);
    expect(await db.rows('select 1 from private.session_guards where user_id = $1', [user.id])).toHaveLength(1);
  });

  it('una sesión no puede ser reclamada por otro usuario', async () => {
    const a = await db.createUser('a@test.cl');
    const b = await db.createUser('b@test.cl');
    await db.asUser(a, () => db.rpc('begin_session', [a.deviceToken, null]));
    const bWithASession = { ...b, sessionId: a.sessionId };
    expect(await expectDbError(db.asUser(bWithASession, () => db.rpc('begin_session', [b.deviceToken, null])))).toBe(
      'SESSION_MISMATCH',
    );
  });
});

describe('expiración por inactividad', () => {
  const ageSession = (user: TestUser, minutes: number) =>
    db.pg.query(
      `update private.session_guards set last_activity_at = now() - make_interval(mins => $2) where session_id = $1`,
      [user.sessionId, minutes],
    );

  it('emprendedor: la sesión vence a los 60 minutos sin actividad y no se puede revivir', async () => {
    const user = await db.signInVerified(await db.createUser('inactivo@test.cl'));

    await ageSession(user, 59);
    expect(await myAccounts(user)).toHaveLength(1);
    expect(await db.asUser(user, () => db.rpc('touch_session'))).toEqual({ status: 'active', idle_timeout_minutes: 60 });

    await ageSession(user, 61);
    expect(await myAccounts(user)).toHaveLength(0);
    expect(await db.asUser(user, () => db.rpc('touch_session'))).toEqual({ status: 'ended' });
    expect(await db.asUser(user, () => db.rpc('begin_session', [user.deviceToken, null]))).toEqual({
      status: 'session_ended',
      kind: 'owner',
    });
  });

  it('cerrar sesión invalida la sesión en el servidor', async () => {
    const user = await db.signInVerified(await db.createUser('logout@test.cl'));
    await db.asUser(user, () => db.rpc('end_session', ['logout']));
    expect(await myAccounts(user)).toHaveLength(0);
  });
});

describe('aislamiento entre cuentas', () => {
  it('cada emprendedor solo ve y modifica su propia cuenta', async () => {
    const a = await db.signInVerified(await db.createUser('a@test.cl'));
    const b = await db.signInVerified(await db.createUser('b@test.cl'));

    const accountsA = await myAccounts(a);
    const accountsB = await myAccounts(b);
    expect(accountsA).toEqual([expect.objectContaining({ owner_user_id: a.id })]);
    expect(accountsB).toEqual([expect.objectContaining({ owner_user_id: b.id })]);

    const idB = accountsB[0].id as string;
    // Acceso por identificador conocido.
    expect(await db.asUser(a, () => db.rows('select * from public.accounts where id = $1', [idB]))).toHaveLength(0);

    // Escritura directa bloqueada (solo vía RPC).
    expect(
      await expectDbError(
        db.asUser(a, () => db.rows(`update public.accounts set business_name = 'hack' where id = $1`, [idB])),
      ),
    ).toMatch(/permission denied/);

    await db.asUser(a, () => db.rpc('update_business_profile', ['Panadería A', null, null, 'America/Santiago', true]));
    const names = await db.rows<{ owner_user_id: string; business_name: string | null }>(
      'select owner_user_id, business_name from public.accounts order by business_name nulls last',
    );
    expect(names).toEqual([
      { owner_user_id: a.id, business_name: 'Panadería A' },
      { owner_user_id: b.id, business_name: null },
    ]);
  });

  it('los clientes no pueden leer las tablas internas', async () => {
    const a = await db.signInVerified(await db.createUser('a@test.cl'));
    for (const table of ['audit_log', 'session_guards', 'trusted_devices', 'device_challenges', 'idempotency_keys', 'platform_admins']) {
      expect(await expectDbError(db.asUser(a, () => db.rows(`select * from private.${table}`)))).toMatch(
        /permission denied/,
      );
    }
  });

  it('las tablas de negocio asignan account_id desde la sesión y bloquean cuentas ajenas', async () => {
    // Tabla de ejemplo que sigue la convención obligatoria de la Etapa 3.
    await db.pg.exec(`
      create table public.demo_items (
        id uuid primary key default gen_random_uuid(),
        account_id uuid not null references public.accounts(id),
        name text not null,
        unique (account_id, id)
      );
      alter table public.demo_items enable row level security;
      create trigger demo_items_account before insert or update on public.demo_items
        for each row execute function private.enforce_account_id();
      create policy demo_rw on public.demo_items for all to authenticated
        using (account_id = (select private.current_account_id()))
        with check (account_id = (select private.current_account_id()));
      revoke all on public.demo_items from anon;
    `);
    const a = await db.signInVerified(await db.createUser('a@test.cl'));
    const b = await db.signInVerified(await db.createUser('b@test.cl'));
    const idA = (await myAccounts(a))[0].id as string;
    const idB = (await myAccounts(b))[0].id as string;

    // Sin account_id: se asigna el de la sesión.
    await db.asUser(a, () => db.rows(`insert into public.demo_items (name) values ('harina')`));
    // Con account_id ajeno: rechazado.
    expect(
      await expectDbError(
        db.asUser(a, () => db.rows(`insert into public.demo_items (account_id, name) values ($1, 'x')`, [idB])),
      ),
    ).toBe('ACCOUNT_MISMATCH');

    await db.asUser(b, () => db.rows(`insert into public.demo_items (name) values ('azúcar')`));
    expect(await db.asUser(a, () => db.rows('select name from public.demo_items'))).toEqual([{ name: 'harina' }]);
    expect(await db.asUser(b, () => db.rows('select name from public.demo_items'))).toEqual([{ name: 'azúcar' }]);

    // Mover un registro a otra cuenta: rechazado.
    expect(
      await expectDbError(db.asUser(a, () => db.rows('update public.demo_items set account_id = $1', [idB]))),
    ).toBe('ACCOUNT_IMMUTABLE');
    // B no puede modificar ni borrar lo de A (RLS lo vuelve invisible).
    await db.asUser(b, () => db.rows(`delete from public.demo_items where account_id = $1`, [idA]));
    expect(await db.asUser(a, () => db.rows('select name from public.demo_items'))).toHaveLength(1);
  });
});

describe('cuentas bloqueadas y administradores', () => {
  it('una cuenta desactivada pierde el acceso a sus datos', async () => {
    const user = await db.signInVerified(await db.createUser('cerrada@test.cl'));
    await db.pg.query(`update public.accounts set status = 'deactivated' where owner_user_id = $1`, [user.id]);
    expect(await myAccounts(user)).toHaveLength(0);
    const again = { ...user, sessionId: randomUUID() };
    expect(await db.asUser(again, () => db.rpc('begin_session', [user.deviceToken, null]))).toEqual({
      status: 'account_unavailable',
      kind: 'owner',
      account_status: 'deactivated',
    });
  });

  it('un administrador no obtiene cuenta de emprendedor y su sesión vence a los 30 minutos', async () => {
    const admin = await db.createUser('admin@test.cl');
    await db.pg.query('insert into private.platform_admins (user_id) values ($1)', [admin.id]);
    expect(await db.asUser(admin, () => db.rpc('begin_session', [admin.deviceToken, null]))).toEqual({
      status: 'verification_required',
      kind: 'admin',
    });
    expect(await db.rows('select 1 from public.accounts where owner_user_id = $1', [admin.id])).toHaveLength(0);
    const guard = await db.one<{ idle_timeout_minutes: number }>(
      'select idle_timeout_minutes from private.session_guards where user_id = $1',
      [admin.id],
    );
    expect(guard.idle_timeout_minutes).toBe(30);
  });

  it('un emprendedor no puede convertirse en administrador', async () => {
    const owner = await db.signInVerified(await db.createUser('owner@test.cl'));
    expect(
      await expectDbError(db.pg.query('insert into private.platform_admins (user_id) values ($1)', [owner.id])),
    ).toBe('OWNER_CANNOT_BE_ADMIN');
  });
});

describe('auditoría', () => {
  it('registra eventos y no permite modificarlos ni borrarlos', async () => {
    const user = await db.signInVerified(await db.createUser('audit@test.cl'));
    await db.asUser(user, () => db.rpc('update_business_profile', ['Dulce Pando', null, null, 'America/Santiago', false]));

    const actions = await db.rows<{ action: string }>('select action from private.audit_log order by id');
    expect(actions.map((r) => r.action)).toEqual(['device.verified', 'account.profile_updated']);

    // Ni siquiera el superusuario puede alterar la auditoría por el flujo normal.
    expect(await expectDbError(db.pg.query(`update private.audit_log set action = 'x'`))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.pg.query('delete from private.audit_log'))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.pg.query('truncate private.audit_log'))).toBe('IMMUTABLE_RECORD');
  });
});

describe('perfil del negocio', () => {
  it('valida los datos en el servidor', async () => {
    const user = await db.signInVerified(await db.createUser('perfil@test.cl'));
    const call = (name: string, email: string | null, tz: string) =>
      expectDbError(db.asUser(user, () => db.rpc('update_business_profile', [name, email, null, tz, false])));

    expect(await call('   ', null, 'America/Santiago')).toBe('BUSINESS_NAME_REQUIRED');
    expect(await call('A'.repeat(121), null, 'America/Santiago')).toBe('BUSINESS_NAME_TOO_LONG');
    expect(await call('Pan', 'no-es-correo', 'America/Santiago')).toBe('INVALID_CONTACT_EMAIL');
    expect(await call('Pan', null, 'GMT-3/Inventada')).toBe('INVALID_TIMEZONE');
  });

  it('marca la configuración inicial como completada una sola vez', async () => {
    const user = await db.signInVerified(await db.createUser('onboarding@test.cl'));
    const update = (name: string) =>
      db.asUser(user, () =>
        db.one<{ business_name: string; onboarding_completed_at: Date }>(
          'select business_name, onboarding_completed_at from public.update_business_profile($1, null, null, $2, true)',
          [name, 'America/Santiago'],
        ),
      );
    const first = await update('Pan');
    expect(first.onboarding_completed_at).toBeInstanceOf(Date);
    const second = await update('Pan 2');
    expect(second.business_name).toBe('Pan 2');
    expect(second.onboarding_completed_at).toEqual(first.onboarding_completed_at);
  });
});

describe('idempotencia', () => {
  it('reconoce reintentos y rechaza la misma clave con otros datos', async () => {
    const user = await db.signInVerified(await db.createUser('idem@test.cl'));
    const { id: accountId } = await db.one<{ id: string }>('select id from public.accounts where owner_user_id = $1', [
      user.id,
    ]);
    const key = randomUUID();
    const payload = { ingredient: 'harina', qty: 1000 };
    const begin = (p: unknown) =>
      db.one<{ r: unknown }>('select private.idem_begin($1, $2, $3, $4) as r', [accountId, key, 'purchase.confirm', p]);

    expect((await begin(payload)).r).toBeNull();
    // Antes de terminar, un reintento informa que sigue en proceso.
    expect(await expectDbError(begin(payload))).toBe('IDEMPOTENCY_IN_PROGRESS');

    await db.pg.query('select private.idem_finish($1, $2, $3)', [accountId, key, { purchase_id: 'p-1' }]);
    expect((await begin(payload)).r).toEqual({ purchase_id: 'p-1' });
    // El orden de las claves del JSON no importa (jsonb normaliza).
    expect((await begin({ qty: 1000, ingredient: 'harina' })).r).toEqual({ purchase_id: 'p-1' });

    expect(await expectDbError(begin({ ...payload, qty: 2000 }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await expectDbError(
        db.pg.query('select private.idem_begin($1, $2, $3, $4)', [accountId, key, 'payment.confirm', payload]),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('actividad real del negocio', () => {
  it('quita la marca de inactividad, pero nunca reactiva una cuenta desactivada', async () => {
    const user = await db.signInVerified(await db.createUser('actividad@test.cl'));
    const { id } = await db.one<{ id: string }>('select id from public.accounts where owner_user_id = $1', [user.id]);

    await db.pg.query(`update public.accounts set status = 'inactive' where id = $1`, [id]);
    await db.pg.query('select private.mark_business_activity($1)', [id]);
    expect((await db.one<{ status: string }>('select status from public.accounts where id = $1', [id])).status).toBe(
      'active',
    );

    await db.pg.query(`update public.accounts set status = 'deactivated' where id = $1`, [id]);
    await db.pg.query('select private.mark_business_activity($1)', [id]);
    expect((await db.one<{ status: string }>('select status from public.accounts where id = $1', [id])).status).toBe(
      'deactivated',
    );
  });
});
