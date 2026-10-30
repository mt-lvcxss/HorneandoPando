# Decisiones técnicas

Registro de decisiones importantes: qué se decidió, por qué y qué consecuencias tiene.
Las decisiones nuevas se agregan al final; las reemplazadas se marcan como tales, sin borrarlas.

---

## D-001 · Sin Docker: dos proyectos Supabase en la nube
**Fecha:** 2026-10-30 · **Estado:** vigente (el piloto con emprendedores reales queda pospuesto, ver D-014)

El equipo de desarrollo tiene la virtualización desactivada en la BIOS, 6 GB de RAM y un usuario sin
permisos de administrador. Supabase local (`supabase start`) necesita Docker y varios GB de memoria.

**Decisión:** dos proyectos Supabase gratuitos (región São Paulo):
- `horneando-prod`: datos reales del piloto con dos emprendedores. Nunca se ejecutan pruebas automáticas aquí.
- `horneando-test`: desarrollo y pruebas automáticas.

**Consecuencia:** las pruebas de base de datos locales se hacen con PGlite (ver D-010) y las de
integración contra `horneando-test`.

## D-002 · Operaciones críticas como funciones PostgreSQL (RPC)
**Fecha:** 2026-10-30 · **Estado:** vigente

Las operaciones que mueven inventario o dinero se implementan como funciones PL/pgSQL `SECURITY DEFINER`
llamadas con `supabase.rpc(...)`. Cada llamada es una transacción: se confirma completa o no se confirma.
El navegador no escribe directamente en tablas de movimientos.

Las Edge Functions se reservan para lo que requiere secretos o servicios externos (correo, respaldos,
exportaciones administrativas).

**Reglas para toda función `SECURITY DEFINER`:** `set search_path = ''`, nombres calificados con esquema,
validación de la cuenta con `private.require_account_id()` al inicio, y `revoke` explícito a `public`/`anon`.

## D-003 · Aislamiento por cuenta en tres capas
**Fecha:** 2026-10-30 · **Estado:** vigente

1. **RLS** en toda tabla de negocio: `account_id = (select private.current_account_id())`.
2. **Trigger `private.enforce_account_id`**: asigna `account_id` desde la sesión, rechaza valores de otra
   cuenta (`ACCOUNT_MISMATCH`) e impide moverlos (`ACCOUNT_IMMUTABLE`). El `account_id` del navegador nunca se usa sin validar.
3. **Claves foráneas compuestas** `(account_id, parent_id)` hacia tablas con `unique (account_id, id)`:
   la base de datos impide relacionar entidades de cuentas distintas, incluso desde funciones privilegiadas.

Los helpers internos viven en el esquema `private`, que la Data API no expone.

## D-004 · Verificación por nuevo dispositivo (diseño propio)
**Fecha:** 2026-10-30 · **Estado:** vigente

Supabase no ofrece esta función. Diseño:
- El navegador genera un token aleatorio de 256 bits (`localStorage`); el servidor guarda solo su SHA-256.
- Cada sesión de Supabase (claim `session_id` del JWT) se registra en `private.session_guards`.
  Mientras no esté verificada, `current_account_id()` devuelve NULL y RLS bloquea todos los datos.
- Un dispositivo desconocido se verifica con un código de 6 dígitos enviado por correo
  (Edge Function `send-device-code`): vigencia 10 min, máximo 5 intentos, un solo uso,
  un código nuevo invalida el anterior, máximo 5 códigos por hora y usuario.
- El código se genera en PostgreSQL y solo se almacena su hash con sal; la Edge Function lo envía y lo descarta.
- La verificación está ligada al navegador que inició la sesión (`DEVICE_MISMATCH` en otro).
- Conocer una IP no basta: la confianza depende del token del dispositivo más el control del correo.

