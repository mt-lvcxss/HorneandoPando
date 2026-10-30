import { AuthLayout } from '../auth/pages/AuthLayout';
import { Alert } from '../shared/ui';

/** Se muestra cuando falta o es inválida la conexión a Supabase. Nunca se usan datos simulados. */
export function ConfigErrorPage({ problems }: { problems: string[] }) {
  return (
    <AuthLayout title="Falta configurar la conexión">
      <Alert tone="danger" title="La aplicación no puede conectarse a la base de datos">
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Alert>
      <p>
        Copia <code>.env.example</code> como <code>.env.local</code>, completa los valores de tu proyecto de Supabase y
        reinicia el servidor de desarrollo. Consulta <code>README.md</code>.
      </p>
    </AuthLayout>
  );
}
