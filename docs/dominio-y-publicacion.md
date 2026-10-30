# Dominio, publicación y preparación comercial

Hoy la aplicación funciona en `localhost` sin dominio. Todo lo que depende del dominio está en
configuración, de modo que adoptarlo no requiere cambiar código.

## Qué cambia al tener dominio (lista de verificación)

Suponiendo un dominio `tudominio.cl` y la app en `app.tudominio.cl`:

| # | Dónde | Qué configurar |
|---|---|---|
| 1 | Registrador (p. ej. NIC Chile) | Comprar el dominio. El nombre no se puede cambiar después. |
| 2 | Resend → Domains | Agregar `tudominio.cl` y crear los registros DNS que indique (SPF, DKIM y opcionalmente DMARC). |
| 3 | Hosting estático (p. ej. Cloudflare Pages) | Publicar la carpeta `dist/` (`npm run build`) y asociar `app.tudominio.cl`. HTTPS lo entrega el hosting. |
| 4 | Variables del build | `VITE_APP_URL=https://app.tudominio.cl` y las de Supabase de **producción**. |
| 5 | Supabase → Authentication → URL Configuration | *Site URL* = `https://app.tudominio.cl`; *Redirect URLs* = `/auth/confirmado` y `/auth/restablecer` en ese dominio. |
| 6 | Supabase → Authentication → SMTP | Remitente `no-responder@tudominio.cl` (ver `configuracion-supabase.md`). |
| 7 | Secretos de la Edge Function | `EMAIL_FROM="<Marca> <no-responder@tudominio.cl>"`, `ALLOWED_ORIGINS=https://app.tudominio.cl`, `APP_NAME`. |
| 8 | Hosting | Redirigir todas las rutas a `index.html` (aplicación de una sola página). |

Sin dominio verificado, Resend solo entrega correos a la dirección dueña de la cuenta de Resend. Para
desarrollo en localhost esto basta, y además existe `npm run codigo-dispositivo` (solo proyecto de pruebas).

## Preparación para vender o emprender con la aplicación

### Ya preparado
- **Multiempresa:** cada emprendedor es una cuenta aislada a nivel de base de datos (RLS más claves
  compuestas), con pruebas que lo demuestran.
- **Marca configurable:** nombre (`VITE_APP_NAME`, `APP_NAME`) y correo de soporte (`VITE_SUPPORT_EMAIL`)
  sin tocar el código. Las plantillas de correo de Supabase Auth (`supabase/templates/`) se editan como
  texto si cambia la marca.
- **Despliegue por configuración:** ninguna URL, dominio ni clave está fija en el código.
- **Sin dependencia exclusiva del proveedor:** ver `portabilidad-postgresql.md`.
- **Auditoría y trazabilidad:** base para responder a clientes y auditorías.
- **Separación de entornos:** pruebas y producción en proyectos distintos.

### Pendiente antes de cobrar a terceros (fuera del alcance técnico actual)
Estas decisiones no se implementan sin especificación (regla 9 del proyecto):
- Términos y condiciones, política de privacidad y tratamiento de datos personales (Chile: Ley 19.628 y su
  reforma por la Ley 21.719). Requiere asesoría legal.
- Modelo de cobro (suscripción, licencia, instalación propia por cliente) y pasarela de pagos (fuera de
  alcance de la primera versión).
- Plan de infraestructura pagado: el plan gratuito de Supabase pausa proyectos inactivos y no incluye
  respaldos descargables.
- Soporte: canal de contacto y tiempos de respuesta.
- Facturación electrónica (SII), si corresponde al modelo de negocio.

### Modalidades posibles
| Modalidad | Qué implica técnicamente |
|---|---|
| **Servicio en la nube (SaaS)**: una instalación, muchos emprendedores | Es el diseño actual. Requiere plan pagado y respaldos. |
| **Instalación por cliente**: cada cliente con su propia base | Desplegar el mismo código con otra configuración y otro proyecto o PostgreSQL. |
| **Marca blanca**: otro nombre comercial | Variables de marca más plantillas de correo e ícono (`public/icono.svg`). |
