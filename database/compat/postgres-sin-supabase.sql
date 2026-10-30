-- =============================================================================
-- Capa de compatibilidad: PostgreSQL sin Supabase (versión 15 o superior)
--
-- Provee el mismo contrato que Supabase entrega antes de nuestras migraciones:
--   * roles anon / authenticated / service_role
--   * esquema auth con auth.users, auth.uid() y auth.jwt()
--   * privilegios por defecto equivalentes sobre el esquema public
--
-- NO se aplica en Supabase (allí estos objetos ya existen).
-- Uso: psql "$DATABASE_URL" -f database/compat/postgres-sin-supabase.sql
--      y luego las migraciones de supabase/migrations en orden.
--
-- Contrato para el backend que reemplace a Supabase (ver docs/portabilidad-postgresql.md):
--   por cada petición, dentro de una transacción, tras validar el token del usuario:
--     set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<uuid>","session_id":"<uuid>"}', true);
--   y mantener auth.users sincronizado con su sistema de usuarios.
-- Es idempotente: puede ejecutarse más de una vez.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key,
  email               text unique,
  email_confirmed_at  timestamptz,
  created_at          timestamptz not null default now()
);

-- Misma lógica que las funciones de Supabase: leen los claims del JWT de la petición.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Privilegios por defecto equivalentes a Supabase (generosos a propósito:
-- las migraciones del proyecto los restringen explícitamente).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
