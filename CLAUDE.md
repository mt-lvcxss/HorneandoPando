# CLAUDE.md — Plataforma de gestión gastronómica

Este archivo es el contexto maestro del proyecto. Léelo completo antes de cualquier acción.
La especificación detallada está en `prompt_completo.md`.

---

## Qué es este proyecto

Una plataforma web para que emprendedores gastronómicos administren recetas, ingredientes,
compras, inventario, costos, producción, pedidos, ventas, pagos, clientes, devoluciones
y resultados operacionales desde un mismo sistema.

**Moneda:** peso chileno (CLP).
**Primera fase:** local con Supabase como backend gestionado.

---

## Reglas no negociables

1. La aplicación debe estar conectada a una base de datos real. Sin datos simulados.
2. Una misma operación no puede registrarse dos veces por reintento, doble clic o reconexión.
3. Los registros históricos confirmados no se modifican silenciosamente.
4. Las correcciones crean movimientos nuevos relacionados — nunca borran el original.
5. Las simulaciones no alteran inventario, pagos, ventas ni datos operacionales.
6. Los datos de un emprendedor nunca son accesibles para otra cuenta.
7. Las operaciones críticas se validan en el servidor y se ejecutan de forma atómica.
8. No inventar operaciones, costos, conversiones o movimientos para completar datos faltantes.
9. No implementar reglas comerciales o legales que no estén especificadas.
10. Un costo desconocido nunca se interpreta como cero ni como ingrediente gratuito.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React + TypeScript + Vite |
| Estilos | CSS modular, responsive, componentes reutilizables |
| PWA | Service Worker, instalable |
| Base de datos | PostgreSQL vía Supabase |
| Autenticación | Supabase Auth |
| Migraciones | SQL versionado en `supabase/migrations/` |
| Pruebas | Vitest (unit), Playwright (e2e) |
| CI/CD | GitHub Actions |

---

## Arquitectura: monolito modular

```
src/
├── auth/           — autenticación y sesiones
├── modules/
│   ├── ingredients/    — ingredientes, presentaciones, catálogo
│   ├── purchases/      — compras, cargos adicionales
│   ├── inventory/      — movimientos, envases, stock
│   ├── recipes/        — recetas y versiones
│   ├── simulations/    — simulaciones (sin efecto real)
│   ├── production/     — producción real, consumos
│   ├── finished/       — productos terminados (configurable)
│   ├── orders/         — pedidos, entregas parciales
│   ├── sales/          — ventas directas
│   ├── customers/      — clientes opcionales
│   ├── payments/       — pagos, saldos, créditos
│   ├── returns/        — devoluciones y reclamos
│   ├── costs/          — gastos generales
│   ├── reports/        — informes y exportaciones
│   └── settings/       — configuración del negocio
├── admin/          — panel administrativo separado
├── shared/         — componentes, utilidades, tipos compartidos
└── db/             — cliente Supabase, helpers de acceso a datos

supabase/
├── migrations/     — SQL versionado
└── functions/      — Edge Functions para operaciones críticas
```

---

## Seguridad obligatoria

- **Row Level Security (RLS)** en todas las tablas accesibles por clientes.
- Políticas que verifican `auth.uid()` contra el `account_id` del registro.
- No confiar en `account_id` enviado desde el navegador sin validarlo en el servidor.
- La clave `service_role` de Supabase nunca va al frontend.
- Secretos solo en variables de entorno (`.env.local`, nunca en el repositorio).
- Sesiones expiran: 30 min (admin), 60 min (emprendedor).

---

## Integridad transaccional

Estas operaciones deben ser **atómicas** (transacción completa o nada):

- Confirmar producción → descontar ingredientes por envase.
- Confirmar compra → aumentar inventario.
- Confirmar entrega → registrar venta correspondiente.
- Registrar devolución → crear movimientos asociados.
- Aplicar crédito → actualizar saldo del crédito.
- Confirmar pago → actualizar saldo del pedido.

