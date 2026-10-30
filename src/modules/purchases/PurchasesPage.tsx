import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { purchasesApi, type PurchaseSummary } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, formatDate } from '../../shared/format';
import { Alert, Badge, ButtonLink, Card, Loading, PageHeader, Table, uiClasses } from '../../shared/ui';

export function PurchasesPage() {
  const [purchases, setPurchases] = useState<PurchaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void purchasesApi.list().then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setPurchases(data ?? [])));
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!purchases) return <Loading />;

  return (
    <>
      <PageHeader title="Compras">
        <ButtonLink to="/compras/nueva">Nueva compra</ButtonLink>
      </PageHeader>
      <Card>
        {purchases.length === 0 ? (
          <p>Aún no registras compras. Al confirmar una, sus envases entran de inmediato al inventario.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Referencia</th>
                <th className={uiClasses.numeric}>Productos</th>
                <th className={uiClasses.numeric}>Pagado</th>
                <th className={uiClasses.numeric}>Cargos</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/compras/${p.id}`}>{formatDate(p.purchased_on)}</Link>
                  </td>
                  <td>{p.reference ?? '—'}</td>
                  <td className={uiClasses.numeric}>{p.purchase_lines.length}</td>
                  <td className={uiClasses.numeric}>{formatCLP(p.purchase_lines.reduce((s, l) => s + Number(l.paid_total_clp), 0))}</td>
                  <td className={uiClasses.numeric}>
                    {p.purchase_charges.length ? formatCLP(p.purchase_charges.reduce((s, c) => s + Number(c.amount_clp), 0)) : '—'}
                  </td>
                  <td>
                    {p.pending_verification && !p.verified_at ? (
                      <Badge tone="warning">Por verificar</Badge>
                    ) : (
                      <Badge tone="success">Confirmada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
