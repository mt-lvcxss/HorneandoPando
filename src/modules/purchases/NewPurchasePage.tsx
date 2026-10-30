import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import {
  purchasesApi,
  settingsApi,
  type ChargeDistribution,
  type ChargeTreatment,
  type PartialRule,
  type PurchaseChargeInput,
  type PurchaseLineInput,
  type PurchasePreview,
  type Unit,
} from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, parseCLP, parseDecimal, todayIn } from '../../shared/format';
import {
  Actions,
  Alert,
  Button,
  Card,
  CheckboxField,
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
import { formatAmount, formatBaseAmount, unitSymbol, useUnits } from '../ingredients/catalog';
import { formatUnitCost, useCatalogIndex, type CatalogIndex } from '../inventory/inventory';

type LineDraft = { key: string; presentationId: string; count: string; content: string; list: string; paid: string };
type ChargeDraft = {
  key: string;
  description: string;
  amount: string;
  treatment: ChargeTreatment;
  method: ChargeDistribution;
  rule: PartialRule;
};

const newLine = (): LineDraft => ({ key: crypto.randomUUID(), presentationId: '', count: '1', content: '', list: '', paid: '' });

export function NewPurchasePage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? 'America/Santiago';
  const { units } = useUnits();
  const { index, error: indexError } = useCatalogIndex();
  const [idemKey] = useIdempotencyKey();
  const [date, setDate] = useState(() => todayIn(tz));
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [defaultMethod, setDefaultMethod] = useState<ChargeDistribution>('by_value');
  const [preview, setPreview] = useState<{ payload: string; result: PurchasePreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void settingsApi.get().then(({ data }) => data && setDefaultMethod(data.charge_distribution_default));
  }, []);

  const options = useMemo(
    () => [{ value: '', label: 'Elige un producto…' }, ...(index?.buyable ?? []).map((b) => ({ value: b.presentation.id, label: b.label }))],
    [index],
  );

  /** Convierte el borrador en los datos que valida y calcula el servidor. */
  function buildPayload(): { lines: PurchaseLineInput[]; charges: PurchaseChargeInput[] } | string {
    const out: PurchaseLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      const n = i + 1;
      if (!l.presentationId) return `Producto ${n}: elige qué compraste.`;
      const count = Number(l.count);
      if (!Number.isInteger(count) || count < 1) return `Producto ${n}: el número de envases debe ser un entero mayor que cero.`;
      const paid = parseCLP(l.paid);
      if (!paid) return `Producto ${n}: indica el total pagado en pesos.`;
      const line: PurchaseLineInput = { presentation_id: l.presentationId, container_count: count, paid_total_clp: paid };
      if (l.content.trim()) {
        const content = parseDecimal(l.content);
        if (content === null || content <= 0) return `Producto ${n}: el contenido por envase debe ser mayor que cero.`;
        line.content_per_container = content;
      }
      if (l.list.trim()) {
        const list = parseCLP(l.list);
        if (!list) return `Producto ${n}: el precio de lista debe ser un monto en pesos.`;
        line.list_total_clp = list;
      }
      out.push(line);
    }
    const outCharges: PurchaseChargeInput[] = [];
    for (const [i, c] of charges.entries()) {
      const amount = parseCLP(c.amount);
      if (!c.description.trim()) return `Cargo ${i + 1}: describe el cargo.`;
      if (!amount) return `Cargo ${i + 1}: indica el monto en pesos.`;
      outCharges.push(
        c.treatment === 'separate_expense'
          ? { description: c.description.trim(), amount_clp: amount, treatment: c.treatment }
          : { description: c.description.trim(), amount_clp: amount, treatment: c.treatment, method: c.method, partial_rule: c.rule },
      );
    }
    return { lines: out, charges: outCharges };
  }

  const payload = buildPayload();
  const payloadKey = typeof payload === 'string' ? null : JSON.stringify(payload);
  const previewValid = preview !== null && preview.payload === payloadKey;

  async function review() {
    setError(null);
    if (typeof payload === 'string') return setError(payload);
    setBusy(true);
    const { data, error: rpcError } = await purchasesApi.preview(payload.lines, payload.charges);
    setBusy(false);
    if (rpcError || !data) return setError(friendlyError(rpcError));
    setPreview({ payload: payloadKey!, result: data });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (typeof payload === 'string' || !previewValid) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await purchasesApi.confirm(idemKey, {
      purchasedOn: date,
      lines: payload.lines,
      charges: payload.charges,
      reference: reference.trim() || null,
      pendingVerification: pending,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (rpcError || !data) return setError(friendlyError(rpcError));
    navigate(`/compras/${data.id}`, { replace: true });
  }

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setCharge = (key: string, patch: Partial<ChargeDraft>) =>
    setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  if (indexError) return <Alert tone="danger">{indexError}</Alert>;
  if (!index || units.length === 0) return <Loading />;

  if (index.buyable.length === 0) {
    return (
      <>
        <PageHeader title="Nueva compra" />
        <Alert tone="info" title="Primero registra lo que compras">
          <p>
            Para registrar una compra necesitas al menos un ingrediente con una marca y una presentación.{' '}
            <Link to="/ingredientes">Ir a ingredientes</Link>
          </p>
        </Alert>
      </>
    );
  }

  return (
    <>
      <p>
        <Link to="/compras">← Compras</Link>
      </p>
      <PageHeader title="Nueva compra" />
      <form onSubmit={confirm} noValidate>
        <Stack>
          <Card>
            <FieldRow>
              <TextField label="Fecha de compra" type="date" max={todayIn(tz)} value={date} onChange={(e) => setDate(e.target.value)} />
              <TextField
                label="Referencia (opcional)"
                placeholder="N° de boleta, proveedor…"
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </FieldRow>
            <CheckboxField
              label="Pendiente de verificación"
              hint="Márcala si aún debes revisar lo recibido contra la boleta. El inventario se incorpora igual."
              checked={pending}
              onChange={setPending}
            />
          </Card>

          <Card>
            <h2>Productos</h2>
            {lines.map((l, i) => {
              const item = index.buyable.find((b) => b.presentation.id === l.presentationId);
              return (
                <section key={l.key} className={i > 0 ? uiClasses.subsection : undefined}>
                  <SelectField
                    label={`Producto ${i + 1}`}
                    value={l.presentationId}
                    onChange={(v) => setLine(l.key, { presentationId: v })}
                    options={options}
                  />
                  <FieldRow>
                    <TextField
                      label="N° de envases"
                      inputMode="numeric"
                      value={l.count}
                      onChange={(e) => setLine(l.key, { count: e.target.value })}
                    />
                    <TextField
                      label={`Contenido real por envase${item ? ` (${unitSymbol(item.presentation.unit)})` : ''}`}
                      hint={item ? `Vacío = ${formatAmount(item.presentation.quantity, item.presentation.unit)}` : undefined}
                      inputMode="decimal"
                      value={l.content}
                      onChange={(e) => setLine(l.key, { content: e.target.value })}
                    />
                  </FieldRow>
                  <FieldRow>
                    <TextField
                      label="Total pagado (CLP)"
                      inputMode="numeric"
                      value={l.paid}
                      onChange={(e) => setLine(l.key, { paid: e.target.value })}
                    />
                    <TextField
                      label="Precio de lista total (opcional)"
                      hint="Antes de descuentos."
                      inputMode="numeric"
                      value={l.list}
                      onChange={(e) => setLine(l.key, { list: e.target.value })}
                    />
                  </FieldRow>
                  {lines.length > 1 && (
                    <Button type="button" variant="link" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Quitar producto
                    </Button>
                  )}
                </section>
              );
            })}
            <Actions>
              <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine()])}>
                Agregar otro producto
              </Button>
            </Actions>
          </Card>

          <Card>
            <h2>Cargos adicionales</h2>
            <p className={uiClasses.muted}>Transporte, despacho u otros cargos de esta compra.</p>
            {charges.map((c, i) => (
              <section key={c.key} className={uiClasses.subsection}>
                <FieldRow>
                  <TextField
                    label={`Cargo ${i + 1}`}
                    placeholder="Despacho"
                    maxLength={120}
                    value={c.description}
                    onChange={(e) => setCharge(c.key, { description: e.target.value })}
                  />
                  <TextField
                    label="Monto (CLP)"
                    inputMode="numeric"
                    value={c.amount}
                    onChange={(e) => setCharge(c.key, { amount: e.target.value })}
                  />
                </FieldRow>
                <SelectField
                  label="Cómo se registra"
                  value={c.treatment}
                  onChange={(v) => setCharge(c.key, { treatment: v as ChargeTreatment })}
                  options={[
                    { value: 'distributed', label: 'Distribuir entre los productos (forma parte de su costo)' },
                    { value: 'separate_expense', label: 'Gasto separado (no se suma al costo de los productos)' },
                  ]}
                />
                {c.treatment === 'distributed' && (
                  <FieldRow>
                    <SelectField
                      label="Distribuir"
                      value={c.method}
                      onChange={(v) => setCharge(c.key, { method: v as ChargeDistribution })}
                      options={[
                        { value: 'by_value', label: 'Según el valor pagado' },
                        { value: 'by_quantity', label: 'Según la cantidad física' },
                      ]}
                    />
                    <SelectField
                      label="En envases usados en parte"
                      value={c.rule}
                      onChange={(v) => setCharge(c.key, { rule: v as PartialRule })}
                      options={[
                        { value: 'proportional', label: 'Proporcional a lo consumido' },
                        { value: 'first_use', label: 'Completo en el primer uso' },
                      ]}
                    />
                  </FieldRow>
                )}
                <Button type="button" variant="link" onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))}>
                  Quitar cargo
                </Button>
              </section>
            ))}
            <Actions>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setCharges((cs) => [
                    ...cs,
                    { key: crypto.randomUUID(), description: '', amount: '', treatment: 'distributed', method: defaultMethod, rule: 'proportional' },
                  ])
                }
              >
                Agregar cargo
              </Button>
            </Actions>
          </Card>

          <Card>
            <TextAreaField label="Notas (opcional)" maxLength={1000} value={notes} onChange={setNotes} />
            {error && <Alert tone="danger">{error}</Alert>}
            {preview && !previewValid && (
              <Alert tone="warning">Cambiaste datos después de revisar. Vuelve a revisar la compra antes de confirmarla.</Alert>
            )}
            {previewValid && <PreviewTable preview={preview.result} index={index} units={units} />}
            {!online && <Alert tone="warning">Sin conexión. Podrás registrar la compra cuando vuelva la conexión.</Alert>}
            <Actions>
              <Button type="button" variant={previewValid ? 'secondary' : 'primary'} busy={busy && !previewValid} disabled={!online} onClick={() => void review()}>
                Revisar compra
              </Button>
              <Button type="submit" busy={busy && previewValid} disabled={!online || !previewValid}>
                Confirmar compra
              </Button>
            </Actions>
          </Card>
        </Stack>
      </form>
    </>
  );
}

