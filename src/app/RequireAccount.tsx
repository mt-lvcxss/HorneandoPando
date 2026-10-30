import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../auth/pages/AuthLayout';
import { brand } from '../shared/brand';
import { Alert, Button, Loading } from '../shared/ui';

/** Solo deja pasar a emprendedores con sesión y dispositivo verificados. */
export function RequireAccount() {
  const { phase, errorMessage, recheck, signOut } = useAuth();

  switch (phase) {
    case 'loading':
      return <Loading />;
    case 'signed_out':
      return <Navigate to="/ingresar" replace />;
    case 'needs_device_verification':
      return <Navigate to="/verificar-dispositivo" replace />;
    case 'ready':
      return <Outlet />;
    case 'admin':
      return (
        <AuthLayout title="Cuenta de administración">
          <Alert tone="info">
            Esta es una cuenta de administrador de la plataforma. El panel administrativo es independiente y se habilitará
            en una próxima etapa.
          </Alert>
          <Button variant="secondary" fullWidth onClick={() => void signOut('logout')}>
            Cerrar sesión
          </Button>
        </AuthLayout>
      );
    case 'account_unavailable':
      return (
        <AuthLayout title="Cuenta no disponible">
          <Alert tone="warning">
            Esta cuenta está desactivada o cerrada. Si quieres reactivarla, contacta a soporte
            {brand.supportEmail ? ` (${brand.supportEmail})` : ''} para verificar tu identidad.
          </Alert>
          <Button variant="secondary" fullWidth onClick={() => void signOut('logout')}>
            Cerrar sesión
          </Button>
        </AuthLayout>
      );
    case 'error':
      return (
        <AuthLayout title="No pudimos cargar tu cuenta">
          <Alert tone="danger">{errorMessage}</Alert>
          <Button fullWidth onClick={() => void recheck()}>
            Reintentar
          </Button>
        </AuthLayout>
      );
  }
}
