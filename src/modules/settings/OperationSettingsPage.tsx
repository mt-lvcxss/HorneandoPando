import { useEffect, useState, type FormEvent } from 'react';
import { settingsApi, type ChargeDistribution, type OperationSettings } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Button, Card, CheckboxField, Loading, SelectField } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';

type Form = Omit<OperationSettings, 'updated_at'>;

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
      const { updated_at: _ignored, ...rest } = data;
      setSaved(rest);
      setForm(rest);
    });
  }, []);

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!form || !saved) return <Loading />;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setResult(null);
    const { data, error } = await settingsApi.update(form);
    setBusy(false);
    if (error || !data) return setResult({ tone: 'danger', text: friendlyError(error) });
    const { updated_at: _ignored, ...rest } = data;
    setSaved(rest);
    setForm(rest);
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
            checked={form.finished_goods_tracking}
            onChange={(v) => setForm({ ...form, finished_goods_tracking: v })}
          />
          <SelectField
            label="Distribución propuesta de cargos adicionales"
            hint="Cómo se reparten por defecto el transporte y otros cargos de una compra entre sus productos. Podrás cambiarlo en cada compra."
            value={form.charge_distribution_default}
            onChange={(v) => setForm({ ...form, charge_distribution_default: v as ChargeDistribution })}
            options={[
              { value: 'by_value', label: 'Proporcional al valor de compra' },
              { value: 'by_quantity', label: 'Proporcional a la cantidad física' },
            ]}
          />
          {!online && <Alert tone="warning">Sin conexión. Podrás guardar cuando vuelva la conexión.</Alert>}
          <Button type="submit" busy={busy} disabled={!online || !dirty}>
            Guardar
          </Button>
        </form>
      </Card>
    </>
  );
}
