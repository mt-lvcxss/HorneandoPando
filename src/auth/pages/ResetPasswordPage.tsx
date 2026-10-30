import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Button, Loading, TextField } from '../../shared/ui';
import { passwordSchema, validationError } from '../../shared/validation';
import { AuthLayout } from './AuthLayout';

type Step = 'verifying' | 'form' | 'invalid' | 'done';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('verifying');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null; form?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tokenHash = params.get('token_hash');
    if (!tokenHash) {
      setLinkError('El enlace está incompleto. Ábrelo directamente desde el correo.');
      setStep('invalid');
      return;
    }
    void authApi.openRecoveryLink(tokenHash).then(({ error }) => {
      if (error) {
        setLinkError(friendlyAuthError(error));
        setStep('invalid');
      } else {
        setStep('form');
      }
    });
  }, [params]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: validationError(passwordSchema, password),
      confirm: password !== confirm ? 'Las contraseñas no coinciden.' : null,
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    setBusy(true);
    const { error } = await authApi.updatePassword(password);
    setBusy(false);
    if (error) {
      setErrors({ form: friendlyAuthError(error) });
      return;
    }
    setStep('done');
  }

  return (
    <AuthLayout title="Nueva contraseña">
      {step === 'verifying' && <Loading label="Validando el enlace…" />}
      {step === 'invalid' && (
        <>
          <Alert tone="danger">{linkError}</Alert>
          <Link to="/recuperar">Solicitar un nuevo enlace</Link>
        </>
      )}
      {step === 'form' && (
        <form onSubmit={onSubmit} noValidate>
          {errors.form && <Alert tone="danger">{errors.form}</Alert>}
          <TextField
            label="Nueva contraseña"
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
            Guardar contraseña
          </Button>
        </form>
      )}
      {step === 'done' && (
        <>
          <Alert tone="success">Tu contraseña se actualizó correctamente.</Alert>
          <Button fullWidth onClick={() => navigate('/', { replace: true })}>
            Continuar
          </Button>
        </>
      )}
    </AuthLayout>
  );
}
