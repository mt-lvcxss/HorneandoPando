import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { inventoryApi, type Container, type Movement } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatDate, formatDateTime, formatQuantity } from '../../shared/format';
import {
  Actions,
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CheckboxField,
  Dialog,
  Loading,
  PageHeader,
  Stack,
  Table,
  TextField,
  uiClasses,
} from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT, formatAmount, formatBaseAmount, useUnits } from '../ingredients/catalog';
import { ContainerMovementForm } from './ContainerMovementForm';
import { InventoryCount } from './InventoryCount';
import { COST_STATUS_LABEL, containerState, formatUnitCost, MOVEMENT_LABEL, REVERSIBLE, useCatalogIndex } from './inventory';
import { ManualEntryForm } from './ManualEntryForm';

type Mode = { kind: 'none' } | { kind: 'entry' } | { kind: 'count' } | { kind: 'movement'; container: Container };

export function IngredientInventoryPage() {
  const { id = '' } = useParams();
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const { units } = useUnits();
  const { index, error: indexError, reload: reloadIndex } = useCatalogIndex();
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [showEmpty, setShowEmpty] = useState(false);
  const [reversing, setReversing] = useState<Movement | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseKey, renewReverseKey] = useIdempotencyKey();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([inventoryApi.listContainers(id), inventoryApi.listMovements(id)]);
    const e = c.error ?? m.error;
    if (e) return setError(friendlyError(e));
    setContainers(c.data ?? []);
    setMovements(m.data ?? []);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setMode({ kind: 'none' });
    await Promise.all([load(), reloadIndex()]);
  }, [load, reloadIndex]);

  if (error || indexError) return <Alert tone="danger">{error ?? indexError}</Alert>;
  if (!containers || !index || units.length === 0) return <Loading />;

  const ingredient = index.ingredient(id);
  if (!ingredient) {
    return (
      <Alert tone="warning" title="Ingrediente no encontrado">
        <p>
          No existe o no pertenece a tu cuenta. <Link to="/inventario">Volver al inventario</Link>
        </p>
      </Alert>
    );
  }

  const dim = ingredient.dimension;
  const available = Number(index.stock(id)?.available ?? 0);
  const visible = containers.filter((c) => showEmpty || Number(c.balance) > 0);
  const withStock = containers.filter((c) => Number(c.balance) > 0);
  const reversed = new Set(movements.map((m) => m.reverses_movement_id).filter(Boolean));
  const containerLabel = (containerId: string) => {
    const c = containers.find((x) => x.id === containerId);
    return c ? `${index.brand(c.brand_id)?.name} · ${formatDate(c.received_on)}` : '—';
  };

  async function reverse() {
    if (!reversing) return;
    setBusy(true);
    setActionError(null);
    const { error: e } = await inventoryApi.reverseMovement(reverseKey, reversing.id, reverseReason.trim() || null);
    setBusy(false);
    if (e) {
      setReversing(null);
      return setActionError(friendlyError(e));
    }
    renewReverseKey();
    setReversing(null);
    setReverseReason('');
    await refresh();
  }

  return (
    <>
      <p>
        <Link to="/inventario">← Inventario</Link>
      </p>
      <PageHeader title={ingredient.name}>
        <ButtonLink to="/compras/nueva" variant="secondary">
          Nueva compra
        </ButtonLink>
        <Link to={`/ingredientes/${id}`}>Ver en el catálogo</Link>
      </PageHeader>

      <Stack>
        <Card>
          <p>
            Disponible: <strong>{formatBaseAmount(available, dim, units)}</strong>{' '}
            {available === 0 && containers.length > 0 && <Badge tone="warning">Agotado</Badge>}
          </p>
          {mode.kind === 'none' && (
            <Actions>
              <Button variant="secondary" disabled={!online} onClick={() => setMode({ kind: 'entry' })}>
                Entrada manual
              </Button>
              <Button variant="secondary" disabled={!online || withStock.length === 0} onClick={() => setMode({ kind: 'count' })}>
                Conteo físico
              </Button>
            </Actions>
          )}
          {mode.kind === 'entry' && (
            <>
              <h2>Entrada manual</h2>
              <ManualEntryForm ingredientId={id} index={index} units={units} onDone={refresh} onCancel={() => setMode({ kind: 'none' })} />
            </>
          )}
          {mode.kind === 'count' && (
            <>
              <h2>Conteo físico</h2>
              <InventoryCount
                containers={withStock}
                dimension={dim}
                units={units}
                index={index}
                onDone={refresh}
                onCancel={() => setMode({ kind: 'none' })}
              />
            </>
          )}
        </Card>

        <Card>
          <h2>Envases</h2>
          {containers.some((c) => Number(c.balance) === 0) && (
            <CheckboxField label="Mostrar envases vacíos" checked={showEmpty} onChange={setShowEmpty} />
          )}
          {visible.length === 0 ? (
            <p>{containers.length === 0 ? 'Sin envases todavía. Registra una compra o una entrada manual.' : 'No quedan envases con stock.'}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Marca</th>
                  <th>Origen</th>
                  <th className={uiClasses.numeric}>Recibido</th>
                  <th className={uiClasses.numeric}>Saldo</th>
                  <th>Estado</th>
                  <th className={uiClasses.numeric}>Costo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const p = index.presentation(c.presentation_id);
                  return (
                    <tr key={c.id}>
                      <td>
                        {index.brand(c.brand_id)?.name}
                        <br />
                        <span className={uiClasses.muted}>{p ? [p.description, formatAmount(p.quantity, p.unit)].filter(Boolean).join(' · ') : ''}</span>
                      </td>
                      <td>
                        {c.source === 'purchase' ? 'Compra' : 'Entrada manual'} · {formatDate(c.received_on)}
                      </td>
                      <td className={uiClasses.numeric}>
                        {formatBaseAmount(c.received_quantity, dim, units)}
                        {Number(c.received_quantity) !== Number(c.initial_quantity) && (
                          <>
                            <br />
                            <span className={uiClasses.muted}>registrado: {formatBaseAmount(c.initial_quantity, dim, units)}</span>
                          </>
                        )}
                      </td>
                      <td className={uiClasses.numeric}>{formatBaseAmount(c.balance, dim, units)}</td>
                      <td>{containerState(c)}</td>
                      <td className={uiClasses.numeric}>
                        {formatUnitCost(c.unit_cost, dim)}{' '}
                        {c.cost_status !== 'known' && <Badge tone="warning">{COST_STATUS_LABEL[c.cost_status]}</Badge>}
                      </td>
                      <td>
                        {Number(c.balance) > 0 || c.source === 'purchase' ? (
                          <Button
                            variant="link"
                            disabled={!online || mode.kind !== 'none'}
                            onClick={() => setMode({ kind: 'movement', container: c })}
                          >
                            Registrar movimiento
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {mode.kind === 'movement' && (
            <div className={uiClasses.subsection}>
              <h3>Movimiento · {containerLabel(mode.container.id)}</h3>
              <ContainerMovementForm
                container={mode.container}
                dimension={dim}
                units={units}
                onDone={refresh}
                onCancel={() => setMode({ kind: 'none' })}
              />
            </div>
          )}
        </Card>

        <Card>
          <h2>Movimientos</h2>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          {movements.length === 0 ? (
            <p>Sin movimientos.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Envase</th>
                  <th className={uiClasses.numeric}>Cantidad</th>
                  <th className={uiClasses.numeric}>Saldo</th>
                  <th>Motivo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.created_at, tz)}</td>
                    <td>
                      {MOVEMENT_LABEL[m.kind]} {reversed.has(m.id) && <Badge>Revertido</Badge>}
                    </td>
                    <td>{containerLabel(m.container_id)}</td>
                    <td className={uiClasses.numeric}>
                      {Number(m.quantity) > 0 ? '+' : ''}
                      {formatQuantity(m.quantity)} {BASE_UNIT[dim]}
                    </td>
                    <td className={uiClasses.numeric}>
                      {formatQuantity(m.balance_before)} → {formatQuantity(m.balance_after)}
                    </td>
                    <td>{[m.reason, m.reference].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      {REVERSIBLE.includes(m.kind) && !reversed.has(m.id) && (
                        <Button variant="link" disabled={!online} onClick={() => setReversing(m)}>
                          Revertir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </Stack>

      {reversing && (
        <Dialog
          title="¿Revertir este movimiento?"
          actions={
            <>
              <Button variant="secondary" onClick={() => setReversing(null)}>
                Cancelar
              </Button>
              <Button busy={busy} onClick={() => void reverse()}>
                Revertir
              </Button>
            </>
          }
        >
          <p>
            Se registrará un movimiento opuesto de {formatQuantity(-reversing.quantity)} {BASE_UNIT[dim]}. El original se conserva
            en el historial.
          </p>
          <TextField label="Motivo (opcional)" maxLength={300} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
        </Dialog>
      )}
    </>
  );
}
