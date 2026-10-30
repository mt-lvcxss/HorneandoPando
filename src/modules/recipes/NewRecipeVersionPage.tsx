import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { recipesApi, type Recipe, type RecipeItem, type RecipeVersion, type RecipeVersionKind } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Card, CheckboxField, Loading, PageHeader, SelectField, TextField } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { RecipeVersionForm } from './RecipeVersionForm';
import { useRecipeCatalog } from './recipes';

type Data = { recipe: Recipe; versions: RecipeVersion[]; items: RecipeItem[] };

export function NewRecipeVersionPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { ingredients, units, equivalences, error: catalogError } = useRecipeCatalog();
  const [idemKey] = useIdempotencyKey();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<RecipeVersionKind>(params.get('tipo') === 'alternative' ? 'alternative' : 'main');
  const [makeCurrent, setMakeCurrent] = useState(params.get('tipo') !== 'alternative');
  const [label, setLabel] = useState('');
  const [changeNote, setChangeNote] = useState('');

  useEffect(() => {
    void recipesApi.get(id).then(({ data: d, error: e }) => (e || !d ? setError(e ? friendlyError(e) : 'La receta no existe.') : setData(d)));
  }, [id]);

  if (error || catalogError) return <Alert tone="danger">{error ?? catalogError}</Alert>;
  if (!data || !ingredients) return <Loading />;

  const baseId = params.get('base') ?? data.recipe.current_version_id;
  const baseVersion = data.versions.find((v) => v.id === baseId) ?? data.versions[0];
  const base = baseVersion ? { version: baseVersion, items: data.items.filter((i) => i.version_id === baseVersion.id) } : undefined;

  function changeKind(value: string) {
    setKind(value as RecipeVersionKind);
    setMakeCurrent(value === 'main');
  }

  return (
    <>
      <p>
        <Link to={`/recetas/${id}`}>← {data.recipe.name}</Link>
      </p>
      <PageHeader title="Nueva versión" />
      <Card>
        <p>
          Partes de <strong>{baseVersion?.label}</strong>. Las versiones anteriores no cambian: las producciones ya registradas
          conservan la versión que usaron.
        </p>
        <RecipeVersionForm
          key={baseVersion?.id}
          ingredients={ingredients}
          units={units}
          equivalences={equivalences}
          base={base}
          header={
            <>
              <SelectField
                label="Tipo de versión"
                value={kind}
                onChange={changeKind}
                options={[
                  { value: 'main', label: 'Principal: modifica la receta (reemplaza a la vigente)' },
                  { value: 'alternative', label: 'Alternativa: una variante que conserva la formulación base' },
                ]}
              />
              <TextField
                label="Nombre de la versión (opcional)"
                placeholder={kind === 'main' ? 'Por ejemplo: menos azúcar' : 'Por ejemplo: sin gluten'}
                maxLength={80}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <TextField
                label="Qué cambió (opcional)"
                maxLength={500}
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
              <CheckboxField
                label="Usar esta versión como vigente"
                hint="La versión vigente es la que se propone por defecto al simular o producir."
                checked={makeCurrent}
                onChange={setMakeCurrent}
              />
            </>
          }
          submitLabel="Guardar versión"
          onCancel={() => navigate(`/recetas/${id}`)}
          onSubmit={async (input) => {
            const { data: v, error: e } = await recipesApi.createVersion(idemKey, id, {
              ...input,
              kind,
              label: label.trim() || null,
              basedOn: baseVersion?.id ?? null,
              changeNote: changeNote.trim() || null,
              makeCurrent,
            });
            if (e || !v) return friendlyError(e);
            navigate(`/recetas/${id}?version=${v.id}`, { replace: true });
            return null;
          }}
        />
      </Card>
    </>
  );
}
