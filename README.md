# Horneando Pando

**Plataforma web de gestión para emprendimientos gastronómicos.** Reúne en un solo sistema recetas,
ingredientes, compras, inventario, costos, producción, pedidos, ventas, pagos, clientes, devoluciones y
resultados, con datos reales, trazabilidad completa y aislamiento estricto entre negocios.
Moneda: peso chileno (CLP). Interfaz en español, adaptable a computador y teléfono.

> **Estado:** Etapa 2 de 8 (fundamentos) construida y probada localmente. Falta conectarla a un proyecto
> Supabase real. Detalle en [`docs/estado.md`](docs/estado.md).

---

## Funciones

### Disponibles hoy
| Función | Descripción |
|---|---|
| Cuentas de emprendedor | Registro con correo y contraseña, confirmación obligatoria del correo, recuperación de contraseña. |
| Verificación de dispositivo nuevo | Código de 6 dígitos por correo (10 min, un solo uso, máximo 5 intentos). |
| Cierre por inactividad | 60 min para emprendedores y 30 min para administradores, controlado en el servidor, con aviso previo. |
| Aislamiento entre negocios | Cada cuenta solo accede a sus datos, garantizado por la base de datos (RLS). |
| Datos del negocio | Nombre, contacto y zona horaria (por defecto `America/Santiago`). |
| Auditoría | Registro inmutable de acciones importantes. |
| Protección contra duplicados | Base de idempotencia para que un doble clic o una reconexión no registren dos veces. |

### Planificadas (por etapa)
| Etapa | Funciones |
|---|---|
| 3 · Núcleo operacional | Ingredientes y presentaciones, compras con cargos adicionales, inventario por envase, recetas con versiones, simulaciones, producción real atómica, costos, productos terminados. |
| 4 · Gestión comercial | Clientes, pedidos, reservas, entregas parciales, ventas directas, pagos, saldos, créditos, cancelaciones, devoluciones y reclamos. |
| 5 · Informes y configuración | Panel principal, informes, exportación a Excel/CSV, gastos generales, configuración guiada, ayuda, datos de ejemplo. |
| 6 · Administración | Panel administrativo, incidentes, inactividad de cuentas, alertas, respaldos y restauración. |
| 7–8 · Validación y entrega | Recorridos completos, pruebas de concurrencia y seguridad, documentación final. |

Especificación completa: [`prompt_completo.md`](prompt_completo.md).

---

## Arranque rápido (localhost + Supabase)

