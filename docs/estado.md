# Estado del proyecto

Actualizado: 2026-10-30.

## Etapa 2 · Fundamentos

### Terminado y verificado localmente
| Elemento | Verificación |
|---|---|
| Migración base (`supabase/migrations/20261030120000_fundamentos.sql`) | Se aplica sin errores en PostgreSQL real (PGlite) |
| Aislamiento por cuenta (RLS + trigger + convención de FK compuestas) | 26 pruebas de base de datos |
| Verificación por nuevo dispositivo (código, intentos, uso único, límite) | Pruebas de base de datos |
| Expiración por inactividad en servidor (60 / 30 min) | Pruebas de base de datos + unitarias |
| Idempotencia | Pruebas de base de datos |
| Auditoría inmutable | Pruebas de base de datos |
| Pantallas: ingreso, registro, confirmación, recuperación, nueva contraseña, verificación de dispositivo, datos del negocio | Tipado + compilación + prueba de humo |
| Portabilidad: capa `database/compat/` + identidad aislada en el SQL | Las mismas 26 pruebas corren sobre la capa de compatibilidad |
| Capa de acceso a datos única (`src/db/api.ts`) y marca configurable | Tipado + compilación + pruebas |
| Scripts `configurar`, `verificar`, `codigo-dispositivo` | Asistente y verificador probados sin proyecto real |
| Servidor local (`npm run dev`) | Responde en `http://localhost:5173` |
| CI en GitHub Actions (incluye PostgreSQL 15/16/17) | Configurado (aún no ejecutado en GitHub) |

### Pendiente para cerrar la Etapa 2
| Pendiente | Bloqueado por |
|---|---|
| Aplicar la migración en `horneando-test` | Crear proyecto y vincular (usuario) |
| Desplegar `send-device-code` y probar el correo real | Cuenta Resend + API key (usuario). Mientras tanto: `npm run codigo-dispositivo` |
| Ejecutar `npm run test:integration` contra Supabase real | Credenciales en `.env.test.local` (usuario) |
| Recorrido manual completo en el navegador | Todo lo anterior |

## Limitaciones y riesgos conocidos

| # | Descripción | Impacto | Riesgo | Plan |
|---|---|---|---|---|
| L-1 | Sin dominio verificado, Resend solo envía al correo del dueño de la cuenta | Otros usuarios no reciben correos | Bajo mientras se use solo en localhost | Dominio pospuesto (D-014); pasos en `dominio-y-publicacion.md` |
| L-2 | El plan gratuito de Supabase pausa proyectos tras ~7 días sin actividad | La app deja de responder hasta reactivarla | Medio | Monitorear; evaluar plan pago tras el piloto |
| L-3 | El plan gratuito no incluye respaldos descargables | Pérdida de datos ante incidente | Alto con datos reales | Respaldo semanal propio vía GitHub Actions **antes de tener usuarios reales** |
| L-4 | Concurrencia real no se puede probar con PGlite | Errores de concurrencia no detectados localmente | Medio | Pruebas de concurrencia contra `horneando-test` (Etapa 3) |
| L-5 | Paquete JS de 567 kB | Carga inicial más lenta en móviles | Bajo | División por módulos al crecer la app |
| L-6 | Borrar datos del navegador obliga a verificar el dispositivo otra vez | Molestia menor | Bajo | Documentado en la ayuda |
| L-7 | PWA (instalación y borradores sin conexión) aún no implementada | No instalable todavía | Bajo | Etapa 3–5 |
| L-8 | Usuarios de prueba de integración no se pueden borrar (FK `on delete restrict`) | Basura en el proyecto de pruebas | Bajo | Se bloquean al terminar; limpieza manual periódica |
| L-9 | Compatibilidad con PostgreSQL 15/16/17 verificada solo en CI (no hay PostgreSQL en el equipo de desarrollo) | Una incompatibilidad se detectaría al hacer push | Bajo | Revisar el resultado de la CI en el primer push |
| L-10 | Autenticación (registro, correos, contraseñas) depende de Supabase Auth | Cambiar de proveedor requiere reimplementar `authApi` | Medio | Contrato documentado en `portabilidad-postgresql.md` |
| L-11 | Las plantillas de correo de Supabase Auth tienen el nombre "Horneando Pando" escrito | Cambiar de marca requiere editarlas | Bajo | Documentado en `dominio-y-publicacion.md` |
