import { useState, type FormEvent, type ReactNode } from 'react';
import type { Equivalence, Ingredient, RecipeItem, RecipeItemInput, RecipeVersion, RecipeVersionInput, Unit } from '../../db/api';
import { parseDecimal, quantityToInput } from '../../shared/format';
import { Actions, Alert, Button, FieldRow, SelectField, TextAreaField, TextField, uiClasses } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT } from '../ingredients/catalog';

type ItemDraft = { key: string; ingredientId: string; quantity: string; unit: string; notes: string };

type Props = {
  ingredients: Ingredient[];
  units: Unit[];
  equivalences: Equivalence[];
  /** Versión de la que se parte (al crear una versión nueva). */
  base?: { version: RecipeVersion; items: RecipeItem[] };
  /** Campos extra arriba del formulario (nombre de la receta o tipo de versión). */
  header?: ReactNode;
  submitLabel: string;
  onSubmit: (input: RecipeVersionInput) => Promise<string | null>;
  onCancel: () => void;
};

/** Unidades válidas para un ingrediente: las de su dimensión y las de dimensiones con equivalencia vigente. */
export function unitsForIngredient(ingredient: Ingredient | undefined, units: Unit[], equivalences: Equivalence[]): Unit[] {
  if (!ingredient) return [];
  const dims = new Set([
    ingredient.dimension,
    ...equivalences.filter((e) => e.ingredient_id === ingredient.id && !e.superseded_at).map((e) => e.other_dimension),
  ]);
  return units.filter((u) => dims.has(u.dimension));
}

const draftFrom = (i: RecipeItem): ItemDraft => ({
  key: crypto.randomUUID(),
  ingredientId: i.ingredient_id,
  quantity: quantityToInput(i.quantity),
  unit: i.unit,
  notes: i.notes ?? '',
});

const emptyDraft = (): ItemDraft => ({ key: crypto.randomUUID(), ingredientId: '', quantity: '', unit: '', notes: '' });

export function RecipeVersionForm({ ingredients, units, equivalences, base, header, submitLabel, onSubmit, onCancel }: Props) {
  const online = useOnlineStatus();
  const active = ingredients.filter((i) => !i.archived_at);
  const [yieldQty, setYieldQty] = useState(quantityToInput(base?.version.yield_quantity));
  const [yieldUnit, setYieldUnit] = useState(base?.version.yield_unit ?? 'porciones');
  const [items, setItems] = useState<ItemDraft[]>(() => (base ? base.items.map(draftFrom) : [emptyDraft()]));
  const [instructions, setInstructions] = useState(base?.version.instructions ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setItem = (key: string, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function chooseIngredient(key: string, ingredientId: string) {
    const ingredient = ingredients.find((i) => i.id === ingredientId);
    setItem(key, { ingredientId, unit: ingredient ? BASE_UNIT[ingredient.dimension] : '' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const y = parseDecimal(yieldQty);
    if (y === null || y <= 0) return setError('El rendimiento debe ser un número mayor que cero.');
    if (!yieldUnit.trim()) return setError('Indica en qué se mide el rendimiento.');
    const out: RecipeItemInput[] = [];
    for (const [n, item] of items.entries()) {
      const ingredient = ingredients.find((i) => i.id === item.ingredientId);
      if (!ingredient) return setError(`Línea ${n + 1}: elige un ingrediente.`);
      if (ingredient.archived_at) return setError(`Línea ${n + 1}: ${ingredient.name} está archivado.`);
      const q = parseDecimal(item.quantity);
      if (q === null || q <= 0) return setError(`Línea ${n + 1} (${ingredient.name}): la cantidad debe ser mayor que cero.`);
      out.push({ ingredient_id: ingredient.id, quantity: q, unit: item.unit, notes: item.notes.trim() || null });
    }
    if (new Set(out.map((i) => i.ingredient_id)).size !== out.length) {
      return setError('Un ingrediente aparece dos veces. Suma las cantidades en una sola línea.');
    }
    setBusy(true);
    const message = await onSubmit({ yieldQuantity: y, yieldUnit: yieldUnit.trim(), items: out, instructions: instructions.trim() || null });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <form onSubmit={submit} noValidate>
      {header}
      <FieldRow>
        <TextField label="Rendimiento teórico" inputMode="decimal" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
        <TextField
          label="Se mide en"
          placeholder="porciones, unidades, moldes…"
          maxLength={40}
          value={yieldUnit}
          onChange={(e) => setYieldUnit(e.target.value)}
        />
      </FieldRow>

      <h3>Ingredientes</h3>
      {active.length === 0 && <Alert tone="info">Primero crea tus ingredientes en el catálogo.</Alert>}
      {items.map((item, n) => {
        const ingredient = ingredients.find((i) => i.id === item.ingredientId);
        const unitOptions = unitsForIngredient(ingredient, units, equivalences);
        return (
          <section key={item.key} className={n > 0 ? uiClasses.subsection : undefined}>
            <SelectField
              label={`Ingrediente ${n + 1}`}
              value={item.ingredientId}
              onChange={(v) => chooseIngredient(item.key, v)}
              options={[
                { value: '', label: 'Elige un ingrediente…' },
                ...active.map((i) => ({ value: i.id, label: i.name })),
                ...(ingredient?.archived_at ? [{ value: ingredient.id, label: `${ingredient.name} (archivado)` }] : []),
              ]}
            />
            <FieldRow>
              <TextField label="Cantidad" inputMode="decimal" value={item.quantity} onChange={(e) => setItem(item.key, { quantity: e.target.value })} />
              <SelectField
                label="Unidad"
                value={item.unit}
                onChange={(v) => setItem(item.key, { unit: v })}
                options={unitOptions.map((u) => ({ value: u.code, label: u.label }))}
                disabled={!ingredient}
              />
              <TextField label="Nota (opcional)" maxLength={300} value={item.notes} onChange={(e) => setItem(item.key, { notes: e.target.value })} />
            </FieldRow>
            {items.length > 1 && (
              <Button type="button" variant="link" onClick={() => setItems((list) => list.filter((x) => x.key !== item.key))}>
                Quitar ingrediente
              </Button>
            )}
          </section>
        );
      })}
      <Actions>
        <Button type="button" variant="secondary" onClick={() => setItems((list) => [...list, emptyDraft()])}>
          Agregar ingrediente
        </Button>
      </Actions>
      <p className={uiClasses.muted}>
        Para usar un ingrediente en otra dimensión (por ejemplo, huevos en gramos), agrega antes una equivalencia en su ficha.
      </p>

      <TextAreaField label="Instrucciones (opcional)" maxLength={10000} rows={6} value={instructions} onChange={setInstructions} />
      {error && <Alert tone="danger">{error}</Alert>}
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
