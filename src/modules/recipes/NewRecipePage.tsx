import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { recipesApi } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { Alert, Card, Loading, PageHeader, TextAreaField, TextField } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { RecipeVersionForm } from './RecipeVersionForm';
import { useRecipeCatalog } from './recipes';

export function NewRecipePage() {
  const navigate = useNavigate();
  const { ingredients, units, equivalences, error } = useRecipeCatalog();
  const [idemKey] = useIdempotencyKey();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!ingredients) return <Loading />;

  return (
    <>
      <p>
        <Link to="/recetas">← Recetas</Link>
      </p>
      <PageHeader title="Nueva receta" />
      <Card>
        <RecipeVersionForm
          ingredients={ingredients}
          units={units}
          equivalences={equivalences}
          header={
            <>
              <TextField label="Nombre" maxLength={120} required value={name} onChange={(e) => setName(e.target.value)} />
              <TextAreaField label="Descripción (opcional)" maxLength={1000} value={description} onChange={setDescription} />
            </>
          }
          submitLabel="Crear receta"
          onCancel={() => navigate('/recetas')}
          onSubmit={async (input) => {
            if (!name.trim()) return 'Ingresa el nombre de la receta.';
            const { data, error: e } = await recipesApi.create(idemKey, { ...input, name: name.trim(), description: description.trim() || null });
            if (e || !data) return friendlyError(e);
            navigate(`/recetas/${data.id}`, { replace: true });
            return null;
          }}
        />
      </Card>
    </>
  );
}