### Requisitos
- **Node.js 20 o superior** ([nodejs.org](https://nodejs.org)). Se desarrolla con Node 26.
- **Un proyecto de Supabase** (plan gratuito, región São Paulo). No se necesita Docker.
- Opcional: cuenta de **Resend** para enviar correos. Sin dominio propio solo llegan a tu correo.

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar la conexión (asistente; ejecútalo en tu propia terminal)
npm run configurar

# 3. Vincular el proyecto de Supabase y aplicar las migraciones
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push

# 4. Comprobar que todo está bien conectado
npm run verificar

# 5. Iniciar la aplicación
npm run dev          # → http://localhost:5173
```

Luego, en el panel de Supabase, activa la confirmación de correo y copia las plantillas en español
(guía: [`docs/configuracion-supabase.md`](docs/configuracion-supabase.md)).

### Primer ingreso sin correo configurado
1. Regístrate en `http://localhost:5173/registro` con **tu** correo (el dueño del proyecto Supabase recibe
   los correos de confirmación incluso sin SMTP propio, con límite bajo).
2. Al ingresar, la app pide el código de dispositivo. Si Resend aún no está configurado, obtenlo con:
   ```bash
   npm run codigo-dispositivo -- tu@correo.cl
   ```
   Requiere `.env.test.local` con la clave secreta del proyecto de **pruebas**. Nunca la uses con producción.

Sin configuración válida la app muestra una pantalla explicativa: **nunca usa datos simulados**.

---

## Comandos

| Comando | Para qué sirve |
|---|---|
| `npm run dev` | Servidor local en `http://localhost:5173` |
| `npm run dev:lan` | Igual, accesible desde otros dispositivos de tu red (teléfono) |
| `npm run configurar` | Asistente que crea `.env.local` y `.env.test.local` |
| `npm run verificar` | Diagnóstico de conexión, migraciones y seguridad básica |
| `npm run codigo-dispositivo -- <correo>` | Código de verificación en desarrollo (solo proyecto de pruebas) |
| `npm run build` | Compilación de producción en `dist/` |
| `npm test` | Pruebas unitarias y de base de datos (sin conexión externa) |
| `npm run test:db` | Solo seguridad de base de datos (RLS, aislamiento, sesiones, auditoría, idempotencia) |
| `npm run test:integration` | Pruebas contra el proyecto Supabase de pruebas |
| `npm run typecheck` | Verificación de tipos |
| `npm run db:push` | Aplica las migraciones al proyecto vinculado |
| `npm run functions:deploy` | Despliega la función de envío de códigos |

## Variables de entorno

| Variable | Archivo | Descripción |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` | URL del proyecto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local` | Clave **publicable**. La app rechaza claves secretas. |
| `VITE_APP_URL` | `.env.local` | URL de la app (`http://localhost:5173`; luego el dominio) |
| `VITE_APP_NAME` | `.env.local` | Nombre visible del producto (marca configurable) |
| `VITE_SUPPORT_EMAIL` | `.env.local` | Correo de soporte mostrado a usuarios (opcional) |
| `TEST_SUPABASE_*` | `.env.test.local` | Proyecto de pruebas (incluye la clave secreta) |
| `TEST_DATABASE_URL` | entorno | Opcional: pruebas contra un PostgreSQL propio |

Plantillas: [`.env.example`](.env.example) y [`.env.test.example`](.env.test.example). Los archivos
`.env.*.local` nunca se suben al repositorio.

---

## Arquitectura

Monolito modular: **React + TypeScript + Vite** en el navegador y **PostgreSQL** como núcleo de reglas.
Las operaciones críticas son funciones SQL transaccionales (todo o nada), protegidas por RLS e idempotencia.

```
src/
├── db/          api.ts: única capa que conoce Supabase · configuración
├── auth/        sesión, verificación de dispositivo, inactividad, pantallas de acceso
├── app/         layout, protección de rutas, inicio
├── modules/     módulos de negocio (settings disponible)
└── shared/      componentes de interfaz, marca, errores, validación
supabase/
├── migrations/  esquema SQL versionado (PostgreSQL estándar)
├── functions/   Edge Function de envío de códigos (Resend)
└── templates/   correos en español
database/compat/ capa para usar las migraciones en PostgreSQL sin Supabase
scripts/         configurar, verificar, código de desarrollo
tests/           base de datos (PGlite / PostgreSQL) e integración (Supabase)
docs/            decisiones, estado, guías
```

### Flexibilidad de base de datos
El esquema es SQL estándar de **PostgreSQL 15+**, sin extensiones. La CI lo prueba en PostgreSQL 15, 16 y
17, y localmente con PGlite (PostgreSQL 18). Para otros proveedores (Neon, RDS, Cloud SQL, servidor
propio) se usa la capa `database/compat/`. Detalle: [`docs/portabilidad-postgresql.md`](docs/portabilidad-postgresql.md).

### Dominio y uso comercial
Todo lo que depende del dominio (URLs, remitente de correo, orígenes permitidos) y de la marca está en
variables de entorno. Lista de pasos y pendientes comerciales:
[`docs/dominio-y-publicacion.md`](docs/dominio-y-publicacion.md).

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/estado.md`](docs/estado.md) | Avance, pendientes, limitaciones y riesgos conocidos |
| [`docs/decisiones.md`](docs/decisiones.md) | Decisiones técnicas y sus motivos |
| [`docs/configuracion-supabase.md`](docs/configuracion-supabase.md) | Supabase, Resend y Edge Function paso a paso |
| [`docs/portabilidad-postgresql.md`](docs/portabilidad-postgresql.md) | Uso con otros PostgreSQL |
| [`docs/dominio-y-publicacion.md`](docs/dominio-y-publicacion.md) | Dominio, publicación y preparación comercial |
| [`CLAUDE.md`](CLAUDE.md) | Reglas del proyecto para el desarrollo asistido |

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| "Falta configurar la conexión" | Ejecuta `npm run configurar` y reinicia `npm run dev`. |
| `npm run verificar` dice que faltan migraciones | `npx supabase link --project-ref <ref>` y `npx supabase db push`. |
| No llega el correo de confirmación | Sin SMTP propio, Supabase solo envía a miembros del proyecto y con límite bajo. Revisa spam. |
| No llega el código de dispositivo | En desarrollo usa `npm run codigo-dispositivo -- <correo>`. En producción configura Resend. |
| Vuelve a pedir verificar el dispositivo | Se borraron los datos del navegador o es otro navegador; es lo esperado. |
| La app no responde tras días sin uso | El plan gratuito pausa proyectos inactivos: reactívalo en el panel de Supabase. |
