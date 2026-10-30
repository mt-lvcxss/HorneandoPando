import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { catalogApi, type Brand, type Equivalence, type Ingredient, type Presentation } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Badge, Button, Card, Dialog, Loading, PageHeader, Stack, Table } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BrandsSection } from './BrandsSection';
import { DIMENSION_LABEL, useUnits } from './catalog';
import { EquivalencesCard } from './EquivalencesCard';
import { IngredientForm } from './IngredientForm';

type Data = {
  ingredient: Ingredient;
  brands: Brand[];
  presentations: Presentation[];
  equivalences: Equivalence[];
};

export function IngredientDetailPage() {
  const { id = '' } = useParams();
  const online = useOnlineStatus();
  const { units, error: unitsError } = useUnits();
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ing, brands, pres, eq] = await Promise.all([
      catalogApi.getIngredient(id),
      catalogApi.listBrands(id),
      catalogApi.listPresentations(id),
      catalogApi.listEquivalences(id),
    ]);
    const error = ing.error ?? brands.error ?? pres.error ?? eq.error;
    if (error) return setLoadError(friendlyError(error));
    if (!ing.data) return setNotFound(true);
    setData({ ingredient: ing.data, brands: brands.data ?? [], presentations: pres.data ?? [], equivalences: eq.data ?? [] });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <Alert tone="warning" title="Ingrediente no encontrado">
        <p>
          No existe o no pertenece a tu cuenta. <Link to="/ingredientes">Volver a ingredientes</Link>
        </p>
      </Alert>
    );
  }
  if (loadError || unitsError) return <Alert tone="danger">{loadError ?? friendlyError(unitsError)}</Alert>;
  if (!data || units.length === 0) return <Loading />;

  const { ingredient, brands, presentations, equivalences } = data;
  const archived = !!ingredient.archived_at;
  const dimensionLocked = presentations.length > 0 || equivalences.length > 0;

  async function setArchived(value: boolean) {
    setBusy(true);
    setActionError(null);
    const { error } = await catalogApi.setIngredientArchived(ingredient.id, value);
    if (error) setActionError(friendlyError(error));
    await load();
    setBusy(false);
    setConfirmArchive(false);
  }

  return (
    <>
      <p>
        <Link to="/ingredientes">← Ingredientes</Link>
      </p>
      <PageHeader title={ingredient.name}>
        {archived ? (
          <>
            <Badge>Archivado</Badge>
            <Button variant="secondary" busy={busy} disabled={!online} onClick={() => void setArchived(false)}>
              Restaurar
            </Button>
          </>
        ) : (
          !editing && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button variant="secondary" disabled={!online} onClick={() => setConfirmArchive(true)}>
                Archivar
              </Button>
            </>
          )
        )}
      </PageHeader>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Stack>
        <Card>
          {editing ? (
            <>
              <h2>Editar ingrediente</h2>
              <IngredientForm
                initial={ingredient}
                dimensionLocked={dimensionLocked}
                submitLabel="Guardar cambios"
                onCancel={() => setEditing(false)}
                onSubmit={async (input) => {
                  const { error } = await catalogApi.updateIngredient(ingredient.id, input);
                  if (error) return friendlyError(error);
                  await load();
                  setEditing(false);
                  return null;
                }}
              />
            </>
          ) : (
            <Table>
              <tbody>
                <tr>
                  <th>Se mide en</th>
                  <td>{DIMENSION_LABEL[ingredient.dimension]}</td>
                </tr>
                <tr>
                  <th>Notas</th>
                  <td>{ingredient.notes ?? '—'}</td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>

        <BrandsSection ingredient={ingredient} units={units} brands={brands} presentations={presentations} onChanged={load} />

        <EquivalencesCard ingredient={ingredient} units={units} equivalences={equivalences} onChanged={load} />
      </Stack>

      {confirmArchive && (
        <Dialog
          title="¿Archivar este ingrediente?"
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
                Cancelar
              </Button>
              <Button busy={busy} onClick={() => void setArchived(true)}>
                Archivar
              </Button>
            </>
          }
        >
          <p>
            Dejará de aparecer en las listas junto con sus marcas, pero se conserva todo su historial. Puedes restaurarlo
            cuando quieras.
          </p>
        </Dialog>
      )}
    </>
  );
}
