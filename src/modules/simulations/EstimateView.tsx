import type { Estimate, EstimateLine, Unit } from '../../db/api';
import { formatCLP, formatDate, formatQuantity } from '../../shared/format';
import { Alert, Badge, Table, uiClasses } from '../../shared/ui';
import { formatAmount, formatBaseAmount } from '../ingredients/catalog';
import type { CatalogIndex } from '../inventory/inventory';

export const STATUS_LABEL = { complete: 'Completo', provisional: 'Provisional', incomplete: 'Incompleto' } as const;

const WARNING_TEXT = {
  shortage: 'Falta inventario de algunos ingredientes. En una producción real habría que comprar o corregir el stock antes.',
  unknown_ingredient_cost: 'Hay ingredientes sin costo conocido (o faltantes): el costo mostrado no los incluye. No se cuentan como $0.',
  provisional_cost: 'Parte del costo se calculó con costos provisionales, no con precios verificables.',
  labor_missing: 'No registraste mano de obra: el resultado la excluye.',
} as const;

const EXTRA_LABEL = { packaging: 'Envases y embalajes', label: 'Etiquetas', presentation: 'Presentación', other: 'Otro' } as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <Badge tone={status === 'complete' ? 'success' : 'warning'}>{STATUS_LABEL[status]}</Badge>;
}

function lineCost(l: EstimateLine) {
  if (l.cost_status === 'incomplete') {
    return Number(l.known_cost) > 0 ? `${formatCLP(l.known_cost)} + sin costo` : 'Sin costo';
  }
  return formatCLP(l.known_cost);
}

type Props = {
  estimate: Estimate;
  units: Unit[];
  index: CatalogIndex | null;
  /** Oculta la mano de obra, extras y precio (vista de costo teórico de la receta). */
  ingredientsOnly?: boolean;
};

export function EstimateView({ estimate, units, index, ingredientsOnly }: Props) {
  const warnings = estimate.warnings.filter((w) => !ingredientsOnly || w !== 'labor_missing');
  const ingredientsStatus = estimate.lines.some((l) => l.cost_status === 'incomplete')
    ? 'incomplete'
    : estimate.lines.some((l) => l.cost_status === 'provisional')
      ? 'provisional'
      : 'complete';
  const shownCost = ingredientsOnly ? estimate.ingredients_cost : estimate.total_cost;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>Ingrediente</th>
            <th className={uiClasses.numeric}>Necesario</th>
            <th>Envases propuestos</th>
            <th className={uiClasses.numeric}>Faltante</th>
            <th className={uiClasses.numeric}>Costo</th>
          </tr>
        </thead>
        <tbody>
          {estimate.lines.map((l) => (
            <tr key={l.line_no}>
              <td>
                {l.ingredient_name} {l.adjusted && <Badge>Ajustado</Badge>}
              </td>
              <td className={uiClasses.numeric}>
                {formatAmount(l.quantity, l.unit)}
              </td>
              <td>
                {l.containers.length === 0
                  ? '—'
                  : l.containers.map((c) => (
                      <div key={c.container_id}>
                        {formatBaseAmount(c.take, l.dimension, units)} de {index?.brand(c.brand_id)?.name ?? 'envase'} ·{' '}
                        {formatDate(c.received_on)} {c.opened ? '(abierto)' : '(cerrado)'}
                        {c.cost_status !== 'known' && (
                          <>
                            {' '}
                            <Badge tone="warning">{c.cost_status === 'unknown' ? 'Sin costo' : 'Provisional'}</Badge>
                          </>
                        )}
                      </div>
                    ))}
              </td>
              <td className={uiClasses.numeric}>
                {Number(l.shortage) > 0 ? <Badge tone="warning">{formatBaseAmount(l.shortage, l.dimension, units)}</Badge> : '—'}
              </td>
              <td className={uiClasses.numeric}>{lineCost(l)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Table>
        <tbody>
          <tr>
            <th>Ingredientes</th>
            <td className={uiClasses.numeric}>{formatCLP(estimate.ingredients_cost)}</td>
          </tr>
          {!ingredientsOnly && (
            <>
              <tr>
                <th>Mano de obra</th>
                <td className={uiClasses.numeric}>
                  {estimate.labor
                    ? `${formatCLP(estimate.labor.total)}${estimate.labor.mode === 'per_unit' ? ` (${formatCLP(estimate.labor.amount_clp)} por unidad)` : ''}`
                    : 'No registrada'}
                </td>
              </tr>
              {estimate.extras.map((x, i) => (
                <tr key={i}>
                  <th>
                    {EXTRA_LABEL[x.kind]}: {x.description}
                  </th>
                  <td className={uiClasses.numeric}>{formatCLP(x.amount_clp)}</td>
                </tr>
              ))}
            </>
          )}
          <tr>
            <th>
              {ingredientsOnly ? 'Costo de ingredientes' : 'Costo total'}{' '}
              <StatusBadge status={ingredientsOnly ? ingredientsStatus : estimate.cost_status} />
            </th>
            <td className={uiClasses.numeric}>
              <strong>{formatCLP(shownCost)}</strong>
            </td>
          </tr>
          <tr>
            <th>
              Costo unitario (÷ {formatQuantity(estimate.desired_yield)} {estimate.yield_unit})
            </th>
            <td className={uiClasses.numeric}>
              {formatCLP(shownCost / estimate.desired_yield)}
            </td>
          </tr>
          {!ingredientsOnly && estimate.pricing && (
            <tr>
              <th>
                Precio sugerido (
                {estimate.pricing.method === 'percentage'
                  ? `${formatQuantity(estimate.pricing.value)} % sobre el costo`
                  : `${formatCLP(estimate.pricing.value)} sobre el costo`}
                )
              </th>
              <td className={uiClasses.numeric}>
                <strong>{formatCLP(estimate.pricing.price)}</strong>
                <br />
                <span className={uiClasses.muted}>{formatCLP(estimate.pricing.unit_price)} por unidad</span>
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      {warnings.length > 0 && (
        <Alert tone="warning" title="Ten en cuenta">
          <ul>
            {warnings.map((w) => (
              <li key={w}>{WARNING_TEXT[w]}</li>
            ))}
          </ul>
          {!ingredientsOnly && estimate.pricing && estimate.cost_status !== 'complete' && (
            <p>El precio sugerido se calculó sobre un costo {STATUS_LABEL[estimate.cost_status].toLowerCase()}.</p>
          )}
        </Alert>
      )}
    </>
  );
}
