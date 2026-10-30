import { useState } from 'react';
import { inventoryApi, type Container, type Dimension, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatDate, formatQuantity, parseDecimal, quantityToInput } from '../../shared/format';
import { Actions, Alert, Button, Dialog, SelectField, Table, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT, formatBaseAmount, unitsOf } from '../ingredients/catalog';
import type { CatalogIndex } from './inventory';

type Props = {
  containers: Container[];
  dimension: Dimension;
  units: Unit[];
  index: CatalogIndex;
  onDone: () => Promise<void>;
  onCancel: () => void;
};

/** Conteo físico por envase. Solo se ajustan los envases contados; los demás no cambian. */
export function InventoryCount({ containers, dimension, units, index, onDone, onCancel }: Props) {
  const online = useOnlineStatus();
  const [idemKey] = useIdempotencyKey();
  const unitOptions = unitsOf(units, dimension);
  const [unit, setUnit] = useState(BASE_UNIT[dimension]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const factor = unitOptions.find((u) => u.code === unit)?.to_base ?? 1;

  const lines = containers
    .filter((c) => counted[c.id]?.trim())
    .map((c) => {
      const value = parseDecimal(counted[c.id]!);
      return { container: c, counted: value === null ? null : value * factor };
    });
  const invalid = lines.some((l) => l.counted === null || l.counted < 0);
  const differences = lines.filter((l) => l.counted !== null && l.counted !== Number(l.container.balance));

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await inventoryApi.confirmCount(
      idemKey,
      lines.map((l) => ({ container_id: l.container.id, expected_balance: Number(l.container.balance), counted_quantity: l.counted! })),
      notes.trim() || null,
    );
    setBusy(false);
    setConfirming(false);
    if (rpcError) return setError(friendlyError(rpcError));
    await onDone();
  }

  return (
    <>
      <p className={uiClasses.muted}>
        Escribe lo que hay físicamente en cada envase que revises. Puedes contar solo algunos; los que dejes vacíos no cambian.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <SelectField
        label="Contar en"
        value={unit}
        onChange={setUnit}
        options={unitOptions.map((u) => ({ value: u.code, label: u.label }))}
      />
      <Table>
        <thead>
          <tr>
            <th>Envase</th>
            <th className={uiClasses.numeric}>Saldo en sistema</th>
            <th>Contado ({unit === 'unidad' ? 'unidades' : unit})</th>
            <th className={uiClasses.numeric}>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((c) => {
            const line = lines.find((l) => l.container.id === c.id);
            const diff = line?.counted != null ? line.counted - Number(c.balance) : null;
            return (
              <tr key={c.id}>
                <td>
                  {index.brand(c.brand_id)?.name} · {formatDate(c.received_on)}
                </td>
                <td className={uiClasses.numeric}>{formatBaseAmount(c.balance, dimension, units)}</td>
                <td>
                  <TextField
                    label="Cantidad contada"
                    inputMode="decimal"
                    placeholder={quantityToInput(Number(c.balance) / factor)}
                    value={counted[c.id] ?? ''}
                    onChange={(e) => setCounted((m) => ({ ...m, [c.id]: e.target.value }))}
                  />
                </td>
                <td className={uiClasses.numeric}>
                  {diff === null ? '—' : diff === 0 ? 'Coincide' : `${diff > 0 ? '+' : ''}${formatQuantity(diff)} ${BASE_UNIT[dimension]}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <TextField label="Nota del conteo (opcional)" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {invalid && <Alert tone="warning">Hay cantidades que no son números válidos o son negativas.</Alert>}
      <Actions>
        <Button disabled={!online || invalid || lines.length === 0} onClick={() => setConfirming(true)}>
          Revisar y confirmar
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </Actions>

      {confirming && (
        <Dialog
          title="Confirmar conteo"
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Volver
              </Button>
              <Button busy={busy} onClick={() => void confirm()}>
                Confirmar
              </Button>
            </>
          }
        >
          <p>
            Contaste {lines.length} envase(s).{' '}
            {differences.length === 0
              ? 'Todos coinciden con el sistema: se guardará el conteo sin ajustes.'
              : `Se registrará un ajuste en ${differences.length} envase(s); el saldo anterior queda en el historial.`}
          </p>
        </Dialog>
      )}
    </>
  );
}