**Compromiso aceptado:** al registrarse, el usuario recibe dos correos (confirmación de cuenta y código del
primer dispositivo). Se prefirió no tratar el enlace de confirmación como prueba de dispositivo porque
puede abrirse en otro equipo.

**Limitación:** si el usuario borra los datos del navegador, se le pedirá verificar otra vez.

## D-005 · Expiración por inactividad validada en el servidor
**Fecha:** 2026-10-30 · **Estado:** vigente

El timeout de sesión nativo de Supabase es una función de pago. Se implementa con
`session_guards.last_activity_at` y un límite por tipo de usuario (emprendedor 60 min, administrador 30 min).
El frontend informa actividad (`touch_session`) solo ante interacción real del usuario, como máximo cada
2 minutos, y avisa 5 minutos antes del cierre. Una sesión vencida no se puede revivir: hay que volver a ingresar.

## D-006 · Idempotencia con claves por formulario
**Fecha:** 2026-10-30 · **Estado:** vigente

Cada formulario de operación crítica genera un UUID al abrirse. La RPC llama a `private.idem_begin`:
- primera vez: registra la clave y ejecuta;
- reintento con mismos datos: devuelve la respuesta original sin ejecutar de nuevo;
- misma clave con datos distintos: `IDEMPOTENCY_KEY_REUSED`.

Dos llamadas simultáneas con la misma clave se serializan por el índice único. La idempotencia no
reemplaza la autorización ni la validación.

## D-007 · Auditoría inmutable en esquema privado
**Fecha:** 2026-10-30 · **Estado:** vigente

`private.audit_log` es solo de inserción: triggers bloquean `UPDATE`, `DELETE` y `TRUNCATE` incluso para el
dueño de la base de datos en el flujo normal. No se registran secretos, contraseñas ni códigos.

## D-008 · Representación numérica
**Fecha:** 2026-10-30 · **Estado:** vigente

- Importes en CLP: `bigint` (pesos enteros).
- Cantidades: `numeric` sin redondeo automático (2,5 huevos se guarda como 2,5).
- Costos unitarios: `numeric` de alta precisión; el redondeo a pesos se hace solo al mostrar o al registrar
  un importe monetario, de forma explícita.
- Costo desconocido: `NULL` más un estado (`incompleto` / `provisional`), nunca 0.

## D-009 · Correo con Resend y enlaces `token_hash`
**Fecha:** 2026-10-30 · **Estado:** vigente

- Proveedor: Resend (plan gratuito: 100 correos/día, 3.000/mes; verificado el 2026-10-30).
- Sin dominio verificado, Resend solo envía al correo del dueño de la cuenta de Resend.
- **Actualización 2026-10-30:** el dominio se pospone (ver D-014). Todo lo que depende de él queda en
  configuración.
- Supabase Auth usa Resend vía SMTP; la Edge Function usa la API de Resend.
- Las plantillas usan enlaces con `token_hash` (no el flujo PKCE) para que funcionen aunque el correo se
  abra en otro navegador o dispositivo.
- **Actualización 2026-10-30:** Supabase solo permite editar plantillas con SMTP propio. La app acepta
  también los enlaces de las plantillas por defecto (sesión en el fragmento y `code` PKCE), así que funciona
  sin SMTP. Los tokens se borran de la barra de direcciones al procesarlos (`src/db/authLink.ts`).

## D-010 · Pruebas de base de datos con PGlite
**Fecha:** 2026-10-30 · **Estado:** vigente

PGlite es PostgreSQL real compilado a WebAssembly. Las pruebas aplican las migraciones reales sobre un
stub mínimo del entorno de Supabase (`tests/db/supabase-stub.sql`: roles, `auth.users`, `auth.uid()`,
`auth.jwt()` y los privilegios por defecto de Supabase).

**Limitaciones:** PGlite tiene una sola conexión, por lo que las pruebas de concurrencia real (dos
producciones simultáneas) deben ejecutarse contra `horneando-test`. PGlite usa PostgreSQL 18 y Supabase
PostgreSQL 17: no se deben usar funciones exclusivas de la versión 18.

