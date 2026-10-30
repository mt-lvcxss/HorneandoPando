-- =============================================================================
-- Etapa 2 · Fundamentos
-- Cuentas, sesiones verificadas por dispositivo, expiración por inactividad,
-- idempotencia, auditoría inmutable y helpers de aislamiento por cuenta.
--
-- Convenciones (ver docs/decisiones.md):
--   * Los helpers internos viven en el esquema `private`, que NO expone la Data API.
--   * Toda función SECURITY DEFINER fija `search_path = ''` y califica los nombres.
--   * Los errores de negocio se lanzan con private.fail(codigo, mensaje):
--     message = código estable (lo interpreta el frontend), detail = texto en español.
--   * Dinero en CLP como bigint (enteros). Cantidades como numeric sin redondeo.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Nada nuevo en `public` queda accesible para `anon` ni ejecutable por PUBLIC
-- sin un grant explícito.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema private revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Identidad (único punto acoplado al proveedor de autenticación)
--
-- Todo el SQL del proyecto obtiene el usuario y la sesión a través de estas dos
-- funciones. En Supabase leen el JWT validado por PostgREST. En otro PostgreSQL se
-- usa database/compat/postgres-sin-supabase.sql, que provee el mismo contrato
-- (auth.users, auth.uid(), auth.jwt()) leyendo `request.jwt.claims`; cualquier
-- backend propio solo debe fijar ese parámetro por transacción tras validar el token.
-- Ver docs/portabilidad-postgresql.md.
-- -----------------------------------------------------------------------------

create function private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid();
$$;

create function private.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

grant execute on function private.current_user_id() to authenticated;
grant execute on function private.current_session_id() to authenticated;

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

create function private.fail(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_message;
end;
$$;

create function private.sha256_hex(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')), 'hex');
$$;

-- Bloquea UPDATE / DELETE / TRUNCATE sobre registros inmutables.
create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.fail(
    'IMMUTABLE_RECORD',
    format('Los registros de %s no se pueden modificar ni eliminar. Registra un movimiento correctivo.', tg_table_name)
  );
  return null;
end;
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cuentas de emprendedor (una por usuario en la primera versión)
-- -----------------------------------------------------------------------------

create table public.accounts (
  id                         uuid primary key default gen_random_uuid(),
  owner_user_id              uuid not null unique references auth.users (id) on delete restrict,
  -- active / inactive: la cuenta opera normalmente (inactive es solo una marca administrativa).
  -- deactivated / closed: acceso bloqueado.
  status                     text not null default 'active'
                               check (status in ('active', 'inactive', 'deactivated', 'closed')),
  business_name              text check (business_name is null or char_length(business_name) between 1 and 120),
  contact_email              text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone              text check (contact_phone is null or char_length(contact_phone) <= 40),
  timezone                   text not null default 'America/Santiago',
  currency                   text not null default 'CLP' check (currency = 'CLP'),
  onboarding_completed_at    timestamptz,
  last_business_activity_at  timestamptz,
  status_changed_at          timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function private.touch_updated_at();

alter table public.accounts enable row level security;

-- -----------------------------------------------------------------------------
-- Administradores técnicos (separados de los emprendedores)
-- Solo se insertan con service_role / SQL directo: no hay políticas ni grants.
-- -----------------------------------------------------------------------------

create table private.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete restrict,
  note        text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- Un usuario no puede ser a la vez emprendedor y administrador.
create function private.enforce_admin_owner_exclusive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'accounts' then
    if exists (select 1 from private.platform_admins a where a.user_id = new.owner_user_id) then
      perform private.fail('ADMIN_CANNOT_OWN_ACCOUNT',
        'Un administrador de la plataforma no puede tener una cuenta de emprendedor.');
    end if;
  else
    if exists (select 1 from public.accounts c where c.owner_user_id = new.user_id) then
      perform private.fail('OWNER_CANNOT_BE_ADMIN',
        'Una cuenta de emprendedor no puede recibir privilegios administrativos.');
    end if;
  end if;
  return new;
end;
$$;

create trigger accounts_exclusive_admin
  before insert or update of owner_user_id on public.accounts
  for each row execute function private.enforce_admin_owner_exclusive();

create trigger platform_admins_exclusive_owner
  before insert or update of user_id on private.platform_admins
  for each row execute function private.enforce_admin_owner_exclusive();

-- -----------------------------------------------------------------------------
-- Dispositivos de confianza y sesiones verificadas
--
-- Supabase no ofrece verificación por nuevo dispositivo. Diseño propio:
--   * El navegador genera un token aleatorio de dispositivo (localStorage); aquí solo
--     se guarda su hash SHA-256.
--   * Cada sesión de Supabase (claim `session_id` del JWT) se registra en
--     private.session_guards. Hasta que esté verificada, current_account_id()
--     devuelve NULL y RLS bloquea todos los datos del negocio.
--   * Un dispositivo nuevo se verifica con un código de 6 dígitos enviado por correo
--     (vigencia 10 min, máx. 5 intentos, un solo uso).
--   * La inactividad se controla en el servidor con last_activity_at
--     (60 min emprendedor, 30 min administrador).
-- -----------------------------------------------------------------------------

create table private.trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_hash   text not null,
  label         text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_hash)
);

create table private.session_guards (
  session_id            uuid primary key,
  user_id               uuid not null references auth.users (id) on delete cascade,
  kind                  text not null check (kind in ('owner', 'admin')),
  idle_timeout_minutes  integer not null check (idle_timeout_minutes > 0),
  device_hash           text not null,
  device_label          text,
  device_id             uuid references private.trusted_devices (id),
  verified_at           timestamptz,
  last_activity_at      timestamptz not null default now(),
  ended_at              timestamptz,
  end_reason            text,
  created_at            timestamptz not null default now()
);

create index session_guards_user_idx on private.session_guards (user_id);

create table private.device_challenges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid not null references private.session_guards (session_id) on delete cascade,
  code_hash     text not null,
  salt          text not null,
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  consumed_reason text check (consumed_reason in ('verified', 'superseded', 'too_many_attempts')),
  created_at    timestamptz not null default now()
);

