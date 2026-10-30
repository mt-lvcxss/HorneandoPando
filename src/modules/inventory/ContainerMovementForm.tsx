import { useState, type FormEvent } from 'react';
import { inventoryApi, type Container, type ContainerMovementKind, type Dimension, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Actions, Alert, Button, SelectField, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT, formatBaseAmount } from '../ingredients/catalog';
import { QuantityField, toBaseQuantity, type QuantityValue } from './QuantityField';

type Props = {
  container: Container;
  dimension: Dimension;
  units: Unit[];
  onDone: () => Promise<void>;
  onCancel: () => void;
};

const KIND_HELP: Record<ContainerMovementKind, { label: string; quantity: string; hint: string }> = {
  waste: { label: 'Merma o pérdida', quantity: 'Cantidad perdida', hint: 'Producto vencido, derramado o en mal estado.' },
  supplier_return: { label: 'Devolución a proveedor', quantity: 'Cantidad devuelta', hint: 'Sale del inventario hacia el proveedor.' },
  adjustment: {
    label: 'Ajuste de saldo',
    quantity: 'Saldo correcto',
    hint: 'Escribe cuánto hay realmente en el envase. Se registra la diferencia y se conserva el saldo anterior.',
  },
  receipt_correction: {
    label: 'Corrección de recepción',
    quantity: 'Diferencia recibida',
    hint: 'Negativa si llegó menos de lo registrado (por ejemplo −20 g), positiva si llegó más. El costo por unidad se recalcula sobre lo que realmente llegó.',
  },
};

export function ContainerMovementForm({ container, dimension, units, onDone, onCancel }: Props) {
  const online = useOnlineStatus();
  const [idemKey] = useIdempotencyKey();
  const kinds: ContainerMovementKind[] =
    container.source === 'purchase' ? ['waste', 'supplier_return', 'adjustment', 'receipt_correction'] : ['waste', 'supplier_return', 'adjustment'];
  const [kind, setKind] = useState<ContainerMovementKind>('waste');
  const [quantity, setQuantity] = useState<QuantityValue>({ text: '', unit: BASE_UNIT[dimension] });
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = Number(container.balance);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const value = toBaseQuantity(quantity, units);
    if (value === null) return setError('Indica una cantidad válida.');
    if (kind === 'adjustment' && value < 0) return setError('El saldo correcto no puede ser negativo.');
    if ((kind === 'waste' || kind === 'supplier_return') && value <= 0) return setError('La cantidad debe ser mayor que cero.');
    if ((kind === 'waste' || kind === 'supplier_return') && value > balance) {
      return setError(`El envase solo tiene ${formatBaseAmount(balance, dimension, units)}.`);
    }
    if (kind === 'receipt_correction' && (value === 0 || balance + value < 0)) {
      return setError('La diferencia debe ser distinta de cero y no puede dejar el saldo negativo.');
    }
    if (kind === 'adjustment' && value === balance) return setError('El saldo correcto es igual al actual: no hay nada que ajustar.');

    setBusy(true);
    const { error: rpcError } = await inventoryApi.registerMovement(idemKey, {
      containerId: container.id,
      kind,
      quantity: value,
      reason: reason.trim() || null,
      reference: reference.trim() || null,
      expectedBalance: kind === 'adjustment' ? balance : null,
    });
    setBusy(false);
    if (rpcError) return setError(friendlyError(rpcError));
    await onDone();
  }

  const help = KIND_HELP[kind];

  return (
    <form onSubmit={submit} noValidate>
      <p className={uiClasses.muted}>Saldo actual: {formatBaseAmount(balance, dimension, units)}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <SelectField
        label="Movimiento"
        value={kind}
        onChange={(v) => setKind(v as ContainerMovementKind)}
        options={kinds.map((k) => ({ value: k, label: KIND_HELP[k].label }))}
      />
      <QuantityField label={help.quantity} hint={help.hint} dimension={dimension} units={units} value={quantity} onChange={setQuantity} />
      <TextField label="Motivo (opcional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      {kind === 'supplier_return' && (
        <TextField label="Referencia (opcional)" placeholder="N° de nota de crédito, proveedor…" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
      )}
      <Actions>
        <Button type="submit" busy={busy} disabled={!online}>
          Registrar
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </Actions>
    </form>
  );
}
