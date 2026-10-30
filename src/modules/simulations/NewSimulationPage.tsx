import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  recipesApi,
  settingsApi,
  simulationsApi,
  type Estimate,
  type EstimateParams,
  type ExtraCostKind,
  type LaborMode,
  type OperationSettings,
  type PricingMethod,
  type Recipe,
  type RecipeItem,
  type RecipeVersion,
} from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { parseCLP, parseDecimal, quantityToInput } from '../../shared/format';
import {
  Actions,
  Alert,
  Button,
  Card,
  FieldRow,
  Loading,
  PageHeader,
  SelectField,
  Stack,
  Table,
  TextAreaField,
  TextField,
  uiClasses,
} from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { formatAmount, unitSymbol, useUnits } from '../ingredients/catalog';
import { useCatalogIndex } from '../inventory/inventory';
import { EstimateView } from './EstimateView';

type ExtraDraft = { key: string; kind: ExtraCostKind; description: string; amount: string };

/** Factor para pasar un costo por kg / l / unidad a costo por unidad base. */
const PER_BASE = { mass: 1000, volume: 1000, count: 1 } as const;
const COST_UNIT_LABEL = { mass: 'kg', volume: 'l', count: 'unidad' } as const;

export function NewSimulationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { units } = useUnits();
  const { index, error: indexError } = useCatalogIndex();
  const [idemKey] = useIdempotencyKey();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [settings, setSettings] = useState<OperationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [recipeId, setRecipeId] = useState(params.get('receta') ?? '');
  const [versionId, setVersionId] = useState(params.get('version') ?? '');
  const [desired, setDesired] = useState('');
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const [provisional, setProvisional] = useState<Record<string, string>>({});
  const [laborMode, setLaborMode] = useState<'' | LaborMode>('');
  const [laborAmount, setLaborAmount] = useState('');
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [pricingMethod, setPricingMethod] = useState<'' | PricingMethod>('');
  const [pricingValue, setPricingValue] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<{ key: string; estimate: Estimate } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([recipesApi.list(), recipesApi.listVersions(), settingsApi.get()]).then(([r, v, s]) => {
      const e = r.error ?? v.error ?? s.error;
      if (e) return setLoadError(friendlyError(e));
      setRecipes((r.data ?? []).filter((x) => !x.archived_at));
      setVersions(v.data ?? []);
      setSettings(s.data);
      // Si llega solo la versión (por ejemplo, desde una simulación anterior), se deduce la receta.
      const fromVersion = (v.data ?? []).find((x) => x.id === params.get('version'));
      if (fromVersion) setRecipeId(fromVersion.recipe_id);
    });
  }, [params]);

  const recipe = recipes?.find((r) => r.id === recipeId);
  const recipeVersions = versions.filter((v) => v.recipe_id === recipeId);
  const version = recipeVersions.find((v) => v.id === versionId) ?? recipeVersions.find((v) => v.id === recipe?.current_version_id);

  useEffect(() => {
    if (!version) return setItems([]);
    void recipesApi.get(version.recipe_id).then(({ data }) => setItems((data?.items ?? []).filter((i) => i.version_id === version.id)));
  }, [version]);

  function chooseRecipe(id: string) {
    setRecipeId(id);
    setVersionId('');
    setDesired('');
    setAdjust({});
    setProvisional({});
  }

  function choosePricing(method: string) {
    setPricingMethod(method as '' | PricingMethod);
    // Al elegir una opción se propone su valor recomendado (D-025); se puede editar.
    if (method === 'percentage') setPricingValue(quantityToInput(settings?.pricing_percentage ?? 20));
    if (method === 'fixed') setPricingValue(String(settings?.pricing_fixed_clp ?? 5000));
  }

  const built = useMemo((): EstimateParams | string | null => {
    if (!version || !index) return null;
    const desiredYield = desired.trim() ? parseDecimal(desired) : null;
    if (desired.trim() && (desiredYield === null || desiredYield <= 0)) return 'El rendimiento deseado debe ser mayor que cero.';
    const adjustments: EstimateParams['adjustments'] = [];
    for (const item of items) {
      const text = adjust[item.ingredient_id]?.trim();
      if (!text) continue;
      const q = parseDecimal(text);
      if (q === null || q < 0) return `${index.ingredient(item.ingredient_id)?.name}: la cantidad ajustada no es válida.`;
      adjustments.push({ ingredient_id: item.ingredient_id, quantity: q, unit: item.unit });
    }
    const prov: EstimateParams['provisional'] = [];
    for (const [ingredientId, text] of Object.entries(provisional)) {
      if (!text.trim()) continue;
      const v = parseCLP(text);
      const dim = index.ingredient(ingredientId)?.dimension ?? 'mass';
      if (!v) return `${index.ingredient(ingredientId)?.name}: el costo provisional debe ser un monto en pesos.`;
      prov.push({ ingredient_id: ingredientId, unit_cost: v / PER_BASE[dim] });
    }
    let labor: EstimateParams['labor'] = null;
    if (laborMode) {
      const amount = laborAmount.trim() === '0' ? 0 : parseCLP(laborAmount);
      if (amount === null) return 'Indica el costo de mano de obra en pesos.';
      labor = { mode: laborMode, amount_clp: amount };
    }
    const outExtras: EstimateParams['extras'] = [];
    for (const x of extras) {
      const amount = parseCLP(x.amount);
      if (!x.description.trim() || !amount) return 'Cada costo adicional necesita una descripción y un monto en pesos.';
      outExtras.push({ kind: x.kind, description: x.description.trim(), amount_clp: amount });
    }
    let pricing: EstimateParams['pricing'] = null;
    if (pricingMethod) {
      const value = pricingMethod === 'percentage' ? parseDecimal(pricingValue) : pricingValue.trim() === '0' ? 0 : parseCLP(pricingValue);
      if (value === null || value < 0) return 'El valor del precio sugerido no es válido.';
      pricing = { method: pricingMethod, value };
    }
    return { versionId: version.id, desiredYield, adjustments, provisional: prov, labor, extras: outExtras, pricing };
  }, [version, index, desired, items, adjust, provisional, laborMode, laborAmount, extras, pricingMethod, pricingValue]);

  const builtKey = built && typeof built !== 'string' ? JSON.stringify(built) : null;
  const current = result && result.key === builtKey ? result.estimate : null;

  async function calculate() {
    setError(null);
    if (typeof built === 'string') return setError(built);
    if (!built) return;
    setBusy(true);
    const { data, error: e } = await simulationsApi.estimate(built);
    setBusy(false);
    if (e || !data) return setError(friendlyError(e));
    setResult({ key: JSON.stringify(built), estimate: data });
  }

  async function save() {
    if (!built || typeof built === 'string' || !current) return;
    setBusy(true);
    const { data, error: e } = await simulationsApi.save(idemKey, built, notes.trim() || null);
    setBusy(false);
    if (e || !data) return setError(friendlyError(e));
    navigate(`/simulaciones/${data.id}`, { replace: true });
  }

  if (loadError || indexError) return <Alert tone="danger">{loadError ?? indexError}</Alert>;
  if (!recipes || !index || units.length === 0) return <Loading />;

  if (recipes.length === 0) {
    return (
      <>
        <PageHeader title="Nueva simulación" />
        <Alert tone="info">
          <p>
            Primero crea una receta. <Link to="/recetas/nueva">Crear receta</Link>
          </p>
        </Alert>
      </>
    );
  }

  const incompleteLines = current?.lines.filter((l) => l.cost_status === 'incomplete') ?? [];

  return (
    <>
      <p>
        <Link to="/simulaciones">← Simulaciones</Link>
      </p>
      <PageHeader title="Nueva simulación" />
      <p className={uiClasses.muted}>Una simulación estima cantidades, envases y costos. No descuenta inventario ni reserva nada.</p>
      <Stack>
        <Card>
          <SelectField
            label="Receta"
            value={recipeId}
            onChange={chooseRecipe}
            options={[{ value: '', label: 'Elige una receta…' }, ...recipes.map((r) => ({ value: r.id, label: r.name }))]}
          />
          {recipe && (
            <FieldRow>
              <SelectField
                label="Versión"
                value={version?.id ?? ''}
                onChange={setVersionId}
                options={recipeVersions.map((v) => ({
                  value: v.id,
                  label: `${v.label}${v.id === recipe.current_version_id ? ' (vigente)' : ''}`,
                }))}
              />
              <TextField
                label={`Rendimiento deseado${version ? ` (${version.yield_unit})` : ''}`}
                placeholder={version ? quantityToInput(version.yield_quantity) : ''}
                inputMode="decimal"
                value={desired}
                onChange={(e) => setDesired(e.target.value)}
              />
            </FieldRow>
          )}
        </Card>

        {version && items.length > 0 && (
          <Card>
            <h2>Ajustes temporales (opcional)</h2>
            <p className={uiClasses.muted}>Cambian la cantidad solo en esta simulación. Para cambiar la receta, crea una versión nueva.</p>
            <Table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th className={uiClasses.numeric}>En la receta</th>
                  <th>Usar en su lugar</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.line_no}>
                    <td>{index.ingredient(i.ingredient_id)?.name}</td>
                    <td className={uiClasses.numeric}>{formatAmount(i.quantity, i.unit)}</td>
                    <td>
                      <TextField
                        label={`Cantidad (${unitSymbol(i.unit)})`}
                        inputMode="decimal"
                        placeholder="Escalada automáticamente"
                        value={adjust[i.ingredient_id] ?? ''}
                        onChange={(e) => setAdjust((m) => ({ ...m, [i.ingredient_id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {version && (
          <Card>
            <h2>Otros costos</h2>
            <FieldRow>
              <SelectField
                label="Mano de obra"
                value={laborMode}
                onChange={(v) => setLaborMode(v as '' | LaborMode)}
                options={[
                  { value: '', label: 'No registrar (el resultado quedará incompleto)' },
                  { value: 'per_batch', label: 'Por producción completa' },
                  { value: 'per_unit', label: 'Por unidad producida' },
                ]}
              />
              {laborMode && (
                <TextField
                  label={laborMode === 'per_unit' ? 'Costo por unidad (CLP)' : 'Costo total (CLP)'}
                  inputMode="numeric"
                  value={laborAmount}
                  onChange={(e) => setLaborAmount(e.target.value)}
                />
              )}
            </FieldRow>
            {extras.map((x) => (
              <FieldRow key={x.key}>
                <SelectField
                  label="Tipo"
                  value={x.kind}
                  onChange={(v) => setExtras((list) => list.map((e) => (e.key === x.key ? { ...e, kind: v as ExtraCostKind } : e)))}
                  options={[
                    { value: 'packaging', label: 'Envases y embalajes' },
                    { value: 'label', label: 'Etiquetas' },
                    { value: 'presentation', label: 'Presentación' },
                    { value: 'other', label: 'Otro' },
                  ]}
                />
                <TextField
                  label="Descripción"
                  maxLength={120}
                  value={x.description}
                  onChange={(e) => setExtras((list) => list.map((y) => (y.key === x.key ? { ...y, description: e.target.value } : y)))}
                />
                <TextField
                  label="Monto (CLP)"
                  inputMode="numeric"
                  value={x.amount}
                  onChange={(e) => setExtras((list) => list.map((y) => (y.key === x.key ? { ...y, amount: e.target.value } : y)))}
                />
              </FieldRow>
            ))}
            <Actions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setExtras((list) => [...list, { key: crypto.randomUUID(), kind: 'packaging', description: '', amount: '' }])}
              >
                Agregar embalaje, etiqueta u otro costo
              </Button>
              {extras.length > 0 && (
                <Button type="button" variant="link" onClick={() => setExtras((list) => list.slice(0, -1))}>
                  Quitar el último
                </Button>
              )}
            </Actions>

            <h3>Precio sugerido (opcional)</h3>
            <FieldRow>
              <SelectField
                label="Calcular precio"
                value={pricingMethod}
                onChange={choosePricing}
                options={[
                  { value: '', label: 'No calcular' },
                  { value: 'percentage', label: 'Porcentaje sobre el costo' },
                  { value: 'fixed', label: 'Valor fijo sobre el costo' },
                ]}
              />
              {pricingMethod && (
                <TextField
                  label={pricingMethod === 'percentage' ? 'Porcentaje (%)' : 'Valor fijo (CLP)'}
                  hint="Valor recomendado; puedes cambiarlo."
                  inputMode="decimal"
                  value={pricingValue}
                  onChange={(e) => setPricingValue(e.target.value)}
                />
              )}
            </FieldRow>
          </Card>
        )}

        {version && (
          <Card>
            {error && <Alert tone="danger">{error}</Alert>}
            {result && !current && <Alert tone="warning">Cambiaste datos: vuelve a calcular.</Alert>}
            {current && (
              <>
                <h2>Resultado</h2>
                <EstimateView estimate={current} units={units} index={index} />
                {incompleteLines.length > 0 && (
                  <>
                    <h3>Costo provisional (opcional)</h3>
                    <p className={uiClasses.muted}>
                      Para valorar lo que no tiene costo conocido puedes indicar un costo provisional. Quedará marcado como tal.
                    </p>
                    <FieldRow>
                      {incompleteLines.map((l) => (
                        <TextField
                          key={l.ingredient_id}
                          label={`${l.ingredient_name} (CLP por ${COST_UNIT_LABEL[l.dimension]})`}
                          inputMode="numeric"
                          value={provisional[l.ingredient_id] ?? ''}
                          onChange={(e) => setProvisional((m) => ({ ...m, [l.ingredient_id]: e.target.value }))}
                        />
                      ))}
                    </FieldRow>
                  </>
                )}
                <TextAreaField label="Notas (opcional)" maxLength={1000} value={notes} onChange={setNotes} />
              </>
            )}
            {!online && <Alert tone="warning">Sin conexión. Podrás calcular cuando vuelva la conexión.</Alert>}
            <Actions>
              <Button variant={current ? 'secondary' : 'primary'} busy={busy && !current} disabled={!online} onClick={() => void calculate()}>
                Calcular
              </Button>
              <Button busy={busy && !!current} disabled={!online || !current} onClick={() => void save()}>
                Guardar simulación
              </Button>
            </Actions>
          </Card>
        )}
      </Stack>
    </>
  );
}
