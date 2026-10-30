import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Button, TextField } from '../../shared/ui';
import { emailSchema, validationError } from '../../shared/validation';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const emailError = validationError(emailSchema, email);
    setError(emailError);
    if (emailError) return;
    setBusy(true);
    const { error } = await authApi.requestPasswordReset(email.trim());
    const resetError = error as { status?: number; message?: string } | null;
    setBusy(false);
    // Solo se muestran errores de límite o de conexión; nunca si la cuenta existe o no.
    if (resetError && (resetError.status === 429 || /fetch|network/i.test(resetError.message ?? ''))) {
      setError(friendlyAuthError(resetError));
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout title="Recuperar contraseña">
      {sent ? (
        <Alert tone="success">
          <p>Si existe una cuenta con ese correo, te enviamos un enlace para elegir una nueva contraseña.</p>
          <p>El enlace es de un solo uso y vence en 1 hora.</p>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" fullWidth busy={busy}>
            Enviar enlace
          </Button>
        </form>
      )}
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Link to="/ingresar">Volver a ingresar</Link>
      </p>
    </AuthLayout>
  );
}
