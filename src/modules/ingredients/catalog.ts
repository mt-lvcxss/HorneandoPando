import { useEffect, useState } from 'react';
import { catalogApi, type Dimension, type Unit } from '../../db/api';
import { formatQuantity } from '../../shared/format';

export const DIMENSION_LABEL: Record<Dimension, string> = {
  mass: 'Peso',
  volume: 'Volumen',
  count: 'Unidades',
};

export const DIMENSION_OPTIONS = [
  { value: 'mass', label: 'Peso (g, kg)' },
  { value: 'volume', label: 'Volumen (ml, l)' },
  { value: 'count', label: 'Unidades (huevos, envases, piezas)' },
];

export const BASE_UNIT: Record<Dimension, string> = { mass: 'g', volume: 'ml', count: 'unidad' };

export function unitsOf(units: Unit[], dimension: Dimension): Unit[] {
  return units.filter((u) => u.dimension === dimension);
}

export function unitSymbol(code: string, quantity?: number): string {
  if (code === 'unidad') return quantity === 1 ? 'unidad' : 'unidades';
  return code;
}

export function formatAmount(quantity: number | null | undefined, unitCode: string): string {
  if (quantity === null || quantity === undefined) return '—';
  return `${formatQuantity(quantity)} ${unitSymbol(unitCode, Number(quantity))}`;
}

/**
 * Muestra una cantidad guardada en unidad base con la unidad más grande que no la deje bajo 1
 * (1.500 g → 1,5 kg). Solo cambia la presentación: el valor guardado no se toca.
 */
export function formatBaseAmount(quantity: number | null | undefined, dimension: Dimension, units: Unit[]): string {
  if (quantity === null || quantity === undefined) return '—';
  const candidates = unitsOf(units, dimension).sort((a, b) => b.to_base - a.to_base);
  const unit = candidates.find((u) => Math.abs(Number(quantity)) >= u.to_base) ?? candidates[candidates.length - 1];
  if (!unit) return formatAmount(quantity, BASE_UNIT[dimension]);
  return formatAmount(Number(quantity) / unit.to_base, unit.code);
}

let unitsCache: Promise<Unit[]> | null = null;

/** Unidades de medida desde la base de datos (catálogo fijo; se consulta una vez por sesión). */
export function useUnits(): { units: Unit[]; error: unknown } {
  const [state, setState] = useState<{ units: Unit[]; error: unknown }>({ units: [], error: null });
  useEffect(() => {
    let active = true;
    unitsCache ??= catalogApi.listUnits().then(({ data, error }) => {
      if (error || !data) {
        unitsCache = null;
        throw error;
      }
      return data;
    });
    unitsCache.then(
      (units) => active && setState({ units, error: null }),
      (error: unknown) => active && setState({ units: [], error }),
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
