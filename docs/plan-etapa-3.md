# Plan técnico · Etapa 3 · Núcleo operacional

Estado: **confirmado** (2026-10-30). Respuestas a las preguntas abiertas: D-017 en `decisiones.md`. Ajustes posteriores del usuario: D-019
(sin stock mínimo ni costo de reposición; aviso solo al agotarse un ingrediente) y D-020 (Ingrediente → Marca → Presentación).
Referencias: secciones 6–11 de `prompt_completo.md`; decisiones D-002, D-003, D-006, D-008.

================================================================================

## 1. Principios que se aplican a toda la etapa

- **Toda operación que mueve inventario o costos es una RPC PL/pgSQL** (`SECURITY DEFINER`, `search_path = ''`,
  `private.require_account_id()`, clave de idempotencia). El navegador no escribe en tablas de movimientos ni de envases.
- **Movimientos inmutables**: `private.forbid_mutation()` en `UPDATE`/`DELETE`. Las correcciones son movimientos
  nuevos con `reverses_movement_id` / `corrects_id` apuntando al original.
- **Saldo del envase = suma de sus movimientos.** Se guarda en `containers.balance` para leerlo rápido, con
  `check (balance >= 0)`, y una función `private.reconcile_inventory(account)` que compara ambos. Las pruebas la
  ejecutan después de cada operación.
- **Concurrencia**: la RPC de producción bloquea solo los envases que va a consumir (`select … for update`,
  ordenados por `id` para evitar interbloqueos), revalida el saldo dentro de la transacción y falla con
  `INSUFFICIENT_STOCK` si cambió. No hay bloqueos globales por cuenta.
- **Costos**: importes CLP en `bigint`; costo unitario en `numeric`; costo desconocido = `NULL` + estado
  (`known` / `provisional` / `unknown`), nunca 0. Cada valoración guarda su tipo (teórico, estimado, histórico,
  corregido) y nunca se sustituye uno por otro sin mostrarlo.
- **Una sola fuente de cálculo**: escalado de recetas, propuesta de envases y costo se calculan en SQL
  (funciones `stable`, sin efectos). La simulación y la producción usan exactamente las mismas funciones.
- Toda tabla nueva: `account_id` + RLS + trigger `enforce_account_id` + FK compuestas `(account_id, id)` (D-003).

================================================================================

## 2. Subetapas

Cada subetapa entrega: migración SQL versionada → pruebas de base de datos (PGlite) → pantallas → recorrido
manual. Me detengo al final de cada una para que la revises en el navegador antes de seguir.

### 3.1 · Catálogo y configuración
- **Unidades**: tres dimensiones (masa `g`, volumen `ml`, conteo `unidad`) con conversiones fijas dentro de cada
  dimensión (kg→g, l→ml, etc.). Conversiones entre dimensiones (p. ej. 1 huevo ≈ 50 g) solo mediante una
  **equivalencia definida o confirmada por el usuario**, por ingrediente, versionada (cambiarla no altera el pasado).
- **Ingredientes**: producto genérico que piden las recetas, unidad base, notas, estado (activo/archivado).
- **Marcas**: varias por ingrediente, con nombre único entre las activas del mismo ingrediente.
- **Presentaciones**: envase y tamaño de una marca, cantidad + unidad, precio de referencia opcional.
- **Configuración del negocio** (`account_settings`, con historial de cambios): seguimiento de productos
  terminados y criterio por defecto para distribuir cargos adicionales.
- Pantallas: lista y detalle de ingredientes, presentaciones, configuración.

### 3.2 · Compras e inventario por envase
- **Compra** (`confirm_purchase`): líneas con presentación, número de envases, precio de lista, precio pagado,
  cantidad incorporada, fecha, referencia libre. Crea un **envase por unidad física** y su movimiento `purchase`.
  Estado opcional “pendiente de verificación” sin bloquear el stock.
- **Cargos adicionales**: gasto separado o distribuido (por valor o por cantidad física cuando las unidades son
  comparables). Vista previa (`preview_charge_distribution`, sin efectos) antes de confirmar. Se guarda el cargo,
  el método y cada asignación; restricción que impide asignar más que el importe del cargo. Por cargo: regla para envases parcialmente consumidos (proporcional al consumo o
  íntegro en el primer uso).
- **Movimientos**: entrada manual (con o sin costo conocido), ajuste (guarda saldo anterior y nuevo), merma,
  devolución a proveedor (con o sin compra asociada), corrección de cantidad recibida, reversión.
- **Conteo físico**: por envase, parcial, vista consolidada por ingrediente; muestra la diferencia y pide
  confirmación antes de crear el ajuste.
- **Cantidad disponible siempre visible** por ingrediente (lista, detalle y selección en recetas y producción).
- **Aviso de ingrediente agotado**: uno abierto por ingrediente (índice único parcial); se cierra al volver a haber
  stock; si se agota de nuevo se crea otro y se conserva el historial.
- Pantallas: nueva compra, historial de compras, inventario por ingrediente y por envase, movimientos, conteo, avisos.

