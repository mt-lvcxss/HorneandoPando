import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { simulationsApi, type Simulation } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, formatDateTime, formatQuantity } from '../../shared/format';
import { Alert, Badge, ButtonLink, Card, Loading, PageHeader, Table, uiClasses } from '../../shared/ui';
import { StatusBadge } from './EstimateView';

export function SimulationsPage() {
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const [simulations, setSimulations] = useState<Simulation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void simulationsApi.list().then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setSimulations(data ?? [])));
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!simulations) return <Loading />;

  return (
    <>
      <PageHeader title="Simulaciones">
        <ButtonLink to="/simulaciones/nueva">Nueva simulación</ButtonLink>
      </PageHeader>
      <Card>
        {simulations.length === 0 ? (
          <p>Aún no guardas simulaciones. Simula una receta para conocer cantidades, faltantes y costos sin tocar el inventario.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Receta</th>
                <th className={uiClasses.numeric}>Rendimiento</th>
                <th className={uiClasses.numeric}>Costo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/simulaciones/${s.id}`}>{formatDateTime(s.created_at, tz)}</Link>
                  </td>
                  <td>
                    {s.result.recipe_name} · {s.result.version_label}
                  </td>
                  <td className={uiClasses.numeric}>
                    {formatQuantity(s.desired_yield)} {s.result.yield_unit}
                  </td>
                  <td className={uiClasses.numeric}>{formatCLP(s.total_cost)}</td>
                  <td>
                    <StatusBadge status={s.cost_status} /> {s.has_shortages && <Badge tone="warning">Con faltantes</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