## D-011 · Administradores y emprendedores son usuarios distintos
**Fecha:** 2026-10-30 · **Estado:** vigente

`private.platform_admins` no tiene políticas ni permisos para clientes: solo se modifica con SQL directo.
Un trigger impide que un usuario sea a la vez administrador y dueño de una cuenta de negocio.

## D-012 · Publicación del frontend para el piloto
**Fecha:** 2026-10-30 · **Estado:** pospuesta (ver D-014)

Los emprendedores del piloto están en otra ubicación. Propuesta: publicar solo el frontend compilado en un
hosting estático gratuito (candidato: Cloudflare Pages) con el dominio `.cl` del usuario. No se expone el
computador de desarrollo ni la base de datos. Esto adelanta lo que la especificación (sección 35) dejaba
para después de validar la primera fase; el usuario lo aprobó en principio el 2026-10-30.

## D-013 · Zona horaria
**Fecha:** 2026-10-30 · **Estado:** vigente

Por defecto `America/Santiago` (identificador IANA), configurable por negocio. Chile continental alterna
UTC-3 (verano) y UTC-4 (invierno); un desfase fijo produciría horas erróneas. Las fechas se guardan como
`timestamptz` (UTC) y se muestran en la zona del negocio.

## D-014 · Dominio pospuesto; preparación para comercializar
**Fecha:** 2026-10-30 · **Estado:** vigente

El usuario decidió no comprar el dominio todavía y dejar la aplicación preparada para venderla o
emprender con ella. La primera fase se usa en `localhost` conectada a Supabase.

**Decisión:**
- Todo lo que depende del dominio (URL de la app, remitente, orígenes permitidos, URLs de redirección)
  se define por configuración. Lista de pasos: `docs/dominio-y-publicacion.md`.
- Marca configurable: `VITE_APP_NAME`, `VITE_SUPPORT_EMAIL` (frontend) y `APP_NAME` (Edge Function).
- No se implementan términos legales, cobros ni facturación sin especificación (regla 9).

## D-015 · Portabilidad a otros PostgreSQL
**Fecha:** 2026-10-30 · **Estado:** vigente

- El SQL obtiene la identidad solo mediante `private.current_user_id()` y `private.current_session_id()`.
  Son el único punto acoplado a Supabase Auth.
- `database/compat/postgres-sin-supabase.sql` provee el mismo contrato (roles, `auth.users`, `auth.uid()`,
  `auth.jwt()`) en cualquier PostgreSQL 15+. Es la misma capa que usan las pruebas.
- Las pruebas de base de datos corren con PGlite por defecto o contra un servidor real con
  `TEST_DATABASE_URL`. La CI las ejecuta en PostgreSQL 15, 16 y 17.
- En el frontend, solo `src/db/api.ts` usa el SDK de Supabase. Otro backend reimplementa ese archivo.
- La migración inicial se editó en lugar de crear una nueva porque aún no se había aplicado en ningún
  entorno. Desde su primera aplicación en Supabase, las migraciones son inmutables.

Detalle: `docs/portabilidad-postgresql.md`.

## D-016 · Código de dispositivo en desarrollo sin correo
**Fecha:** 2026-10-30 · **Estado:** vigente

Sin dominio, Resend no puede enviar a cualquier dirección. Para usar la app en `localhost` se agregó
`npm run codigo-dispositivo -- <correo>`, que llama a `issue_device_challenge` con la clave secreta del
proyecto de **pruebas** y muestra el código en la terminal.

No debilita la seguridad: la clave secreta ya otorga acceso total a ese proyecto, y la verificación sigue
siendo obligatoria. El script se niega a operar si la app apunta a un proyecto distinto del de pruebas.
La clave secreta de producción nunca debe estar en el equipo de desarrollo.
