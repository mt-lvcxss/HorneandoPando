import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { purchasesApi, type ChargeAllocation, type Purchase, type PurchaseCharge, type PurchaseLine } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, formatDate, formatDateTime } from '../../shared/format';
import { Actions, Alert, Badge, Button, Card, Loading, PageHeader, Stack, Table, uiClasses } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { formatAmount, formatBaseAmount, useUnits } from '../ingredients/catalog';
import { formatUnitCost, useCatalogIndex } from '../inventory/inventory';

type Data = { purchase: Purchase; lines: PurchaseLine[]; charges: PurchaseCharge[]; allocations: ChargeAllocation[] };

const TREATMENT_LABEL = { separate_expense: 'Gasto separado', distributed: 'Distribuido' } as const;
const METHOD_LABEL = { by_value: 'según valor', by_quantity: 'según cantidad' } as const;
const RULE_LABEL = { proportional: 'proporcional al consumo', first_use: 'completo en el primer uso' } as const;

export function PurchaseDetailPage() {
  const { id = '' } = useParams();
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const { units } = useUnits();
  const { index, error: indexError } = useCatalogIndex();
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: e } = await purchasesApi.get(id);
    if (e) return setError(friendlyError(e));
    if (!d) return setNotFound(true);
    setData(d);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <Alert tone="warning" title="Compra no encontrada">
        <p>
          No existe o no pertenece a tu cuenta. <Link to="/compras">Volver a compras</Link>
        </p>
      </Alert>
    );
  }
  if (error || indexError) return <Alert tone="danger">{error ?? indexError}</Alert>;
  if (!data || !index || units.length === 0) return <Loading />;

  const { purchase, lines, charges, allocations } = data;
  const pending = purchase.pending_verification && !purchase.verified_at;
  const allocated = (chargeId: string, lineId: string) =>
    allocations.find((a) => a.charge_id === chargeId && a.purchase_line_id === lineId)?.amount_clp ?? 0;
  const distributed = charges.filter((c) => c.treatment === 'distributed');

  async function verify() {
    setBusy(true);
    const { error: e } = await purchasesApi.setVerified(purchase.id);
    if (e) setError(friendlyError(e));
    await load();
    setBusy(false);
  }

  return (
    <>
      <p>
        <Link to="/compras">← Compras</Link>
      </p>
      <PageHeader title={`Compra del ${formatDate(purchase.purchased_on)}`}>
        {pending ? <Badge tone="warning">Por verificar</Badge> : <Badge tone="success">Confirmada</Badge>}
      </PageHeader>

      <Stack>
        <Card>
          <Table>
            <tbody>
              <tr>
                <th>Referencia</th>
                <td>{purchase.reference ?? '—'}</td>
              </tr>
              <tr>
                <th>Registrada</th>
                <td>{formatDateTime(purchase.created_at, tz)}</td>
              </tr>
              {purchase.verified_at && (
                <tr>
                  <th>Verificada</th>
                  <td>{formatDateTime(purchase.verified_at, tz)}</td>
                </tr>
              )}
              {purchase.notes && (
                <tr>
                  <th>Notas</th>
                  <td>{purchase.notes}</td>
                </tr>
              )}
            </tbody>
          </Table>
          {pending && (
            <>
              <p className={uiClasses.muted}>
                Si al revisar encontraste diferencias, corrígelas desde el inventario con una corrección de recepción o una
                devolución al proveedor. La compra original no se modifica.
              </p>
              <Actions>
                <Button busy={busy} disabled={!online} onClick={() => void verify()}>
                  Marcar como verificada
                </Button>
              </Actions>
            </>
          )}
        </Card>

        <Card>
          <h2>Productos</h2>
          <Table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className={uiClasses.numeric}>Envases</th>
                <th className={uiClasses.numeric}>Entró al inventario</th>
                <th className={uiClasses.numeric}>Precio de lista</th>
                <th className={uiClasses.numeric}>Pagado</th>
                {distributed.map((c) => (
                  <th key={c.id} className={uiClasses.numeric}>
                    {c.description}
                  </th>
                ))}
                <th className={uiClasses.numeric}>Costo</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const ingredient = index.ingredient(l.ingredient_id);
                const dim = ingredient?.dimension ?? 'mass';
                return (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/inventario/${l.ingredient_id}`}>{ingredient?.name}</Link> · {index.brand(l.brand_id)?.name}
                    </td>
                    <td className={uiClasses.numeric}>
                      {l.container_count} × {formatAmount(l.content_per_container, l.content_unit)}
                    </td>
                    <td className={uiClasses.numeric}>{formatBaseAmount(l.incorporated_quantity, dim, units)}</td>
                    <td className={uiClasses.numeric}>{l.list_total_clp ? formatCLP(l.list_total_clp) : '—'}</td>
                    <td className={uiClasses.numeric}>{formatCLP(l.paid_total_clp)}</td>
                    {distributed.map((c) => (
                      <td key={c.id} className={uiClasses.numeric}>
                        {formatCLP(allocated(c.id, l.id))}
                      </td>
                    ))}
                    <td className={uiClasses.numeric}>
                      {formatUnitCost(Number(l.paid_total_clp) / Number(l.incorporated_quantity), dim)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        {charges.length > 0 && (
          <Card>
            <h2>Cargos adicionales</h2>
            <Table>
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th className={uiClasses.numeric}>Monto</th>
                  <th>Tratamiento</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.description}</td>
                    <td className={uiClasses.numeric}>{formatCLP(c.amount_clp)}</td>
                    <td>
                      {TREATMENT_LABEL[c.treatment]}
                      {c.method && c.partial_rule && ` (${METHOD_LABEL[c.method]}; ${RULE_LABEL[c.partial_rule]})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </Stack>
    </>
  );
}