create index device_challenges_user_created_idx on private.device_challenges (user_id, created_at);

-- Sesión actual (según el JWT) si está verificada y no expiró por inactividad.
create function private.current_session()
returns private.session_guards
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from private.session_guards s
  where s.session_id = private.current_session_id()
    and s.user_id = private.current_user_id()
    and s.verified_at is not null
    and s.ended_at is null
    and s.last_activity_at > now() - make_interval(mins => s.idle_timeout_minutes);
$$;

-- Cuenta del emprendedor autenticado. NULL si no hay sesión verificada y vigente,
-- si la cuenta está desactivada/cerrada o si el usuario es administrador.
-- Es la base de todas las políticas RLS.
create function private.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.accounts a
  join private.current_session() s on s.user_id = a.owner_user_id and s.kind = 'owner'
  where a.owner_user_id = private.current_user_id()
    and a.status in ('active', 'inactive');
$$;

-- Administrador autenticado (sesión verificada, vigente, privilegio no revocado).
create function private.current_admin_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id
  from private.platform_admins p
  join private.current_session() s on s.user_id = p.user_id and s.kind = 'admin'
  where p.user_id = private.current_user_id()
    and p.revoked_at is null;
$$;

-- Igual que current_account_id(), pero falla con un error explicativo.
-- Para usar al inicio de las RPC de operaciones.
create function private.require_account_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.current_account_id();
begin
  if v_account is null then
    perform private.fail('SESSION_NOT_VALID',
      'Tu sesión no está verificada o expiró. Vuelve a iniciar sesión.');
  end if;
  return v_account;
end;
$$;

