import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { recipesApi, type Recipe, type RecipeVersion } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatQuantity } from '../../shared/format';
import { Alert, Badge, ButtonLink, Card, CheckboxField, Loading, PageHeader, Table, TextField, uiClasses } from '../../shared/ui';

export function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void Promise.all([recipesApi.list(), recipesApi.listVersions()]).then(([r, v]) => {
      const e = r.error ?? v.error;
      if (e) return setError(friendlyError(e));
      setRecipes(r.data ?? []);
      setVersions(v.data ?? []);
    });
  }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (recipes ?? []).filter((r) => (showArchived || !r.archived_at) && (!term || r.name.toLocaleLowerCase('es').includes(term)));
  }, [recipes, search, showArchived]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!recipes) return <Loading />;

  return (
    <>
      <PageHeader title="Recetas">
        <ButtonLink to="/recetas/nueva">Nueva receta</ButtonLink>
      </PageHeader>
      <Card>
        <TextField label="Buscar" placeholder="Nombre de la receta" value={search} onChange={(e) => setSearch(e.target.value)} />
        <CheckboxField label="Mostrar archivadas" checked={showArchived} onChange={setShowArchived} />
        {recipes.length === 0 ? (
          <p>Aún no tienes recetas. Crea la primera con sus ingredientes y su rendimiento teórico.</p>
        ) : visible.length === 0 ? (
          <p className={uiClasses.muted}>No hay recetas que coincidan con la búsqueda.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Receta</th>
                <th>Versión vigente</th>
                <th className={uiClasses.numeric}>Rendimiento</th>
                <th className={uiClasses.numeric}>Versiones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const current = versions.find((v) => v.id === r.current_version_id);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/recetas/${r.id}`}>{r.name}</Link> {r.archived_at && <Badge>Archivada</Badge>}
                    </td>
                    <td>{current?.label ?? '—'}</td>
                    <td className={uiClasses.numeric}>{current ? `${formatQuantity(current.yield_quantity)} ${current.yield_unit}` : '—'}</td>
                    <td className={uiClasses.numeric}>{versions.filter((v) => v.recipe_id === r.id).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