### 3.3 · Recetas y versiones
- `recipes` → `recipe_versions` (inmutables una vez creadas) → `recipe_version_items`.
- Versión **vigente** (puntero en la receta) y versiones **alternativas**. Editar = crear versión nueva.
- Rendimiento teórico + unidad; instrucciones opcionales; estado (activa/archivada).
- Escalado automático por rendimiento deseado **sin redondeo** (2,5 huevos se muestra como 2,5) y ajuste manual.
- **Costo teórico** por versión con los costos conocidos de los envases; si falta un costo, se marca incompleto y se
  permite un costo provisional explícito (puntual o guardado). Nunca se interpreta como 0.
- Pantallas: lista, editor (genera versión), historial y comparación de versiones.

### 3.4 · Simulaciones y propuesta de envases
- `propose_allocation(version, cantidades)`: abiertos primero, luego cerrados, mínimo de envases abiertos a la vez,
  más antiguo primero en empate. Devuelve faltantes en vez de fallar.
- **Simulación** guardada como referencia: versión, cantidades, ajustes, envases propuestos, faltantes, costos
  estimados (ingredientes, mano de obra, embalajes, otros), advertencias de costo incompleto. No toca inventario.
- Precio sugerido si se solicita (ver pregunta P-4).
- Pantallas: nueva simulación, detalle, historial, “producir desde esta simulación”.

### 3.5 · Producción real y costos
- Asistente: receta/versión (o simulación) → cantidades → propuesta de envases editable → costo recalculado →
  verificación de stock → confirmación.
- `confirm_production`: dentro de una transacción, con idempotencia: bloquea los envases, valida que la asignación
  cubra la necesidad y que ningún envase quede negativo ni mezcle unidades sin equivalencia, crea la producción,
  los consumos por envase (con el costo unitario de ese momento) y los movimientos `production_consumption`.
  Stock insuficiente → bloqueo con opciones “ir a inventario” / “elegir otra receta”.
- Desde una simulación: revalida, recalcula la propuesta y guarda las diferencias con la simulación original.
- Mano de obra por producción o por unidad (elegido por el usuario); embalajes y otros costos como líneas.
  Lo no registrado se marca incompleto con advertencia.
- **Valoración histórica** inmutable + **revaloraciones** (`production_valuations`): original, corregida, fecha,
  motivo. Al registrar precios nuevos se listan producciones potencialmente afectadas; el usuario elige cuáles
  revalorar. Solo con precios históricos verificables o un costo provisional explícito, rotulado como tal.
- Anulación de una producción confirmada = movimientos de reversión (no se borra).

### 3.6 · Productos terminados y gastos generales
- Si el seguimiento está **habilitado**: lote por producción con rendimiento real, unidades disponibles, mermas y
  otras salidas justificadas; destino de sobrantes con confirmación. Las **reservas** se crean en la Etapa 4
  (al iniciar preparación de un pedido); aquí queda listo el modelo.
- Si está **deshabilitado**: se guarda la producción y su rendimiento, sin saldo operacional, y se advierte que no
  se conoce la disponibilidad. No se muestra costo unitario real si no se conoce el rendimiento.
- **Gastos generales** (sección 9.5): descripción, importe CLP, fecha, categoría. No se reparten en las recetas.

### 3.7 · Cierre de la etapa
- Pruebas de concurrencia contra `horneando-test` (resuelve L-4): dos sesiones producen a la vez sobre el mismo
  envase; doble envío con la misma clave; reintento tras corte de red.
- Reconciliación de todos los saldos, prueba cruzada entre cuentas para cada tabla nueva.
- División del paquete JS por rutas (L-5).
- Actualizar `estado.md`, `decisiones.md` y limitaciones.

================================================================================

## 3. Pruebas

| Tipo | Qué cubre |
|---|---|
| Base de datos (PGlite) | Cada RPC: caso válido, validaciones, idempotencia, inmutabilidad, aislamiento entre cuentas, reconciliación |
| Unitarias (Vitest) | Formato de cantidades y CLP, formularios, estados de advertencia |
| Integración (Supabase real) | Concurrencia, RLS real, flujo compra → producción |
| Humo / e2e | Recorrido principal en el navegador |

Invariantes verificados en todas las pruebas: ningún saldo negativo; saldo = suma de movimientos; ningún cargo
asignado por encima de su importe; ningún costo desconocido tratado como 0.

================================================================================

## 4. Fuera de esta etapa

Reservas y pedidos (Etapa 4); informes y exportaciones (Etapa 5); sustitución automática de ingredientes;
subrecetas (una receta dentro de otra, no especificada); cálculo de mano de obra por horas × tarifa; PWA (L-7).

================================================================================

## 5. Preguntas abiertas

- **P-1 · Unidades**: ¿aceptas el modelo de tres dimensiones con conversión entre dimensiones solo por
  equivalencia del usuario?
- **P-2 · Criterios “otros”**: la especificación permite un “otro criterio” para distribuir cargos y “otra regla
  definida por el usuario” para envases parcialmente consumidos. Propuesta: en esta versión solo las dos opciones
  explícitas de cada caso.
- **P-3 · Embalajes y etiquetas**: ¿líneas de costo ingresadas a mano, o artículos del catálogo con stock?
- **P-4 · Precio sugerido**: ¿cómo se calcula? (p. ej. margen sobre el precio, recargo sobre el costo o ingreso manual).
- **P-5 · Productos terminados**: ¿habilitado o deshabilitado por defecto en cuentas nuevas?

================================================================================
