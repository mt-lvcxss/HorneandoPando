import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Button, TextField } from '../../shared/ui';
import { emailSchema, validationError } from '../../shared/validation';
import { useAuth } from '../AuthProvider';
import { AuthLayout } from './AuthLayout';
import styles from './auth.module.css';

const REASON_MESSAGES = {
  idle_timeout: 'Cerramos tu sesión por inactividad para proteger tus datos. Vuelve a ingresar para continuar.',
  session_ended: 'Tu sesión terminó. Vuelve a ingresar para continuar.',
} as const;

export function LoginPage() {
  const { phase, signOutReason } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (phase === 'ready') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const emailError = validationError(emailSchema, email);
    if (emailError || !password) {
      setError(emailError ?? 'Ingresa tu contraseña.');
      return;
    }
    setBusy(true);
    const { error: signInError } = await authApi.signIn(email.trim(), password);
    setBusy(false);
    if (signInError) {
      setError(friendlyAuthError(signInError));
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Ingresar">
      {signOutReason && signOutReason !== 'logout' && <Alert tone="info">{REASON_MESSAGES[signOutReason]}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" fullWidth busy={busy}>
          Ingresar
        </Button>
      </form>
      <div className={styles.links}>
        <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
        <span>
          ¿No tienes cuenta? <Link to="/registro">Crear una cuenta</Link>
        </span>
      </div>
    </AuthLayout>
  );
}
