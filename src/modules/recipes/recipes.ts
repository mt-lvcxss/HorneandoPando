import { useEffect, useState } from 'react';
import { catalogApi, type Equivalence, type Ingredient, type RecipeItem, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatAmount, useUnits } from '../ingredients/catalog';

export const VERSION_KIND_LABEL = { main: 'Principal', alternative: 'Alternativa' } as const;

/** Ingredientes, unidades y equivalencias vigentes: lo necesario para escribir y mostrar recetas. */
export function useRecipeCatalog(): {
  ingredients: Ingredient[] | null;
  units: Unit[];
  equivalences: Equivalence[];
  error: string | null;
} {
  const { units, error: unitsError } = useUnits();
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [equivalences, setEquivalences] = useState<Equivalence[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([catalogApi.listIngredients(), catalogApi.listCurrentEquivalences()]).then(([i, e]) => {
      const err = i.error ?? e.error;
      if (err) return setError(friendlyError(err));
      setIngredients(i.data ?? []);
      setEquivalences(e.data ?? []);
    });
  }, []);

  return { ingredients: units.length ? ingredients : null, units, equivalences, error: error ?? (unitsError ? friendlyError(unitsError) : null) };
}

/** Cantidad de una línea multiplicada por un factor de escala, sin redondear. */
export function scaledAmount(item: RecipeItem, factor: number): string {
  return formatAmount(Number(item.quantity) * factor, item.unit);
}
