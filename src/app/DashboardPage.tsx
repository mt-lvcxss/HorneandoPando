import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Card } from '../shared/ui';

export function DashboardPage() {
  const { account } = useAuth();
  const needsSetup = !account?.business_name;

  return (
    <>
      <h1>{account?.business_name ? `Hola, ${account.business_name}` : 'Bienvenido'}</h1>

      {needsSetup && (
        <Alert tone="info" title="Completa los datos de tu negocio">
          <p>
            Puedes hacerlo cuando quieras; no es obligatorio para comenzar.{' '}
            <Link to="/configuracion/negocio">Ir a datos del negocio</Link>
          </p>
        </Alert>
      )}

      <Card>
        <h2>Estado de la plataforma</h2>
        <p>
          Tu cuenta está lista y protegida: tus datos solo son visibles para ti y cada dispositivo nuevo se verifica con un
          código enviado a tu correo.
        </p>
        <p>
          Ya puedes registrar tus <Link to="/ingredientes">ingredientes</Link> con sus presentaciones. Compras, inventario,
          recetas y producción se irán habilitando a medida que avance el desarrollo. Este panel mostrará pedidos, alertas de
          inventario y finanzas cuando esos módulos registren datos reales.
        </p>
      </Card>
    </>
  );
}
