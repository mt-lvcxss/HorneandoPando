import { useState, type FormEvent } from 'react';
import type { Dimension, Ingredient, IngredientInput } from '../../db/api';
import { Actions, Alert, Button, SelectField, TextAreaField, TextField } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { DIMENSION_OPTIONS } from './catalog';

type Props = {
  initial?: Ingredient;
  /** La dimensión no se puede cambiar si el ingrediente ya tiene presentaciones o equivalencias. */
  dimensionLocked?: boolean;
  submitLabel: string;
  onSubmit: (input: IngredientInput) => Promise<string | null>;
  onCancel?: () => void;
};

export function IngredientForm({ initial, dimensionLocked, submitLabel, onSubmit, onCancel }: Props) {
  const online = useOnlineStatus();
  const [name, setName] = useState(initial?.name ?? '');
  const [dimension, setDimension] = useState<Dimension>(initial?.dimension ?? 'mass');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Ingresa el nombre del ingrediente.');

    setBusy(true);
    const message = await onSubmit({ name: name.trim(), dimension, notes: notes.trim() || null });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Ingrediente"
        hint="Lo que piden tus recetas, por ejemplo «Harina» o «Polvos de hornear». Las marcas se agregan después dentro del ingrediente."
        maxLength={120}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField
        label="Se mide en"
        hint={
          dimensionLocked
            ? 'No se puede cambiar porque ya tiene presentaciones o equivalencias.'
            : 'Define en qué unidades se guarda su inventario. Para usar otra dimensión en una receta (por ejemplo, huevos en gramos) agrega una equivalencia.'
        }
        value={dimension}
        onChange={(v) => setDimension(v as Dimension)}
        options={DIMENSION_OPTIONS}
        disabled={dimensionLocked}
      />
      <TextAreaField label="Notas (opcional)" maxLength={1000} value={notes} onChange={setNotes} />
      {!online && <Alert tone="warning">Sin conexión. Podrás guardar cuando vuelva la conexión.</Alert>}
      <Actions>
        <Button type="submit" busy={busy} disabled={!online}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </Actions>
    </form>
  );
}