Usar transacciones PostgreSQL, restricciones y control de concurrencia.
Implementar **claves de idempotencia** para evitar duplicaciones por reintentos.

---

## Módulos y entidades principales

### Inventario
- Ingrediente → Presentación → Envase (unidad física de compra)
- Cada envase conserva: compra origen, precio, cantidad inicial, saldo, movimientos.
- Tipos de movimiento: compra, entrada manual, consumo por producción, ajuste, merma,
  devolución a proveedor, reversión/corrección.

### Recetas
- Receta → Versiones (historial inmutable).
- Versión vigente propuesta automáticamente; editable por el usuario.
- Una producción confirmada conserva la versión usada para siempre.

### Costos
- Distinguir: costo teórico / estimado / histórico / corregido / reposición.
- Ingredientes sin costo conocido: permitir operación con advertencia, marcar como incompleto.
- Nunca sustituir silenciosamente un tipo de costo por otro.

### Pedidos y entregas
- Pedido ≠ Venta. La venta se genera al confirmar una entrega.
- Entregas parciales permitidas. Cada entrega genera su venta.
- Reservas: solo al iniciar preparación, no al crear el pedido.

### Pagos y créditos
- Anticipo recibido antes de entrega = dinero recibido, no ingreso por venta.
- Créditos: identificador único, saldo disponible, historial de aplicaciones, vencimiento opcional.
- Reembolsos: movimiento nuevo vinculado al pago original. Nunca modificar el pago inicial.

---

## Configuración por negocio (toggleable)

- **Seguimiento de productos terminados:** cuando está deshabilitado, se conserva historial
  pero no se mantiene saldo operacional ni se crean reservas.
- **Criterio de costo de reposición:** precio de compra más reciente / menor costo comparable.
- **Distribución de cargos adicionales:** por valor de compra / por cantidad física.
- **Política de anticipos y cancelaciones:** configurable, con historial de versiones.

---

## Orden de trabajo — Etapas

Lee la sección 38 de `prompt_completo.md` para el detalle completo.

| Etapa | Contenido |
|-------|-----------|
| 1 | Inspección del entorno y plan técnico |
| 2 | Fundamentos: estructura, Supabase, auth, RLS, auditoría |
| 3 | Núcleo operacional: ingredientes, compras, inventario, recetas, producción |
| 4 | Gestión comercial: pedidos, ventas, pagos, créditos, devoluciones |
| 5 | Informes, exportaciones, configuración, ayuda, onboarding |
| 6 | Panel admin, auditoría, inactividad, respaldos |
| 7 | Integración, pruebas de concurrencia, seguridad, recorridos completos |
| 8 | Entrega: documentación, migraciones, instrucciones, limitaciones |

**Instrucción de inicio:** Comienza siempre por la Etapa 1. No escribas código hasta
presentar el plan técnico y esperar confirmación.

---

## Criterios de aceptación mínimos

Antes de considerar lista cualquier etapa:

- [ ] Los datos se persisten realmente en Supabase.
- [ ] Las cuentas están aisladas (prueba cruzada entre cuentas).
- [ ] Las operaciones críticas son atómicas.
- [ ] No existen deducciones duplicadas ni saldos negativos por operaciones inválidas.
- [ ] Los movimientos se reconcilian con los saldos derivados.
- [ ] Los errores conocidos están documentados con impacto y riesgo.

Los fallos críticos de seguridad, dinero e inventario **bloquean** el avance a la siguiente etapa.

---

## Fuera de alcance — Primera versión

No desarrollar: app nativa iOS/Android, múltiples empleados por negocio, pasarelas de pago,
integración tributaria, importación masiva desde Excel/CSV, exportación PDF,
sustitución automática de ingredientes, contabilidad formal.

---

## Archivos de referencia

- `prompt_completo.md` — especificación funcional completa (40 secciones), ubicada en la raíz del proyecto.
- `.env.example` — variables de entorno requeridas sin valores reales.
- `supabase/migrations/` — migraciones SQL versionadas.
- `docs/decisiones.md` — decisiones técnicas documentadas (crear si no existe).
