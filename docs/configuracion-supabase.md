# Configuración de Supabase y Resend

Guía paso a paso. Los secretos **nunca** se pegan en el chat, en el código ni en archivos versionados.

## 1. Crear los proyectos

En [supabase.com](https://supabase.com) → *New project* (plan gratuito), dos veces:

| Proyecto | Uso | Región |
|---|---|---|
| `horneando-test` | Desarrollo y pruebas automáticas | South America (São Paulo) |
| `horneando-prod` | Datos reales del piloto | South America (São Paulo) |

Guarda la contraseña de la base de datos de cada uno en el administrador de contraseñas de tu navegador.

## 2. Datos que necesita el desarrollo

De cada proyecto, en *Project Settings → Data API / API Keys*:

- **Project URL** (`https://xxxx.supabase.co`) y **Project ref** (`xxxx`): no son secretos.
- **Clave publicable** (`sb_publishable_...` o `anon`): pública por diseño, protegida por RLS.
- **Clave secreta** (`sb_secret_...` o `service_role`): solo la del proyecto de **pruebas**, solo en
  `.env.test.local`. Nunca en el frontend.

La forma más simple de crearlos es el asistente, **en tu propia terminal** (no con `!` en Claude Code,
para que las claves no queden en la conversación):

```
npm run configurar
npm run verificar
```

O manualmente, archivos locales ignorados por git:

```
# .env.local  → el frontend en desarrollo apunta al proyecto de pruebas
VITE_SUPABASE_URL=https://<ref-test>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_APP_URL=http://localhost:5173

# .env.test.local  → pruebas de integración
TEST_SUPABASE_URL=https://<ref-test>.supabase.co
TEST_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TEST_SUPABASE_SECRET_KEY=sb_secret_...
```

## 3. Vincular y aplicar migraciones

En la terminal de Claude Code (el prefijo `!` ejecuta el comando en la sesión):

```
! npx supabase login
! npx supabase link --project-ref <ref-test>
! npx supabase db push
```

`link` pedirá la contraseña de la base de datos. Para producción se repite con `<ref-prod>` solo
cuando una etapa esté validada en pruebas.

## 4. Autenticación (panel de Supabase → Authentication)

**URL Configuration**
- *Site URL*: `http://localhost:5173` (pruebas) o la URL pública (producción).
- *Redirect URLs*: `<site>/auth/confirmado` y `<site>/auth/restablecer`.

**Providers → Email**
- *Confirm email*: activado.
- *Secure password change*: activado.
- *Minimum password length*: 8, con letras y números.

**Email Templates** — *opcional; Supabase solo permite editarlas con un SMTP propio configurado.*
Sin SMTP la app funciona igual con las plantillas por defecto (en inglés): reconoce sus enlaces.
Cuando configures Resend, copia el contenido de `supabase/templates/` para tener los correos en español:
- *Confirm signup* → `confirmacion.html` (asunto: "Confirma tu cuenta").
- *Reset password* → `recuperacion.html` (asunto: "Restablece tu contraseña").
- *Password changed* (notificación) → `contrasena_cambiada.html`.

**SMTP Settings** (cuando Resend esté listo):
- Host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = API key de Resend.
- Remitente: una dirección del dominio verificado (p. ej. `no-responder@tudominio.cl`).
- Luego, en *Rate Limits*, subir el límite de correos por hora (por defecto es muy bajo).

## 5. Resend

1. Crear cuenta en [resend.com](https://resend.com) (plan gratuito: 100 correos/día, 3.000/mes).
2. *Domains → Add domain* con tu dominio `.cl` y agregar los registros DNS que indica Resend.
   Sin dominio verificado solo se puede enviar a tu propio correo (suficiente para pruebas individuales).
3. *API Keys → Create*: permiso solo de envío.

## 6. Edge Function `send-device-code`

```
! npx supabase secrets set APP_NAME="Horneando Pando" EMAIL_FROM="Horneando Pando <onboarding@resend.dev>" ALLOWED_ORIGINS=http://localhost:5173
npx supabase secrets set RESEND_API_KEY=<api-key>      # este, en tu propia terminal
! npx supabase functions deploy send-device-code
```

`ALLOWED_ORIGINS` admite varias URL separadas por coma (local y pública). Sin dominio propio,
`onboarding@resend.dev` solo entrega a tu correo de Resend. Con dominio, usa `no-responder@tudominio.cl`.

**Sin Resend (desarrollo):** `npm run codigo-dispositivo -- <correo>` muestra el código en la terminal
(requiere `.env.test.local`; solo proyecto de pruebas).

## 7. Administrador de la plataforma

El panel de administración llega en la Etapa 6. Para designar un administrador (un usuario distinto de
cualquier emprendedor), en *SQL Editor*:

```sql
insert into private.platform_admins (user_id, note)
values ('<uuid del usuario>', 'Administrador principal');
```