grant execute on function private.current_account_id() to authenticated;
-- Usadas por triggers SECURITY INVOKER cuando escribe el rol authenticated.
grant execute on function private.fail(text, text) to authenticated;
grant execute on function private.sha256_hex(text) to authenticated;
grant execute on function private.current_admin_id() to authenticated;
grant execute on function private.require_account_id() to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoría (solo inserción; ni siquiera el flujo administrativo puede alterarla)
-- -----------------------------------------------------------------------------

create table private.audit_log (
  id             bigint generated always as identity primary key,
  account_id     uuid references public.accounts (id),
  actor_user_id  uuid,
  actor_kind     text not null check (actor_kind in ('owner', 'admin', 'system')),
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index audit_log_account_created_idx on private.audit_log (account_id, created_at);

create trigger audit_log_immutable
  before update or delete on private.audit_log
  for each row execute function private.forbid_mutation();

create trigger audit_log_no_truncate
  before truncate on private.audit_log
  for each statement execute function private.forbid_mutation();

create function private.audit(
  p_account_id  uuid,
  p_actor_kind  text,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_details     jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.audit_log (account_id, actor_user_id, actor_kind, action, entity_type, entity_id, details)
  values (p_account_id, private.current_user_id(), p_actor_kind, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Actividad real del negocio (base del control de inactividad de 90 días)
-- Iniciar sesión o navegar NO cuenta: solo lo llaman las operaciones de negocio.
-- -----------------------------------------------------------------------------

create function private.mark_business_activity(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.accounts
     set last_business_activity_at = now()
   where id = p_account_id
  returning status into v_status;

  -- Una cuenta marcada como inactiva vuelve a activa con actividad real.
  -- Las desactivadas o cerradas nunca se reactivan solas.
  if v_status = 'inactive' then
    update public.accounts set status = 'active', status_changed_at = now() where id = p_account_id;
    perform private.audit(p_account_id, 'system', 'account.inactivity_cleared');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Idempotencia
-- Cada operación crítica recibe una clave UUID generada por el formulario.
-- Un reintento con la misma clave y los mismos datos devuelve el resultado original;
-- con datos distintos, se rechaza.
-- -----------------------------------------------------------------------------

create table private.idempotency_keys (
  account_id    uuid not null references public.accounts (id),
  key           uuid not null,
  operation     text not null,
  request_hash  text not null,
  response      jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  primary key (account_id, key)
);

-- Devuelve NULL si la operación debe ejecutarse, o la respuesta guardada si es un reintento.
-- Si dos llamadas concurrentes usan la misma clave, la segunda espera a que la primera
-- confirme (bloqueo del índice único) y luego recibe su respuesta.
create function private.idem_begin(p_account_id uuid, p_key uuid, p_operation text, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text := private.sha256_hex(coalesce(p_request, '{}'::jsonb)::text);
  v_rows  integer;
  v_row   private.idempotency_keys;
begin
  if p_key is null then
    perform private.fail('IDEMPOTENCY_KEY_REQUIRED',
      'Falta el identificador de la operación. Recarga el formulario e inténtalo de nuevo.');
  end if;

  insert into private.idempotency_keys (account_id, key, operation, request_hash)
  values (p_account_id, p_key, p_operation, v_hash)
  on conflict (account_id, key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    return null;
  end if;

  select * into v_row from private.idempotency_keys where account_id = p_account_id and key = p_key;

  if v_row.operation <> p_operation or v_row.request_hash <> v_hash then
    perform private.fail('IDEMPOTENCY_KEY_REUSED',
      'Esta operación ya se registró con datos distintos. Recarga el formulario para crear una nueva.');
  end if;

  if v_row.response is null then
    perform private.fail('IDEMPOTENCY_IN_PROGRESS',
      'La operación todavía se está procesando. Espera unos segundos y revisa el resultado.');
  end if;

  return v_row.response;
end;
$$;

create function private.idem_finish(p_account_id uuid, p_key uuid, p_response jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update private.idempotency_keys
     set response = p_response, completed_at = now()
   where account_id = p_account_id and key = p_key
  returning response;
$$;

-- -----------------------------------------------------------------------------
-- Aislamiento por cuenta para tablas de negocio (se usa desde la Etapa 3)
--
-- Toda tabla de negocio:
--   * tiene account_id NOT NULL y UNIQUE (account_id, id);
--   * referencia a sus padres con FK compuesta (account_id, parent_id), de modo que la
--     base de datos impide relacionar entidades de cuentas distintas;
--   * usa este trigger para asignar account_id desde la sesión (el valor del cliente
--     se ignora si coincide y se rechaza si no) e impedir que cambie.
-- -----------------------------------------------------------------------------

-- SECURITY INVOKER a propósito: current_user debe ser el rol real que escribe.
-- Dentro de una RPC SECURITY DEFINER, current_user es el dueño de la función.
create function private.enforce_account_id()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account uuid;
begin
  -- Las RPC privilegiadas (dueño de la función) y service_role fijan account_id explícitamente.
  if current_user not in ('authenticated', 'anon') then
    if new.account_id is null then
      perform private.fail('ACCOUNT_REQUIRED', 'Falta la cuenta del registro.');
    end if;
    if tg_op = 'UPDATE' and new.account_id is distinct from old.account_id then
      perform private.fail('ACCOUNT_IMMUTABLE', 'Un registro no puede cambiar de cuenta.');
    end if;
    return new;
  end if;

  v_account := private.current_account_id();
  if v_account is null then
    perform private.fail('SESSION_NOT_VALID', 'Tu sesión no está verificada o expiró. Vuelve a iniciar sesión.');
  end if;

  if tg_op = 'INSERT' then
    if new.account_id is not null and new.account_id <> v_account then
      perform private.fail('ACCOUNT_MISMATCH', 'No puedes crear registros para otra cuenta.');
    end if;
    new.account_id := v_account;
  elsif new.account_id is distinct from old.account_id then
    perform private.fail('ACCOUNT_IMMUTABLE', 'Un registro no puede cambiar de cuenta.');
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS y permisos de accounts
-- Lectura: solo la propia cuenta y solo con sesión verificada.
-- Escritura: únicamente mediante RPC (update_business_profile).
-- -----------------------------------------------------------------------------

revoke all on table public.accounts from anon, authenticated;
grant select on table public.accounts to authenticated;

create policy accounts_select_own on public.accounts
  for select to authenticated
  using (id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- RPC: ciclo de vida de la sesión
-- -----------------------------------------------------------------------------

-- Se llama justo después de iniciar sesión (y al recargar la app).
-- Registra la sesión, crea la cuenta del emprendedor si aún no existe y
-- determina si el dispositivo es de confianza.
-- Respuesta: { status: 'verified' | 'verification_required' | 'session_ended' | 'account_unavailable', kind }
create function public.begin_session(p_device_token text, p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := private.current_user_id();
  v_sid         uuid := private.current_session_id();
  v_hash        text;
  v_label       text := left(nullif(trim(p_device_label), ''), 100);
  v_is_admin    boolean;
  v_kind        text;
  v_account     public.accounts;
  v_device      private.trusted_devices;
  v_session     private.session_guards;
  v_confirmed   timestamptz;
begin
  if v_uid is null or v_sid is null then
    perform private.fail('NOT_AUTHENTICATED', 'Debes iniciar sesión.');
  end if;
  if p_device_token is null or p_device_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    perform private.fail('INVALID_DEVICE_TOKEN', 'No se pudo identificar este navegador. Recarga la página.');
  end if;
  v_hash := private.sha256_hex(p_device_token);

  select email_confirmed_at into v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then
    perform private.fail('EMAIL_NOT_CONFIRMED', 'Debes confirmar tu correo antes de continuar.');
  end if;

  v_is_admin := exists (select 1 from private.platform_admins where user_id = v_uid and revoked_at is null);
  v_kind := case when v_is_admin then 'admin' else 'owner' end;

  if not v_is_admin then
    insert into public.accounts (owner_user_id) values (v_uid)
    on conflict (owner_user_id) do nothing;
    select * into v_account from public.accounts where owner_user_id = v_uid;
    if v_account.status not in ('active', 'inactive') then
      return jsonb_build_object('status', 'account_unavailable', 'kind', v_kind, 'account_status', v_account.status);
    end if;
  end if;

  -- ON CONFLICT: dos pestañas pueden llamar a la vez para la misma sesión.
  insert into private.session_guards (session_id, user_id, kind, idle_timeout_minutes, device_hash, device_label)
  values (v_sid, v_uid, v_kind, case when v_is_admin then 30 else 60 end, v_hash, v_label)
  on conflict (session_id) do nothing;

  select * into v_session from private.session_guards where session_id = v_sid for update;

  if v_session.user_id <> v_uid then
    perform private.fail('SESSION_MISMATCH', 'La sesión no corresponde a este usuario.');
  end if;
  if v_session.ended_at is not null
     or v_session.last_activity_at <= now() - make_interval(mins => v_session.idle_timeout_minutes) then
    if v_session.ended_at is null then
      update private.session_guards set ended_at = now(), end_reason = 'idle_timeout' where session_id = v_sid;
    end if;
      return jsonb_build_object('status', 'session_ended', 'kind', v_kind);
  end if;
  if v_session.device_hash <> v_hash then
    perform private.fail('DEVICE_MISMATCH', 'Esta sesión se inició en otro navegador. Vuelve a iniciar sesión.');
  end if;
  if v_session.verified_at is not null then
    return jsonb_build_object('status', 'verified', 'kind', v_kind);
  end if;

  select * into v_device
  from private.trusted_devices
  where user_id = v_uid and device_hash = v_hash and revoked_at is null;

  if found then
    update private.trusted_devices set last_seen_at = now() where id = v_device.id;
    update private.session_guards
       set verified_at = now(), device_id = v_device.id, last_activity_at = now()
     where session_id = v_sid;
    perform private.audit(v_account.id, v_kind, 'session.started_trusted_device', 'device', v_device.id);
    return jsonb_build_object('status', 'verified', 'kind', v_kind);
  end if;

  return jsonb_build_object('status', 'verification_required', 'kind', v_kind);
end;
$$;

-- Solo para service_role: la Edge Function `send-device-code` y la herramienta de desarrollo
-- `npm run codigo-dispositivo` (proyecto de pruebas). Genera el código, guarda únicamente su hash
-- y devuelve el código en claro para entregarlo. Nunca se almacena en claro.
-- Si p_session_id es NULL se usa la sesión pendiente más reciente del usuario.
create function public.issue_device_challenge(p_user_id uuid, p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   private.session_guards;
  v_recent    integer;
  v_code      text;
  v_salt      text := replace(gen_random_uuid()::text, '-', '');
  v_expires   timestamptz := now() + interval '10 minutes';
  v_email     text;
begin
  select * into v_session from private.session_guards
   where user_id = p_user_id
     and (session_id = p_session_id
          or (p_session_id is null and verified_at is null and ended_at is null))
   order by created_at desc
   limit 1
   for update;

  if not found or v_session.ended_at is not null then
    return jsonb_build_object('status', 'no_session');
  end if;
  if v_session.verified_at is not null then
    return jsonb_build_object('status', 'not_required');
  end if;

  select count(*) into v_recent from private.device_challenges
   where user_id = p_user_id and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update private.device_challenges
     set consumed_at = now(), consumed_reason = 'superseded'
   where session_id = v_session.session_id and consumed_at is null;

  -- 32 bits aleatorios de un UUID v4 (generador criptográfico de PostgreSQL) → 6 dígitos.
  v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000))::text, 6, '0');

  insert into private.device_challenges (user_id, session_id, code_hash, salt, expires_at)
  values (p_user_id, v_session.session_id, private.sha256_hex(v_salt || v_code), v_salt, v_expires);

  select email into v_email from auth.users where id = p_user_id;

  return jsonb_build_object('status', 'issued', 'code', v_code, 'email', v_email, 'expires_at', v_expires);
end;
$$;

-- Verifica el código de nuevo dispositivo. Los intentos fallidos se guardan
-- (por eso no se lanza excepción ante un código incorrecto: se perdería el conteo).
-- Respuesta: { status: 'verified' | 'invalid_code' | 'no_active_code' | 'too_many_attempts', remaining_attempts }
create function public.verify_device_code(p_device_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := private.current_user_id();
  v_sid        uuid := private.current_session_id();
  v_session    private.session_guards;
  v_challenge  private.device_challenges;
  v_device_id  uuid;
  v_account_id uuid;
begin
  if v_uid is null or v_sid is null then
    perform private.fail('NOT_AUTHENTICATED', 'Debes iniciar sesión.');
  end if;

  select * into v_session from private.session_guards
   where session_id = v_sid and user_id = v_uid and ended_at is null for update;
  if not found then
    perform private.fail('SESSION_NOT_VALID', 'Tu sesión no es válida. Vuelve a iniciar sesión.');
  end if;
  if v_session.verified_at is not null then
    return jsonb_build_object('status', 'verified');
  end if;
  if p_device_token is null or private.sha256_hex(p_device_token) <> v_session.device_hash then
    perform private.fail('DEVICE_MISMATCH', 'Esta sesión se inició en otro navegador. Vuelve a iniciar sesión.');
  end if;

  select * into v_challenge from private.device_challenges
   where session_id = v_sid and consumed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('status', 'no_active_code');
  end if;

  if p_code is null or p_code !~ '^[0-9]{6}$'
     or private.sha256_hex(v_challenge.salt || p_code) <> v_challenge.code_hash then
    update private.device_challenges
       set attempts = attempts + 1,
           consumed_at = case when attempts + 1 >= max_attempts then now() end,
           consumed_reason = case when attempts + 1 >= max_attempts then 'too_many_attempts' end
     where id = v_challenge.id;
    if v_challenge.attempts + 1 >= v_challenge.max_attempts then
      return jsonb_build_object('status', 'too_many_attempts', 'remaining_attempts', 0);
    end if;
    return jsonb_build_object('status', 'invalid_code',
                              'remaining_attempts', v_challenge.max_attempts - v_challenge.attempts - 1);
  end if;

  update private.device_challenges set consumed_at = now(), consumed_reason = 'verified' where id = v_challenge.id;

  insert into private.trusted_devices (user_id, device_hash, label)
  values (v_uid, v_session.device_hash, v_session.device_label)
  on conflict (user_id, device_hash)
    do update set revoked_at = null, last_seen_at = now(), label = coalesce(excluded.label, private.trusted_devices.label)
  returning id into v_device_id;

  update private.session_guards
     set verified_at = now(), device_id = v_device_id, last_activity_at = now()
   where session_id = v_sid;

  select id into v_account_id from public.accounts where owner_user_id = v_uid;
  perform private.audit(v_account_id, v_session.kind, 'device.verified', 'device', v_device_id,
                        jsonb_build_object('label', v_session.device_label));

  return jsonb_build_object('status', 'verified');
end;
$$;

-- Registra actividad del usuario (el frontend lo llama solo ante interacción real).
-- Una sesión ya expirada no se puede revivir.
create function public.touch_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid     uuid := private.current_session_id();
  v_session private.session_guards;
begin
  select * into v_session from private.session_guards
   where session_id = v_sid and user_id = private.current_user_id() for update;

  if not found or v_session.verified_at is null then
    return jsonb_build_object('status', 'unverified');
  end if;
  if v_session.ended_at is not null then
    return jsonb_build_object('status', 'ended');
  end if;
  if v_session.last_activity_at <= now() - make_interval(mins => v_session.idle_timeout_minutes) then
    update private.session_guards set ended_at = now(), end_reason = 'idle_timeout' where session_id = v_sid;
    return jsonb_build_object('status', 'ended');
  end if;

  update private.session_guards set last_activity_at = now() where session_id = v_sid;
  return jsonb_build_object('status', 'active',
                            'idle_timeout_minutes', v_session.idle_timeout_minutes);
end;
$$;

create function public.end_session(p_reason text default 'logout')
returns void
language sql
security definer
set search_path = ''
as $$
  update private.session_guards
     set ended_at = now(),
         end_reason = case when p_reason in ('logout', 'idle_timeout') then p_reason else 'logout' end
   where session_id = private.current_session_id()
     and user_id = private.current_user_id()
     and ended_at is null;
$$;

-- -----------------------------------------------------------------------------
-- RPC: datos del negocio (configuración inicial, retomable)
-- -----------------------------------------------------------------------------

create function public.update_business_profile(
  p_business_name       text,
  p_contact_email       text default null,
  p_contact_phone       text default null,
  p_timezone            text default 'America/Santiago',
  p_complete_onboarding boolean default false
)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := private.require_account_id();
  v_before     public.accounts;
  v_after      public.accounts;
  v_name       text := nullif(trim(p_business_name), '');
  v_email      text := nullif(trim(p_contact_email), '');
  v_phone      text := nullif(trim(p_contact_phone), '');
  v_tz         text := coalesce(nullif(trim(p_timezone), ''), 'America/Santiago');
begin
  if v_name is null then
    perform private.fail('BUSINESS_NAME_REQUIRED', 'Ingresa el nombre de tu negocio.');
  end if;
  if char_length(v_name) > 120 then
    perform private.fail('BUSINESS_NAME_TOO_LONG', 'El nombre del negocio puede tener hasta 120 caracteres.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.fail('INVALID_CONTACT_EMAIL', 'El correo de contacto no tiene un formato válido.');
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    perform private.fail('INVALID_CONTACT_PHONE', 'El teléfono puede tener hasta 40 caracteres.');
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    perform private.fail('INVALID_TIMEZONE', 'La zona horaria no es válida.');
  end if;

  select * into v_before from public.accounts where id = v_account_id for update;

  update public.accounts
     set business_name = v_name,
         contact_email = v_email,
         contact_phone = v_phone,
         timezone = v_tz,
         onboarding_completed_at = case
           when p_complete_onboarding and onboarding_completed_at is null then now()
           else onboarding_completed_at end
   where id = v_account_id
  returning * into v_after;

  perform private.audit(v_account_id, 'owner', 'account.profile_updated', 'account', v_account_id,
    jsonb_build_object(
      'before', jsonb_build_object('business_name', v_before.business_name, 'contact_email', v_before.contact_email,
                                   'contact_phone', v_before.contact_phone, 'timezone', v_before.timezone),
      'after',  jsonb_build_object('business_name', v_after.business_name, 'contact_email', v_after.contact_email,
                                   'contact_phone', v_after.contact_phone, 'timezone', v_after.timezone)));

  return v_after;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos de ejecución de las RPC
-- -----------------------------------------------------------------------------

revoke execute on function public.begin_session(text, text) from public, anon;
revoke execute on function public.issue_device_challenge(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.verify_device_code(text, text) from public, anon;
revoke execute on function public.touch_session() from public, anon;
revoke execute on function public.end_session(text) from public, anon;
revoke execute on function public.update_business_profile(text, text, text, text, boolean) from public, anon;

grant execute on function public.begin_session(text, text) to authenticated;
grant execute on function public.issue_device_challenge(uuid, uuid) to service_role;
grant execute on function public.verify_device_code(text, text) to authenticated;
grant execute on function public.touch_session() to authenticated;
grant execute on function public.end_session(text) to authenticated;
grant execute on function public.update_business_profile(text, text, text, text, boolean) to authenticated;

-- Ninguna tabla del esquema private es accesible directamente por los clientes.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