type PreviewProps = { preview: PurchasePreview; index: CatalogIndex; units: Unit[] };

function PreviewTable({ preview, index, units }: PreviewProps) {
  const distributed = preview.charges.filter((c) => c.treatment === 'distributed');
  return (
    <>
      <h2>Resumen</h2>
      <Table>
        <thead>
          <tr>
            <th>Producto</th>
            <th className={uiClasses.numeric}>Entra al inventario</th>
            <th className={uiClasses.numeric}>Pagado</th>
            {distributed.map((c) => (
              <th key={c.charge_no} className={uiClasses.numeric}>
                {c.description}
              </th>
            ))}
            <th className={uiClasses.numeric}>Costo del producto</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l, i) => {
            const dim = index.ingredient(l.ingredient_id)?.dimension ?? 'mass';
            return (
              <tr key={l.line_no}>
                <td>
                  {l.ingredient_name} · {l.brand_name}
                  <br />
                  <span className={uiClasses.muted}>
                    {l.container_count} × {formatAmount(l.content_per_container, l.content_unit)}
                  </span>
                </td>
                <td className={uiClasses.numeric}>{formatBaseAmount(l.incorporated_quantity, dim, units)}</td>
                <td className={uiClasses.numeric}>{formatCLP(l.paid_total_clp)}</td>
                {distributed.map((c) => (
                  <td key={c.charge_no} className={uiClasses.numeric}>
                    {formatCLP(c.allocations?.[i] ?? 0)}
                  </td>
                ))}
                <td className={uiClasses.numeric}>{formatUnitCost(l.unit_cost, dim)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p>
        Total pagado en productos: <strong>{formatCLP(preview.paid_total_clp)}</strong>
        {preview.distributed_charges_clp > 0 && <> · Cargos distribuidos: {formatCLP(preview.distributed_charges_clp)}</>}
        {preview.separate_charges_clp > 0 && <> · Gastos separados: {formatCLP(preview.separate_charges_clp)}</>}
      </p>
      {distributed.length > 0 && (
        <p className={uiClasses.muted}>
          Los cargos distribuidos se guardan aparte del costo del producto y se suman al consumirlo, según la regla elegida.
          Cada peso del cargo se asigna a un solo producto.
        </p>
      )}
    </>
  );
}
