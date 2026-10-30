import type { Dimension, Unit } from '../../db/api';
import { parseDecimal } from '../../shared/format';
import { FieldRow, SelectField, TextField } from '../../shared/ui';
import { unitsOf } from '../ingredients/catalog';

export type QuantityValue = { text: string; unit: string };

/** Cantidad convertida a la unidad base de la dimensión, o null si el texto no es un número. */
export function toBaseQuantity(value: QuantityValue, units: Unit[]): number | null {
  const n = parseDecimal(value.text);
  const unit = units.find((u) => u.code === value.unit);
  if (n === null || !unit) return null;
  return n * unit.to_base;
}

type Props = {
  label: string;
  hint?: string;
  dimension: Dimension;
  units: Unit[];
  value: QuantityValue;
  onChange: (value: QuantityValue) => void;
};

/** Cantidad con unidad elegible dentro de la dimensión del ingrediente (g o kg, ml o l). */
export function QuantityField({ label, hint, dimension, units, value, onChange }: Props) {
  const options = unitsOf(units, dimension);
  return (
    <FieldRow>
      <TextField
        label={label}
        hint={hint}
        inputMode="decimal"
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
      />
      <SelectField
        label="Unidad"
        value={value.unit}
        onChange={(unit) => onChange({ ...value, unit })}
        options={options.map((u) => ({ value: u.code, label: u.label }))}
      />
    </FieldRow>
  );
}
