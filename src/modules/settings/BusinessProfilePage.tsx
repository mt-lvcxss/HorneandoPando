import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { accountApi } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Button, Card, SelectField, TextField } from '../../shared/ui';
import { useOnlineStatus } from '../../shared/useOnlineStatus';

type Form = { businessName: string; contactEmail: string; contactPhone: string; timezone: string };

const DEFAULT_TIMEZONE = 'America/Santiago';

function timezoneOptions() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [DEFAULT_TIMEZONE];
  const list = zones.includes(DEFAULT_TIMEZONE) ? zones : [DEFAULT_TIMEZONE, ...zones];
  return list.map((z) => ({ value: z, label: z === DEFAULT_TIMEZONE ? `${z} (Chile continental)` : z }));
}

export function BusinessProfilePage() {
  const { account, refreshAccount } = useAuth();
  const online = useOnlineStatus();
  const initial: Form = useMemo(
    () => ({
      businessName: account?.business_name ?? '',
      contactEmail: account?.contact_email ?? '',
      contactPhone: account?.contact_phone ?? '',
      timezone: account?.timezone ?? DEFAULT_TIMEZONE,
    }),
    [account],
  );
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const zones = useMemo(timezoneOptions, []);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // Aviso del navegador si se intenta salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    if (!form.businessName.trim()) {
      setResult({ tone: 'danger', text: 'Ingresa el nombre de tu negocio.' });
      return;
    }
    setBusy(true);
    const { error } = await accountApi.updateProfile({
      businessName: form.businessName,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      timezone: form.timezone,
      completeOnboarding: true,
    });
    if (error) {
      setBusy(false);
      setResult({ tone: 'danger', text: friendlyError(error) });
      return;
    }
    await refreshAccount();
    setBusy(false);
    setResult({ tone: 'success', text: 'Datos guardados.' });
  }

  return (
    <>
      <h1>Datos del negocio</h1>
      <Card>
        <p>
          Estos datos personalizan la aplicación. La moneda de trabajo es el peso chileno (CLP) y no se puede cambiar. La
          zona horaria define cómo se muestran las fechas y horas de tus operaciones.
        </p>
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <form onSubmit={onSubmit} noValidate>
          <TextField
            label="Nombre del negocio"
            maxLength={120}
            value={form.businessName}
            onChange={(e) => set('businessName')(e.target.value)}
          />
          <TextField
            label="Correo de contacto (opcional)"
            type="email"
            hint="Solo para tu referencia. No cambia el correo con el que ingresas."
            value={form.contactEmail}
            onChange={(e) => set('contactEmail')(e.target.value)}
          />
          <TextField
            label="Teléfono de contacto (opcional)"
            type="tel"
            maxLength={40}
            value={form.contactPhone}
            onChange={(e) => set('contactPhone')(e.target.value)}
          />
          <SelectField
            label="Zona horaria"
            hint="Chile continental usa America/Santiago, que aplica automáticamente el horario de verano e invierno."
            value={form.timezone}
            onChange={set('timezone')}
            options={zones}
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
