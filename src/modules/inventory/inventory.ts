import { useCallback, useEffect, useState } from 'react';
import {
  catalogApi,
  inventoryApi,
  type Brand,
  type Container,
  type CostStatus,
  type Dimension,
  type Ingredient,
  type IngredientStock,
  type MovementKind,
  type Presentation,
} from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatAmount } from '../ingredients/catalog';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  purchase: 'Compra',
  manual_entry: 'Entrada manual',
  adjustment: 'Ajuste',
  waste: 'Merma',
  supplier_return: 'Devolución a proveedor',
  receipt_correction: 'Corrección de recepción',
  reversal: 'Reversión',
  production_consumption: 'Consumo por producción',
};

export const REVERSIBLE: MovementKind[] = ['adjustment', 'waste', 'supplier_return', 'receipt_correction'];

export const COST_STATUS_LABEL: Record<CostStatus, string> = {
  known: 'Conocido',
  provisional: 'Provisional',
  unknown: 'Sin costo',
};

/** Unidad en la que conviene mostrar un costo unitario: por kg, por litro o por unidad. */
const COST_UNIT: Record<Dimension, { factor: number; label: string }> = {
  mass: { factor: 1000, label: 'kg' },
  volume: { factor: 1000, label: 'l' },
  count: { factor: 1, label: 'unidad' },
};

const unitCostFormat = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 2 });

/** Costo por unidad base expresado por kg / l / unidad. Nunca muestra un costo desconocido como $0. */
export function formatUnitCost(unitCost: number | null | undefined, dimension: Dimension): string {
  if (unitCost === null || unitCost === undefined) return 'Sin costo';
  const u = COST_UNIT[dimension];
  return `${unitCostFormat.format(Number(unitCost) * u.factor)} / ${u.label}`;
}

export function containerState(c: Container): string {
  if (Number(c.balance) === 0) return 'Vacío';
  return c.opened_at ? 'Abierto' : 'Cerrado';
}

export type CatalogIndex = {
  ingredients: Ingredient[];
  ingredient: (id: string) => Ingredient | undefined;
  brand: (id: string) => Brand | undefined;
  presentation: (id: string) => Presentation | undefined;
  /** Presentaciones activas con marca e ingrediente activos, para elegir en compras y entradas. */
  buyable: { presentation: Presentation; brand: Brand; ingredient: Ingredient; label: string }[];
  stock: (ingredientId: string) => IngredientStock | undefined;
};

/** Catálogo completo y stock por ingrediente, indexados para mostrar nombres. */
export function useCatalogIndex(): { index: CatalogIndex | null; error: string | null; reload: () => Promise<void> } {
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [ing, br, pres, stock] = await Promise.all([
      catalogApi.listIngredients(),
      catalogApi.listBrands(),
      catalogApi.listPresentations(),
      inventoryApi.listStock(),
    ]);
    const e = ing.error ?? br.error ?? pres.error ?? stock.error;
    if (e) return setError(friendlyError(e));
    const ingredients = ing.data ?? [];
    const iMap = new Map(ingredients.map((i) => [i.id, i]));
    const bMap = new Map((br.data ?? []).map((b) => [b.id, b]));
    const pMap = new Map((pres.data ?? []).map((p) => [p.id, p]));
    const sMap = new Map((stock.data ?? []).map((s) => [s.ingredient_id, s]));
    const buyable = (pres.data ?? [])
      .map((p) => ({ presentation: p, brand: bMap.get(p.brand_id)!, ingredient: iMap.get(p.ingredient_id)! }))
      .filter((x) => x.brand && x.ingredient && !x.presentation.archived_at && !x.brand.archived_at && !x.ingredient.archived_at)
      .map((x) => ({
        ...x,
        label: [x.ingredient.name, x.brand.name, x.presentation.description, formatAmount(x.presentation.quantity, x.presentation.unit)]
          .filter(Boolean)
          .join(' · '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    setIndex({
      ingredients,
      ingredient: (id) => iMap.get(id),
      brand: (id) => bMap.get(id),
      presentation: (id) => pMap.get(id),
      buyable,
      stock: (id) => sMap.get(id),
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { index, error, reload };
}
