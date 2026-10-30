import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { catalogApi, inventoryApi, type Brand, type Ingredient, type IngredientStock, type Presentation } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Badge, Button, Card, CheckboxField, Loading, PageHeader, Stack, Table, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { DIMENSION_LABEL, formatBaseAmount, useUnits } from './catalog';
import { IngredientForm } from './IngredientForm';

export function IngredientsPage() {
  const navigate = useNavigate();
  const { units } = useUnits();
  const [stock, setStock] = useState<Map<string, IngredientStock>>(new Map());
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [idemKey, renewKey] = useIdempotencyKey();

  const load = useCallback(async () => {
    const [ing, br, pres, st] = await Promise.all([
      catalogApi.listIngredients(),
      catalogApi.listBrands(),
      catalogApi.listPresentations(),
      inventoryApi.listStock(),
    ]);
    const error = ing.error ?? br.error ?? pres.error ?? st.error;
    if (error) return setLoadError(friendlyError(error));
    setIngredients(ing.data ?? []);
    setBrands(br.data ?? []);
    setPresentations(pres.data ?? []);
    setStock(new Map((st.data ?? []).map((s) => [s.ingredient_id, s])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const brandsOf = useCallback(
    (id: string) => brands.filter((b) => b.ingredient_id === id && !b.archived_at).map((b) => b.name),
    [brands],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (ingredients ?? []).filter(
      (i) =>
        (showArchived || !i.archived_at) &&
        (!term ||
          i.name.toLocaleLowerCase('es').includes(term) ||
          brandsOf(i.id).some((b) => b.toLocaleLowerCase('es').includes(term))),
    );
  }, [ingredients, search, showArchived, brandsOf]);

  const presentationCount = (id: string) => {
    const activeBrands = new Set(brands.filter((b) => b.ingredient_id === id && !b.archived_at).map((b) => b.id));
    return presentations.filter((p) => activeBrands.has(p.brand_id) && !p.archived_at).length;
  };

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!ingredients || units.length === 0) return <Loading />;

  return (
    <>
      <PageHeader title="Ingredientes">
        {!creating && <Button onClick={() => setCreating(true)}>Nuevo ingrediente</Button>}
      </PageHeader>

      <Stack>
        {creating && (
          <Card>
            <h2>Nuevo ingrediente</h2>
            <IngredientForm
              submitLabel="Crear ingrediente"
              onCancel={() => setCreating(false)}
              onSubmit={async (input) => {
                const { data, error } = await catalogApi.createIngredient(idemKey, input);
                if (error || !data) return friendlyError(error);
                renewKey();
                navigate(`/ingredientes/${data.id}`);
                return null;
              }}
            />
          </Card>
        )}

        <Card>
          <TextField
            label="Buscar"
            placeholder="Ingrediente o marca"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CheckboxField label="Mostrar archivados" checked={showArchived} onChange={setShowArchived} />

          {ingredients.length === 0 ? (
            <p>
              Aún no tienes ingredientes. Crea el primero (por ejemplo «Harina») y luego agrégale sus marcas y presentaciones.
            </p>
          ) : visible.length === 0 ? (
            <p className={uiClasses.muted}>No hay ingredientes que coincidan con la búsqueda.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Marcas</th>
                  <th>Se mide en</th>
                  <th className={uiClasses.numeric}>Presentaciones</th>
                  <th className={uiClasses.numeric}>Disponible</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => {
                  const names = brandsOf(i.id);
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link to={`/ingredientes/${i.id}`}>{i.name}</Link> {i.archived_at && <Badge>Archivado</Badge>}
                      </td>
                      <td>{names.length ? names.join(', ') : '—'}</td>
                      <td>{DIMENSION_LABEL[i.dimension]}</td>
                      <td className={uiClasses.numeric}>{presentationCount(i.id)}</td>
                      <td className={uiClasses.numeric}>
                        <Link to={`/inventario/${i.id}`}>{formatBaseAmount(Number(stock.get(i.id)?.available ?? 0), i.dimension, units)}</Link>
                      </td>
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
