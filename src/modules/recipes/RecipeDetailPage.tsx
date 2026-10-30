import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { recipesApi, type Recipe, type RecipeItem, type RecipeVersion } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatDateTime, formatQuantity, parseDecimal } from '../../shared/format';
import {
  Actions,
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Loading,
  PageHeader,
  SelectField,
  Stack,
  Table,
  TextAreaField,
  TextField,
  uiClasses,
} from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { formatAmount } from '../ingredients/catalog';
import { TheoreticalCost } from '../simulations/TheoreticalCost';
import { scaledAmount, useRecipeCatalog, VERSION_KIND_LABEL } from './recipes';

type Data = { recipe: Recipe; versions: RecipeVersion[]; items: RecipeItem[] };

export function RecipeDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const { ingredients, error: catalogError } = useRecipeCatalog();
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [desired, setDesired] = useState('');
  const [compareWith, setCompareWith] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: e } = await recipesApi.get(id);
    if (e) return setError(friendlyError(e));
    if (!d) return setNotFound(true);
    setData(d);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <Alert tone="warning" title="Receta no encontrada">
        <p>
          No existe o no pertenece a tu cuenta. <Link to="/recetas">Volver a recetas</Link>
        </p>
      </Alert>
    );
  }
  if (error || catalogError) return <Alert tone="danger">{error ?? catalogError}</Alert>;
  if (!data || !ingredients) return <Loading />;

  const { recipe, versions, items } = data;
  const selected = versions.find((v) => v.id === params.get('version')) ?? versions.find((v) => v.id === recipe.current_version_id) ?? versions[0];
  if (!selected) return <Alert tone="danger">La receta no tiene versiones.</Alert>;
  const selectedItems = items.filter((i) => i.version_id === selected.id);
  const ingredientName = (ingredientId: string) => ingredients.find((i) => i.id === ingredientId)?.name ?? '—';
  const archived = !!recipe.archived_at;

  const desiredValue = parseDecimal(desired);
  const factor = desiredValue && desiredValue > 0 ? desiredValue / Number(selected.yield_quantity) : null;

  const other = versions.find((v) => v.id === compareWith);
  const otherItems = other ? items.filter((i) => i.version_id === other.id) : [];
  const compared = other
    ? [...new Set([...selectedItems, ...otherItems].map((i) => i.ingredient_id))].map((ingredientId) => ({
        ingredientId,
        a: selectedItems.find((i) => i.ingredient_id === ingredientId),
        b: otherItems.find((i) => i.ingredient_id === ingredientId),
      }))
    : [];

  async function run(action: () => Promise<{ error: unknown }>) {
    setActionError(null);
    const { error: e } = await action();
    if (e) setActionError(friendlyError(e));
    await load();
  }

  const select = (versionId: string) => setParams(versionId === recipe.current_version_id ? {} : { version: versionId });

  return (
    <>
      <p>
        <Link to="/recetas">← Recetas</Link>
      </p>
      <PageHeader title={recipe.name}>
        {archived ? (
          <>
            <Badge>Archivada</Badge>
            <Button variant="secondary" disabled={!online} onClick={() => void run(() => recipesApi.setArchived(recipe.id, false))}>
              Restaurar
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar nombre
            </Button>
            <Button variant="secondary" disabled={!online} onClick={() => void run(() => recipesApi.setArchived(recipe.id, true))}>
              Archivar
            </Button>
          </>
        )}
      </PageHeader>
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Stack>
        {editing && (
          <RecipeNameForm
            recipe={recipe}
            onDone={async () => {
              setEditing(false);
              await load();
            }}
            onCancel={() => setEditing(false)}
          />
        )}
        {!editing && recipe.description && <p>{recipe.description}</p>}

        <Card>
          <h2>
            {selected.label}{' '}
            {selected.id === recipe.current_version_id ? <Badge tone="success">Vigente</Badge> : <Badge>{VERSION_KIND_LABEL[selected.kind]}</Badge>}
          </h2>
          <p className={uiClasses.muted}>
            Rinde {formatQuantity(selected.yield_quantity)} {selected.yield_unit} · creada {formatDateTime(selected.created_at, tz)}
            {selected.change_note && <> · {selected.change_note}</>}
          </p>

          <ScalingField yieldUnit={selected.yield_unit} desired={desired} onChange={setDesired} />

          <Table>
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th className={uiClasses.numeric}>Cantidad</th>
                {factor !== null && (
                  <th className={uiClasses.numeric}>
                    Para {formatQuantity(desiredValue)} {selected.yield_unit}
                  </th>
                )}
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {selectedItems.map((i) => (
                <tr key={i.line_no}>
                  <td>{ingredientName(i.ingredient_id)}</td>
                  <td className={uiClasses.numeric}>{formatAmount(i.quantity, i.unit)}</td>
                  {factor !== null && <td className={uiClasses.numeric}>{scaledAmount(i, factor)}</td>}
                  <td>{i.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {factor !== null && (
            <p className={uiClasses.muted}>
              Cálculo exacto, sin redondear (factor {formatQuantity(factor)}). Tú decides cómo ejecutarlo; este escalado no modifica la
              receta.
            </p>
          )}
          {selected.instructions && (
            <>
              <h3>Instrucciones</h3>
              <p className={uiClasses.preWrap}>{selected.instructions}</p>
            </>
          )}
          {!archived && (
            <Actions>
              <ButtonLink to={`/recetas/${recipe.id}/nueva-version?base=${selected.id}&tipo=main`}>Modificar receta</ButtonLink>
              <ButtonLink to={`/recetas/${recipe.id}/nueva-version?base=${selected.id}&tipo=alternative`} variant="secondary">
                Crear alternativa
              </ButtonLink>
              {selected.id !== recipe.current_version_id && (
                <Button variant="secondary" disabled={!online} onClick={() => void run(() => recipesApi.setCurrentVersion(recipe.id, selected.id))}>
                  Usar como vigente
                </Button>
              )}
            </Actions>
          )}
        </Card>

        <TheoreticalCost versionId={selected.id} />

        <Card>
          <h2>Historial de versiones</h2>
          <Table>
            <thead>
              <tr>
                <th>Versión</th>
                <th>Tipo</th>
                <th className={uiClasses.numeric}>Rendimiento</th>
                <th>Creada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.label} {v.id === recipe.current_version_id && <Badge tone="success">Vigente</Badge>}
                    {v.change_note && (
                      <>
                        <br />
                        <span className={uiClasses.muted}>{v.change_note}</span>
                      </>
                    )}
                  </td>
                  <td>{VERSION_KIND_LABEL[v.kind]}</td>
                  <td className={uiClasses.numeric}>
                    {formatQuantity(v.yield_quantity)} {v.yield_unit}
                  </td>
                  <td>{formatDateTime(v.created_at, tz)}</td>
                  <td>{v.id !== selected.id && <Button variant="link" onClick={() => select(v.id)}>Ver</Button>}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          {versions.length > 1 && (
            <>
              <h3>Comparar</h3>
              <SelectField
                label={`Comparar «${selected.label}» con`}
                value={compareWith}
                onChange={setCompareWith}
                options={[
                  { value: '', label: 'Elige una versión…' },
                  ...versions.filter((v) => v.id !== selected.id).map((v) => ({ value: v.id, label: v.label })),
                ]}
              />
              {other && (
                <Table>
                  <thead>
                    <tr>
                      <th>Ingrediente</th>
                      <th className={uiClasses.numeric}>{selected.label}</th>
                      <th className={uiClasses.numeric}>{other.label}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Rendimiento</td>
                      <td className={uiClasses.numeric}>
                        {formatQuantity(selected.yield_quantity)} {selected.yield_unit}
                      </td>
                      <td className={uiClasses.numeric}>
                        {formatQuantity(other.yield_quantity)} {other.yield_unit}
                      </td>
                      <td>
                        {(Number(selected.yield_quantity) !== Number(other.yield_quantity) || selected.yield_unit !== other.yield_unit) && (
                          <Badge tone="warning">Cambia</Badge>
                        )}
                      </td>
                    </tr>
                    {compared.map(({ ingredientId, a, b }) => {
                      const changed = !a || !b || Number(a.quantity) !== Number(b.quantity) || a.unit !== b.unit;
                      return (
                        <tr key={ingredientId}>
                          <td>{ingredientName(ingredientId)}</td>
                          <td className={uiClasses.numeric}>{a ? formatAmount(a.quantity, a.unit) : '—'}</td>
                          <td className={uiClasses.numeric}>{b ? formatAmount(b.quantity, b.unit) : '—'}</td>
                          <td>{changed && <Badge tone="warning">{!a ? 'Solo en la otra' : !b ? 'Solo en esta' : 'Cambia'}</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </Card>
      </Stack>
    </>
  );
}

function ScalingField({ yieldUnit, desired, onChange }: { yieldUnit: string; desired: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label={`Calcular para otro rendimiento (${yieldUnit})`}
      hint="Escala todos los ingredientes en proporción. No cambia la receta."
      inputMode="decimal"
      value={desired}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function RecipeNameForm({ recipe, onDone, onCancel }: { recipe: Recipe; onDone: () => Promise<void>; onCancel: () => void }) {
  const online = useOnlineStatus();
  const [name, setName] = useState(recipe.name);
  const [description, setDescription] = useState(recipe.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Ingresa el nombre de la receta.');
    setBusy(true);
    const { error: e } = await recipesApi.update(recipe.id, name.trim(), description.trim() || null);
    setBusy(false);
    if (e) return setError(friendlyError(e));
    await onDone();
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label="Nombre" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <TextAreaField label="Descripción (opcional)" maxLength={1000} value={description} onChange={setDescription} />
        <p className={uiClasses.muted}>Cambiar el nombre no crea una versión: la formulación no cambia.</p>
        <Actions>
          <Button type="submit" busy={busy} disabled={!online}>
            Guardar
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </Actions>
      </form>
    </Card>
  );
}
