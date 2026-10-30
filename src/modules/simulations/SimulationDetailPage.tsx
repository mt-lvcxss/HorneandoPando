import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { simulationsApi, type Simulation } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import { Actions, Alert, ButtonLink, Card, Loading, PageHeader, uiClasses } from '../../shared/ui';
import { useUnits } from '../ingredients/catalog';
import { useCatalogIndex } from '../inventory/inventory';
import { EstimateView } from './EstimateView';

export function SimulationDetailPage() {
  const { id = '' } = useParams();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const { units } = useUnits();
  const { index } = useCatalogIndex();
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void simulationsApi.get(id).then(({ data, error: e }) => {
      if (e) return setError(friendlyError(e));
      if (!data) return setNotFound(true);
      setSimulation(data);
    });
  }, [id]);

  if (notFound) {
    return (
      <Alert tone="warning" title="Simulación no encontrada">
        <p>
          No existe o no pertenece a tu cuenta. <Link to="/simulaciones">Volver a simulaciones</Link>
        </p>
      </Alert>
    );
  }
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!simulation || units.length === 0) return <Loading />;

  const r = simulation.result;

  return (
    <>
      <p>
        <Link to="/simulaciones">← Simulaciones</Link>
      </p>
      <PageHeader title={`Simulación · ${r.recipe_name}`} />
      <Card>
        <p className={uiClasses.muted}>
          {r.version_label} · calculada el {formatDateTime(simulation.created_at, tz)} con el inventario y los costos de ese
          momento. Es una referencia: no cambió el inventario.
        </p>
        {simulation.notes && <p>{simulation.notes}</p>}
        <EstimateView estimate={r} units={units} index={index} />
        <Actions>
          <ButtonLink to={`/simulaciones/nueva?version=${simulation.version_id}`} variant="secondary">
            Simular de nuevo con el inventario actual
          </ButtonLink>
          <Link to={`/recetas/${simulation.recipe_id}?version=${simulation.version_id}`}>Ver la receta</Link>
        </Actions>
      </Card>
    </>
  );
}
