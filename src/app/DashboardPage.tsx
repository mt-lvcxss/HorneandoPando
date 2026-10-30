import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { catalogApi, inventoryApi, type Ingredient } from '../db/api';
import { Alert, Card } from '../shared/ui';

export function DashboardPage() {
  const { account } = useAuth();
  const needsSetup = !account?.business_name;
  const [outOfStock, setOutOfStock] = useState<Ingredient[]>([]);

  useEffect(() => {
    void Promise.all([inventoryApi.listOpenAlerts(), catalogApi.listIngredients()]).then(([alerts, ingredients]) => {
      if (alerts.error || ingredients.error) return;
      const ids = new Set((alerts.data ?? []).map((a) => a.ingredient_id));
      setOutOfStock((ingredients.data ?? []).filter((i) => ids.has(i.id) && !i.archived_at));
    });
  }, []);

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

      {outOfStock.length > 0 && (
        <Alert tone="warning" title="Ingredientes agotados">
          <p>
            {outOfStock.map((i, n) => (
              <span key={i.id}>
                {n > 0 && ', '}
                <Link to={`/inventario/${i.id}`}>{i.name}</Link>
              </span>
            ))}
            . Registra una <Link to="/compras/nueva">compra</Link> para seguir usándolos.
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
          Ya puedes registrar tus <Link to="/ingredientes">ingredientes</Link>, sus <Link to="/compras">compras</Link> y llevar
          el <Link to="/inventario">inventario</Link> por envase, y escribir tus <Link to="/recetas">recetas</Link> con versiones. La producción se irá habilitando a medida que avance el
          desarrollo.
        </p>
      </Card>
    </>
  );
}
