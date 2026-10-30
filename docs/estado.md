# Estado del proyecto

Actualizado: 2026-10-30.

================================================================================

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

### Cierre de la Etapa 2 — ✅ cerrada el 2026-10-30
| Pendiente | Bloqueado por |
|---|---|
| ~~Aplicar la migración en el proyecto de pruebas~~ | ✅ Aplicada (2026-10-30, proyecto `gntapzufmayphesvpzxn`) |
| Desplegar `send-device-code` y probar el correo real | Cuenta Resend + API key (usuario). Mientras tanto: `npm run codigo-dispositivo` |
| ~~Ejecutar `npm run test:integration` contra Supabase real~~ | ✅ 5/5 pasan (2026-10-30) |
| ~~Configurar en el panel: Site URL y Redirect URLs~~ | ✅ Hecho por el usuario |
| Plantillas de correo en español | Requieren SMTP propio (Resend). La app ya funciona con las plantillas por defecto |
| ~~Recorrido manual completo en el navegador~~ | ✅ Registro, confirmación, verificación de dispositivo y datos del negocio funcionan y persisten (2026-10-30) |

================================================================================

## Etapa 3 · Núcleo operacional — en curso

Plan confirmado: `docs/plan-etapa-3.md` (decisiones D-017 a D-026).

| Subetapa | Estado |
|---|---|
| 3.1 Catálogo y configuración | ✅ Cerrada (commit 57020e4) |
| 3.2 Compras e inventario por envase | ✅ Cerrada (commit b567382) |
| 3.3 Recetas y versiones | ✅ Cerrada (commit e9e3fac) |
| 3.4 Simulaciones | ✅ Cerrada (recorrido en el navegador aprobado por el usuario) |
| 3.5 Producción real y costos | Pendiente |
| 3.6 Productos terminados y gastos generales | Pendiente |
| 3.7 Cierre de la etapa | Pendiente |

### 3.1 · Qué incluye
- Unidades de medida (g, kg, ml, l, unidad) en tres dimensiones, con conversión automática dentro de cada una.
- Ingrediente → Marca → Presentación: el ingrediente es lo que piden las recetas; cada uno tiene varias marcas y
  cada marca sus envases y tamaños. Archivado y restauración en los tres niveles.
- Presentaciones: envase, contenido, precio de referencia con fecha (nunca $0).
- Equivalencias entre dimensiones por ingrediente: inmutables, con historial y conversión según la fecha.
- Configuración de la operación: productos terminados (desactivado por defecto) y distribución de cargos.
- Pantallas: `/ingredientes`, `/ingredientes/:id`, `/configuracion/operacion`.

================================================================================

### 3.2 · Qué incluye
- Compras con varios productos, contenido real por envase, precio de lista y pagado, referencia y marca
  "pendiente de verificación". Vista previa antes de confirmar. Cada envase físico queda registrado con su costo.
- Cargos adicionales: gasto separado o distribuido (por valor o por cantidad), sin perder ni duplicar pesos.
- Corrección de recepción: el costo del envase se recalcula sobre lo que realmente llegó (D-022).
- Entrada manual (stock inicial, regalos) con costo conocido, provisional o desconocido; envases abiertos.
- Merma, devolución a proveedor, ajuste de saldo, corrección de recepción y reversión, siempre como movimientos nuevos.
- Conteo físico parcial por envase con confirmación; rechaza conteos desactualizados.
- Disponible visible en ingredientes, inventario y detalle; aviso solo cuando un ingrediente se agota (también en Inicio).
- Pantallas: `/compras`, `/compras/nueva`, `/compras/:id`, `/inventario`, `/inventario/:id`.

================================================================================

### 3.3 · Qué incluye
- Recetas con versiones numeradas e inmutables: principal (reemplaza a la vigente) o alternativa (conserva la base).
- Elegir cualquier versión como vigente; historial completo y comparación entre dos versiones.
- Rendimiento teórico con unidad libre; escalado exacto a otro rendimiento sin modificar la receta.
- Cada ingrediente debe poder convertirse (misma dimensión o equivalencia); un ingrediente archivado no entra en
  versiones nuevas.
