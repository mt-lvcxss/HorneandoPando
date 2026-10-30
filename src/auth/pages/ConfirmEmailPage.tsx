import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { authApi } from '../../db/api';
import { friendlyAuthError } from '../../shared/errors';
import { Alert, Loading } from '../../shared/ui';
import { AuthLayout } from './AuthLayout';

/** Destino del enlace de confirmación de registro. Funciona aunque se abra en otro navegador. */
export function ConfirmEmailPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // El token es de un solo uso: se evita la doble ejecución del modo estricto de React.
    if (started.current) return;
    started.current = true;
    void authApi.completeAuthLink(new URL(window.location.href), 'email').then(({ error: verifyError }) => {
      if (verifyError) setError(friendlyAuthError(verifyError));
      else navigate('/', { replace: true });
    });
  }, [navigate]);

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
