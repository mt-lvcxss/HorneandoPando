import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Button, TextField } from '../../shared/ui';
import { emailSchema, passwordSchema, validationError } from '../../shared/validation';
import { AuthLayout } from './AuthLayout';
import styles from './auth.module.css';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; confirm?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const next = {
      email: validationError(emailSchema, email),
      password: validationError(passwordSchema, password),
      confirm: password !== confirm ? 'Las contraseñas no coinciden.' : null,
    };
    setErrors(next);
    if (next.email || next.password || next.confirm) return;

    setBusy(true);
    const { error } = await authApi.signUp(email.trim(), password);
    setBusy(false);
    // Con confirmación obligatoria, Supabase no informa si el correo ya estaba registrado:
    // el mensaje es el mismo en ambos casos para no revelar cuentas ajenas.
    if (error && (error as { code?: string }).code !== 'user_already_exists') {
      setFormError(friendlyAuthError(error));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthLayout title="Revisa tu correo">
        <Alert tone="success">
          <p>
            Si el correo <strong>{email.trim()}</strong> puede registrarse, te enviamos un enlace para confirmar la cuenta.
          </p>
          <p>El enlace vence en 1 hora. Revisa también la carpeta de spam.</p>
        </Alert>
        <Link to="/ingresar">Volver a ingresar</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crear cuenta">
      <p className={styles.muted}>Solo necesitas tu correo y una contraseña. Los datos del negocio los completas después.</p>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          hint="Al menos 8 caracteres, con letras y números."
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label="Repite la contraseña"
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" fullWidth busy={busy}>
          Crear cuenta
        </Button>
      </form>
      <div className={styles.links}>
        <span>
          ¿Ya tienes cuenta? <Link to="/ingresar">Ingresar</Link>
        </span>
      </div>
    </AuthLayout>
  );
}
