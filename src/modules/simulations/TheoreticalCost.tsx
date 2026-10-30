import { useEffect, useState } from 'react';
import { simulationsApi, type Estimate } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Actions, Alert, ButtonLink, Card, Loading, uiClasses } from '../../shared/ui';
import { useUnits } from '../ingredients/catalog';
import { useCatalogIndex } from '../inventory/inventory';
import { EstimateView } from './EstimateView';

/** Costo teórico de una versión: sus ingredientes valorados con los envases que se usarían hoy (7.4). */
export function TheoreticalCost({ versionId }: { versionId: string }) {
  const { units } = useUnits();
  const { index } = useCatalogIndex();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEstimate(null);
    void simulationsApi
      .estimate({ versionId, desiredYield: null, adjustments: [], provisional: [], labor: null, extras: [], pricing: null })
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setEstimate(data)));
  }, [versionId]);

  return (
    <Card>
      <h2>Costo teórico</h2>
      <p className={uiClasses.muted}>
        Ingredientes valorados con los envases que se usarían hoy (primero los abiertos, luego los más antiguos), para el
        rendimiento teórico. No incluye mano de obra, embalajes ni gastos generales.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {!error && (!estimate || units.length === 0 ? <Loading /> : <EstimateView estimate={estimate} units={units} index={index} ingredientsOnly />)}
      <Actions>
        <ButtonLink to={`/simulaciones/nueva?version=${versionId}`}>Simular esta versión</ButtonLink>
      </Actions>
    </Card>
  );
}
