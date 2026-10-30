import { useEffect, useState, type FormEvent } from 'react';
import { settingsApi, type ChargeDistribution, type OperationSettings } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, parseCLP, parseDecimal, quantityToInput } from '../../shared/format';
import { Alert, Button, Card, CheckboxField, FieldRow, Loading, SelectField, TextField } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';

type Form = {
  finishedGoods: boolean;
  distribution: ChargeDistribution;
  percentage: string;
  fixed: string;
};

const toForm = (s: OperationSettings): Form => ({
  finishedGoods: s.finished_goods_tracking,
  distribution: s.charge_distribution_default,
  percentage: quantityToInput(s.pricing_percentage),
  fixed: String(s.pricing_fixed_clp),
});

export function OperationSettingsPage() {
  const online = useOnlineStatus();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void settingsApi.get().then(({ data, error }) => {
      if (error || !data) return setLoadError(friendlyError(error));
      setSaved(toForm(data));
      setForm(toForm(data));
    });
  }, []);

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!form || !saved) return <Loading />;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setResult(null);
    const percentage = parseDecimal(form.percentage);
    if (percentage === null || percentage < 0 || percentage > 1000) {
      return setResult({ tone: 'danger', text: 'El porcentaje recomendado debe ser un número entre 0 y 1.000.' });
    }
    const fixed = form.fixed.trim() === '0' ? 0 : parseCLP(form.fixed);
    if (fixed === null) return setResult({ tone: 'danger', text: 'El valor fijo recomendado debe ser un monto en pesos.' });

    setBusy(true);
    const { data, error } = await settingsApi.update({
      finished_goods_tracking: form.finishedGoods,
      charge_distribution_default: form.distribution,
      pricing_percentage: percentage,
      pricing_fixed_clp: fixed,
    });
    setBusy(false);
    if (error || !data) return setResult({ tone: 'danger', text: friendlyError(error) });
    setSaved(toForm(data));
    setForm(toForm(data));
    setResult({ tone: 'success', text: 'Configuración guardada.' });
  }

  return (
    <>
      <h1>Configuración de la operación</h1>
      <Card>
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <form onSubmit={submit} noValidate>
          <CheckboxField
            label="Llevar inventario de productos terminados"
            hint="Si lo activas, registrarás cuántas unidades produjiste, cuántas quedan disponibles y su destino. Si está desactivado, las producciones y ventas se registran igual, pero la aplicación no puede comprobar cuántos productos terminados tienes."
            checked={form.finishedGoods}
            onChange={(v) => setForm({ ...form, finishedGoods: v })}
          />
          <SelectField
            label="Distribución propuesta de cargos adicionales"
            hint="Cómo se reparten por defecto el transporte y otros cargos de una compra entre sus productos. Podrás cambiarlo en cada compra."
            value={form.distribution}
            onChange={(v) => setForm({ ...form, distribution: v as ChargeDistribution })}
            options={[
              { value: 'by_value', label: 'Proporcional al valor de compra' },
              { value: 'by_quantity', label: 'Proporcional a la cantidad física' },
            ]}
          />

          <h2>Precio sugerido</h2>
          <p>
            Al simular una receta puedes pedir un precio sugerido, sumando al costo un porcentaje o un valor fijo. Estos son los
            valores que se proponen al elegir cada opción; en cada simulación puedes cambiarlos.
          </p>
          <FieldRow>
            <TextField
              label="Porcentaje recomendado (%)"
              hint={`Ejemplo: costo $10.000 + ${form.percentage || '0'} % = ${formatCLP(10000 * (1 + (parseDecimal(form.percentage) ?? 0) / 100))}`}
              inputMode="decimal"
              value={form.percentage}
              onChange={(e) => setForm({ ...form, percentage: e.target.value })}
            />
            <TextField
              label="Valor fijo recomendado (CLP)"
              hint={`Ejemplo: costo $10.000 + ${formatCLP(parseCLP(form.fixed) ?? 0)} = ${formatCLP(10000 + (parseCLP(form.fixed) ?? 0))}`}
              inputMode="numeric"
              value={form.fixed}
              onChange={(e) => setForm({ ...form, fixed: e.target.value })}
            />
          </FieldRow>

          {!online && <Alert tone="warning">Sin conexión. Podrás guardar cuando vuelva la conexión.</Alert>}
          <Button type="submit" busy={busy} disabled={!online || !dirty}>
            Guardar
          </Button>
        </form>
      </Card>
    </>
  );
}
