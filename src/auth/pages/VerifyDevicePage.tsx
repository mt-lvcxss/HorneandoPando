import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { sessionApi, type SendCodeStatus } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Button, TextField } from '../../shared/ui';
import { useAuth } from '../AuthProvider';
import { getDeviceToken } from '../deviceToken';
import { AuthLayout } from './AuthLayout';
import styles from './auth.module.css';

const RESEND_COOLDOWN_SECONDS = 60;

const SEND_MESSAGES: Record<Exclude<SendCodeStatus, 'sent' | 'not_required'>, string> = {
  rate_limited: 'Solicitaste demasiados códigos. Espera una hora antes de pedir otro.',
  no_session: 'Tu sesión ya no es válida. Cierra sesión y vuelve a ingresar.',
  email_failed: 'No pudimos enviar el correo en este momento. Intenta reenviar el código en unos minutos.',
  email_not_configured: 'El envío de correos aún no está configurado en el servidor. Avisa al administrador.',
  error: 'No pudimos generar el código. Inténtalo nuevamente en unos minutos.',
};

export function VerifyDevicePage() {
  const { phase, session, recheck, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  const sendCode = useCallback(async () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const status = await sessionApi.sendDeviceCode();
    if (status === 'sent') {
      setNotice({ tone: 'info', text: `Te enviamos un código de 6 dígitos a ${session?.email ?? 'tu correo'}. Vence en 10 minutos.` });
    } else if (status === 'not_required') {
      await recheck();
    } else {
      setNotice({ tone: 'danger', text: SEND_MESSAGES[status] });
    }
  }, [session, recheck]);

  useEffect(() => {
    if (phase !== 'needs_device_verification' || sentOnce.current) return;
    sentOnce.current = true;
    void sendCode();
  }, [phase, sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (phase === 'signed_out') return <Navigate to="/ingresar" replace />;
  if (phase !== 'needs_device_verification' && phase !== 'loading') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setNotice({ tone: 'danger', text: 'El código tiene 6 dígitos.' });
      return;
    }
    setBusy(true);
    const { data: result, error } = await sessionApi.verifyDeviceCode(getDeviceToken(), clean);
    setBusy(false);
    if (error || !result) {
      setNotice({ tone: 'danger', text: friendlyError(error) });
      return;
    }
    if (result.status === 'verified') {
      await recheck();
    } else if (result.status === 'invalid_code') {
      setCode('');
      setNotice({
        tone: 'warning',
        text: `El código no es correcto. Te quedan ${result.remaining_attempts} intento(s).`,
      });
    } else if (result.status === 'too_many_attempts') {
      setCode('');
      setNotice({ tone: 'danger', text: 'Superaste el número de intentos. Solicita un código nuevo.' });
    } else {
      setNotice({ tone: 'danger', text: 'El código venció o ya no es válido. Solicita uno nuevo.' });
    }
  }

  return (
    <AuthLayout title="Verifica este dispositivo">
      <p className={styles.muted}>
        Por seguridad, la primera vez que ingresas desde un navegador o dispositivo nuevo te pedimos un código enviado a tu
        correo.
      </p>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {import.meta.env.DEV && notice?.tone === 'danger' && (
        <Alert tone="info" title="Modo desarrollo">
          Si el correo aún no está configurado, obtén el código en la terminal con{' '}
          <code>npm run codigo-dispositivo -- {session?.email ?? 'tu@correo'}</code>
        </Alert>
      )}
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Código de verificación"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className={styles.codeInput}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <Button type="submit" fullWidth busy={busy}>
          Verificar
        </Button>
      </form>
      <div className={styles.links}>
        <Button variant="link" type="button" disabled={cooldown > 0} onClick={() => void sendCode()}>
          {cooldown > 0 ? `Reenviar código (disponible en ${cooldown} s)` : 'Reenviar código'}
        </Button>
        <Button variant="link" type="button" onClick={() => void signOut('logout')}>
          Cerrar sesión
        </Button>
      </div>
    </AuthLayout>
  );
}
