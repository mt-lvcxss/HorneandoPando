import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { inventoryApi, type StockAlert } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Badge, ButtonLink, Card, CheckboxField, Loading, PageHeader, Stack, Table, TextField, uiClasses } from '../../shared/ui';
import { formatBaseAmount, useUnits } from '../ingredients/catalog';
import { useCatalogIndex } from './inventory';

export function InventoryPage() {
  const { units } = useUnits();
  const { index, error } = useCatalogIndex();
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyWithStock, setOnlyWithStock] = useState(false);

  useEffect(() => {
    void inventoryApi.listOpenAlerts().then(({ data, error: e }) => (e ? setAlertsError(friendlyError(e)) : setAlerts(data ?? [])));
  }, []);

  const rows = useMemo(() => {
    if (!index) return [];
    const term = search.trim().toLocaleLowerCase('es');
    return index.ingredients
      .filter((i) => !i.archived_at)
      .map((i) => ({ ingredient: i, stock: index.stock(i.id) }))
      .filter((r) => !term || r.ingredient.name.toLocaleLowerCase('es').includes(term))
      .filter((r) => !onlyWithStock || Number(r.stock?.available ?? 0) > 0);
  }, [index, search, onlyWithStock]);

  if (error || alertsError) return <Alert tone="danger">{error ?? alertsError}</Alert>;
  if (!index || units.length === 0) return <Loading />;

  const outOfStock = alerts.map((a) => index.ingredient(a.ingredient_id)).filter((i) => i && !i.archived_at);

  return (
    <>
      <PageHeader title="Inventario">
        <ButtonLink to="/compras/nueva">Nueva compra</ButtonLink>
      </PageHeader>

      <Stack>
        {outOfStock.length > 0 && (
          <Alert tone="warning" title="Ingredientes agotados">
            <p>
              {outOfStock.map((i, n) => (
                <span key={i!.id}>
                  {n > 0 && ', '}
                  <Link to={`/inventario/${i!.id}`}>{i!.name}</Link>
                </span>
              ))}
              . Registra una compra o una entrada para seguir usándolos.
            </p>
          </Alert>
        )}

        <Card>
          <TextField label="Buscar" placeholder="Ingrediente" value={search} onChange={(e) => setSearch(e.target.value)} />
          <CheckboxField label="Solo ingredientes con stock" checked={onlyWithStock} onChange={setOnlyWithStock} />
          {index.ingredients.length === 0 ? (
            <p>
              Aún no tienes ingredientes. <Link to="/ingredientes">Créalos aquí</Link> y luego registra tus compras.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th className={uiClasses.numeric}>Disponible</th>
                  <th className={uiClasses.numeric}>Envases con stock</th>
                  <th className={uiClasses.numeric}>Abiertos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ingredient, stock }) => {
                  const available = Number(stock?.available ?? 0);
                  const depleted = alerts.some((a) => a.ingredient_id === ingredient.id);
                  return (
                    <tr key={ingredient.id}>
                      <td>
                        <Link to={`/inventario/${ingredient.id}`}>{ingredient.name}</Link>{' '}
                        {depleted && <Badge tone="warning">Agotado</Badge>}
                      </td>
                      <td className={uiClasses.numeric}>{formatBaseAmount(available, ingredient.dimension, units)}</td>
                      <td className={uiClasses.numeric}>{stock?.containers_with_stock ?? 0}</td>
                      <td className={uiClasses.numeric}>{stock?.open_containers ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </Stack>
    </>
  );
}
