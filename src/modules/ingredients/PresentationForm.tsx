import { useState, type FormEvent } from 'react';
import type { Dimension, Presentation, PresentationInput, Unit } from '../../db/api';
import { formatCLP, parseCLP, parseDecimal, quantityToInput } from '../../shared/format';
import { Actions, Alert, Button, FieldRow, SelectField, TextField } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT, unitsOf } from './catalog';

type Props = {
  dimension: Dimension;
  units: Unit[];
  initial?: Presentation;
  submitLabel: string;
  onSubmit: (input: PresentationInput) => Promise<string | null>;
  onCancel: () => void;
};

export function PresentationForm({ dimension, units, initial, submitLabel, onSubmit, onCancel }: Props) {
  const online = useOnlineStatus();
  const options = unitsOf(units, dimension);
  const defaultUnit = dimension === 'mass' ? 'kg' : dimension === 'volume' ? 'l' : BASE_UNIT[dimension];
  const [description, setDescription] = useState(initial?.description ?? '');
  const [quantity, setQuantity] = useState(quantityToInput(initial?.quantity));
  const [unit, setUnit] = useState(initial?.unit ?? defaultUnit);
  const [price, setPrice] = useState(initial?.reference_price_clp ? String(initial.reference_price_clp) : '');
  const [priceDate, setPriceDate] = useState(initial?.reference_price_date ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const qty = parseDecimal(quantity);
    if (qty === null || qty <= 0) return setError('Indica el contenido del envase (mayor que cero).');
    let priceValue: number | null = null;
    if (price.trim()) {
      priceValue = parseCLP(price);
      if (priceValue === null || priceValue <= 0) {
        return setError('El precio de referencia debe ser un monto en pesos mayor que cero. Si no lo conoces, déjalo vacío.');
      }
    }
    setBusy(true);
    const message = await onSubmit({
      quantity: qty,
      unit,
      description: description.trim() || null,
      referencePriceClp: priceValue,
      referencePriceDate: priceValue !== null && priceDate ? priceDate : null,
    });
    setBusy(false);
    if (message) setError(message);
  }

  const parsedPrice = price.trim() ? parseCLP(price) : null;

  return (
    <form onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Envase (opcional)"
        placeholder="Saco, bolsa, caja…"
        maxLength={120}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <FieldRow>
        <TextField
          label="Contenido de un envase"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <SelectField
          label="Unidad"
          value={unit}
          onChange={setUnit}
          options={options.map((u) => ({ value: u.code, label: u.label }))}
        />
      </FieldRow>
      <FieldRow>
        <TextField
          label="Precio de referencia en CLP (opcional)"
          hint={
            parsedPrice
              ? `${formatCLP(parsedPrice)} por envase. Es solo una referencia: el costo real se toma de cada compra.`
              : 'Es solo una referencia: el costo real se toma de cada compra.'
          }
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <TextField
          label="Fecha del precio"
          hint="Si la dejas vacía, se usa la fecha de hoy."
          type="date"
          value={priceDate}
          onChange={(e) => setPriceDate(e.target.value)}
          disabled={!price.trim()}
        />
      </FieldRow>
      {!online && <Alert tone="warning">Sin conexión. Podrás guardar cuando vuelva la conexión.</Alert>}
      <Actions>
        <Button type="submit" busy={busy} disabled={!online}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </Actions>
    </form>
  );
}
