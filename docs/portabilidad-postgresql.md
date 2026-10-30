# Portabilidad: Supabase y otros PostgreSQL

La aplicación usa Supabase como backend de referencia, pero la base de datos y el frontend están
diseñados para no quedar atados a él.

================================================================================

## Qué es portable y qué depende de Supabase

| Componente | Portable | Detalle |
|---|---|---|
| Esquema, reglas, RLS, funciones (`supabase/migrations/`) | ✅ Sí | SQL estándar de PostgreSQL 15+. Verificado en CI contra PostgreSQL 15, 16 y 17, y localmente con PGlite (PostgreSQL 18). |
| Identidad del usuario dentro del SQL | ✅ Sí | Solo se obtiene mediante `private.current_user_id()` y `private.current_session_id()`. |
| Capa de compatibilidad | ✅ Incluida | `database/compat/postgres-sin-supabase.sql` crea roles, `auth.users`, `auth.uid()` y `auth.jwt()`. |
| Frontend | ✅ Aislado | Solo `src/db/api.ts` (y `src/db/supabase.ts`) conocen el SDK de Supabase. |
| Autenticación (registro, correo, contraseñas) | ⚠️ Supabase Auth | Otro proveedor requiere reimplementar `authApi` en `src/db/api.ts`. |
| API HTTP de datos | ⚠️ PostgREST | Supabase usa PostgREST, que también existe como software libre independiente. |
| Envío de códigos (`supabase/functions/send-device-code`) | ⚠️ Deno | Es un manejador HTTP estándar; corre en cualquier entorno Deno con otras variables. |

================================================================================

## Requisitos mínimos de PostgreSQL

- Versión **15 o superior** (se usan `gen_random_uuid()`, `sha256()`, columnas `identity`, `on conflict`).
- Permiso para crear esquemas, roles y funciones al aplicar las migraciones.
- No se requieren extensiones.

Proveedores compatibles en principio (no probados aún): PostgreSQL propio, Neon, Amazon RDS / Aurora
PostgreSQL, Google Cloud SQL, Azure Database for PostgreSQL, Supabase autoalojado. Antes de usar uno,
ejecutar las pruebas con `TEST_DATABASE_URL` apuntando a él (ver abajo).

================================================================================

## Instalar el esquema en un PostgreSQL sin Supabase

```bash
psql "$DATABASE_URL" -f database/compat/postgres-sin-supabase.sql
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

================================================================================

## Contrato para un backend propio

Si se reemplaza Supabase, el servidor que atienda las peticiones debe, **por cada petición y dentro de
una transacción**, después de validar el token del usuario:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<uuid usuario>","session_id":"<uuid sesión>"}', true);
-- consultas o llamadas a funciones del usuario
commit;
```

Además debe:
1. Mantener `auth.users` sincronizada (`id`, `email`, `email_confirmed_at`).
2. Entregar un `session_id` estable por inicio de sesión (la verificación de dispositivo y la
   expiración por inactividad dependen de él).
3. Usar el rol `service_role` solo en procesos internos (por ejemplo, para `issue_device_challenge`).
4. Nunca permitir que el navegador elija el rol ni los claims.

PostgREST hace exactamente esto a partir de un JWT, por lo que es la alternativa más directa.

================================================================================

## Verificar un PostgreSQL concreto

Las pruebas de base de datos pueden ejecutarse contra cualquier servidor en vez de PGlite:

```bash
# PowerShell
$env:TEST_DATABASE_URL="postgresql://usuario:clave@servidor:5432/postgres"; npm run test:db
# Bash
TEST_DATABASE_URL=postgresql://usuario:clave@servidor:5432/postgres npm run test:db
```

Cada prueba crea y elimina una base de datos temporal (`hp_test_...`). El usuario necesita permiso para
crear bases de datos y roles. **No usar un servidor con datos reales.**

================================================================================
