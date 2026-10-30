import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { inventoryApi, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, parseCLP, parseDecimal, todayIn } from '../../shared/format';
import { Actions, Alert, Button, CheckboxField, FieldRow, SelectField, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { formatAmount, unitSymbol } from '../ingredients/catalog';
import type { CatalogIndex } from './inventory';

type Props = {
  ingredientId: string;
  index: CatalogIndex;
  units: Unit[];
  onDone: () => Promise<void>;
  onCancel: () => void;
};

/** Inventario que no viene de una compra registrada: stock inicial, regalos, etc. */
export function ManualEntryForm({ ingredientId, index, onDone, onCancel }: Props) {
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const [idemKey] = useIdempotencyKey();
  const options = index.buyable.filter((b) => b.ingredient.id === ingredientId);
  const [presentationId, setPresentationId] = useState(options[0]?.presentation.id ?? '');
  const [count, setCount] = useState('1');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(() => todayIn(tz));
  const [cost, setCost] = useState('');
  const [provisional, setProvisional] = useState(false);
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = options.find((o) => o.presentation.id === presentationId);

  if (options.length === 0) {
    return <Alert tone="info">Este ingrediente aún no tiene marcas con presentaciones activas. Agrégalas en Ingredientes.</Alert>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return setError('El número de envases debe ser un entero mayor que cero.');
    const qty = quantity.trim() ? parseDecimal(quantity) : Number(selected?.presentation.quantity);
    if (qty === null || !(qty > 0)) return setError('La cantidad por envase debe ser mayor que cero.');
    let totalCost: number | null = null;
    if (cost.trim()) {
      totalCost = parseCLP(cost);
      if (!totalCost) return setError('El costo debe ser un monto en pesos mayor que cero. Si no lo conoces, déjalo vacío.');
    }
    setBusy(true);
    const { error: rpcError } = await inventoryApi.registerManualEntry(idemKey, {
      presentationId,
      containerCount: n,
      quantityPerContainer: qty,
      receivedOn: date,
      totalCostClp: totalCost,
      costIsProvisional: totalCost !== null && provisional,
      opened,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (rpcError) return setError(friendlyError(rpcError));
    await onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className={uiClasses.muted}>
        Úsala para el stock que ya tenías o lo que recibiste sin una compra. No reemplaza a una compra: si compraste, regístrala en
        Compras.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <SelectField
        label="Marca y presentación"
        value={presentationId}
        onChange={setPresentationId}
        options={options.map((o) => ({ value: o.presentation.id, label: o.label }))}
      />
      <FieldRow>
        <TextField label="N° de envases" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        <TextField
          label={`Cantidad en cada envase${selected ? ` (${unitSymbol(selected.presentation.unit)})` : ''}`}
          hint={selected ? `Vacío = ${formatAmount(selected.presentation.quantity, selected.presentation.unit)}` : undefined}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <TextField label="Fecha" type="date" max={todayIn(tz)} value={date} onChange={(e) => setDate(e.target.value)} />
      </FieldRow>
      <TextField
        label="Costo total (opcional)"
        hint={
          parseCLP(cost)
            ? `${formatCLP(parseCLP(cost))} por todos los envases.`
            : 'Si no lo conoces, déjalo vacío: quedará marcado sin costo (nunca como $0).'
        }
        inputMode="numeric"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />
      {cost.trim() && (
        <CheckboxField
          label="Es un costo provisional"
          hint="Una estimación tuya, no un precio verificable. Se mostrará marcada como provisional."
          checked={provisional}
          onChange={setProvisional}
        />
      )}
      <CheckboxField label="Los envases ya están abiertos" checked={opened} onChange={setOpened} />
      <TextField label="Motivo (opcional)" placeholder="Stock inicial" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Actions>
        <Button type="submit" busy={busy} disabled={!online}>
          Registrar entrada
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </Actions>
    </form>
  );
}
