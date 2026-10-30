import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Loading } from '../../shared/ui';
import { AuthLayout } from './AuthLayout';

/** Destino del enlace de confirmación de registro. Funciona aunque se abra en otro navegador. */
export function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // El token es de un solo uso: se evita la doble ejecución del modo estricto de React.
    if (started.current) return;
    started.current = true;
    const tokenHash = params.get('token_hash');
    if (!tokenHash) {
      setError('El enlace está incompleto. Ábrelo directamente desde el correo.');
      return;
    }
    void authApi.confirmEmailLink(tokenHash).then(({ error: verifyError }) => {
      if (verifyError) setError(friendlyAuthError(verifyError));
      else navigate('/', { replace: true });
    });
  }, [params, navigate]);

  return (
    <AuthLayout title="Confirmación de cuenta">
      {error ? (
        <>
          <Alert tone="danger">{error}</Alert>
          <p>
            Si ya confirmaste tu cuenta, puedes <Link to="/ingresar">ingresar</Link>.
          </p>
        </>
      ) : (
        <Loading label="Confirmando tu correo…" />
      )}
    </AuthLayout>
  );
}