- Pantallas: `/recetas`, `/recetas/nueva`, `/recetas/:id`, `/recetas/:id/nueva-version`.

================================================================================

### 3.4 · Qué incluye
- Propuesta de envases según la sección 7.4 (abiertos primero, menos envases abiertos, más antiguo).
- Estimación con escalado exacto, ajustes temporales por ingrediente, faltantes, mano de obra (por producción o por
  unidad), embalajes, etiquetas y otros costos, costo provisional explícito y precio sugerido (20 % o $5.000, editables).
- Costo teórico de cada versión de receta con el inventario actual.
- Simulaciones guardadas como foto inmutable; no tocan inventario ni reservan.
- Pantallas: `/simulaciones`, `/simulaciones/nueva`, `/simulaciones/:id` y costo teórico en `/recetas/:id`.

================================================================================

## Limitaciones y riesgos conocidos

| # | Descripción | Impacto | Riesgo | Plan |
|---|---|---|---|---|
| L-1 | Sin dominio verificado, Resend solo envía al correo del dueño de la cuenta | Otros usuarios no reciben correos | Bajo mientras se use solo en localhost | Dominio pospuesto (D-014); pasos en `dominio-y-publicacion.md` |
| L-2 | El plan gratuito de Supabase pausa proyectos tras ~7 días sin actividad | La app deja de responder hasta reactivarla | Medio | Monitorear; evaluar plan pago tras el piloto |
| L-3 | El plan gratuito no incluye respaldos descargables | Pérdida de datos ante incidente | Alto con datos reales | Respaldo semanal propio vía GitHub Actions **antes de tener usuarios reales** |
| L-4 | Concurrencia real no se puede probar con PGlite | Errores de concurrencia no detectados localmente | Bajo | Inventario cubierto con pruebas contra `horneando-test` (D-021); producción (3.5) agregará las suyas |
| L-5 | Paquete JS de 676 kB | Carga inicial más lenta en móviles | Bajo | División por módulos al crecer la app |
| L-6 | Borrar datos del navegador obliga a verificar el dispositivo otra vez | Molestia menor | Bajo | Documentado en la ayuda |
| L-7 | PWA (instalación y borradores sin conexión) aún no implementada | No instalable todavía | Bajo | Etapa 3–5 |
| L-8 | Usuarios de prueba de integración no se pueden borrar (FK `on delete restrict`) | Basura en el proyecto de pruebas | Bajo | Se bloquean al terminar; limpieza manual periódica |
| L-9 | Compatibilidad con PostgreSQL 15/16/17 verificada solo en CI (no hay PostgreSQL en el equipo de desarrollo) | Una incompatibilidad se detectaría al hacer push | Bajo | Revisar el resultado de la CI en el primer push |
| L-10 | Autenticación (registro, correos, contraseñas) depende de Supabase Auth | Cambiar de proveedor requiere reimplementar `authApi` | Medio | Contrato documentado en `portabilidad-postgresql.md` |
| L-11 | Las plantillas de correo de Supabase Auth tienen el nombre "Horneando Pando" escrito | Cambiar de marca requiere editarlas | Bajo | Documentado en `dominio-y-publicacion.md` |
| L-12 | ~~Una corrección de recepción no recalculaba el costo unitario~~ | — | — | ✅ Resuelto: el costo se reparte sobre lo recibido (D-022) |
| L-13 | Los cargos registrados como gasto separado aún no aparecen en ningún informe | No se ven fuera del detalle de la compra | Bajo | Se incluyen con los gastos generales (3.6) |
| L-14 | Los archivos internos excluidos en D-023 siguen en el historial de git (y en `origin`) aunque ya no se versionan | Serían visibles si el repositorio se publica tal cual | Medio antes de la entrega | Reescribir el historial antes de hacerlo público, con confirmación del usuario (D-023) |

================================================================================
