import { useState, type FormEvent } from 'react';
import { catalogApi, type Brand, type BrandInput, type Ingredient, type Presentation, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatCLP, formatDate } from '../../shared/format';
import { Actions, Alert, Badge, Button, Card, CheckboxField, Table, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { formatAmount } from './catalog';
import { PresentationForm } from './PresentationForm';

type Props = {
  ingredient: Ingredient;
  units: Unit[];
  brands: Brand[];
  presentations: Presentation[];
  onChanged: () => Promise<void>;
};

/** Marcas de un ingrediente, cada una con sus presentaciones (envase y tamaño). */
export function BrandsSection({ ingredient, units, brands, presentations, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [brandKey, renewBrandKey] = useIdempotencyKey();
  const archived = !!ingredient.archived_at;
  const visible = brands.filter((b) => showArchived || !b.archived_at);

  return (
    <Card>
      <h2>Marcas</h2>
      <p className={uiClasses.muted}>
        Agrega cada marca de {ingredient.name.toLowerCase()} que compras y, dentro de ella, sus presentaciones (por ejemplo,
        saco de 25 kg y bolsa de 1 kg). Cada presentación tiene su propio precio; el costo real de cada envase se toma de sus
        compras.
      </p>
      {brands.some((b) => b.archived_at) && (
        <CheckboxField label="Mostrar marcas archivadas" checked={showArchived} onChange={setShowArchived} />
      )}
      {visible.length === 0 && <p>Sin marcas registradas.</p>}

      {visible.map((brand) => (
        <BrandBlock
          key={brand.id}
          brand={brand}
          ingredient={ingredient}
          units={units}
          presentations={presentations.filter((p) => p.brand_id === brand.id)}
          onChanged={onChanged}
        />
      ))}

      {!archived && !adding && (
        <div className={uiClasses.subsection}>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Agregar marca
          </Button>
        </div>
      )}
      {adding && (
        <div className={uiClasses.subsection}>
          <h3>Nueva marca</h3>
          <BrandForm
            submitLabel="Agregar marca"
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              const { error } = await catalogApi.createBrand(brandKey, ingredient.id, input);
              if (error) return friendlyError(error);
              renewBrandKey();
              await onChanged();
              setAdding(false);
              return null;
            }}
          />
        </div>
      )}
    </Card>
  );
}

type BlockProps = {
  brand: Brand;
  ingredient: Ingredient;
  units: Unit[];
  presentations: Presentation[];
  onChanged: () => Promise<void>;
};

function BrandBlock({ brand, ingredient, units, presentations, onChanged }: BlockProps) {
  const online = useOnlineStatus();
  const [editing, setEditing] = useState(false);
  const [presentationForm, setPresentationForm] = useState<'new' | Presentation | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [presentationKey, renewPresentationKey] = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const locked = !!ingredient.archived_at;
  const brandArchived = !!brand.archived_at;
  const visible = presentations.filter((p) => showArchived || !p.archived_at);

  async function run(action: () => Promise<{ error: unknown }>) {
    setError(null);
    const { error: rpcError } = await action();
    if (rpcError) setError(friendlyError(rpcError));
    await onChanged();
  }

  return (
    <section className={uiClasses.subsection}>
      <h3>
        {brand.name} {brandArchived && <Badge>Archivada</Badge>}
      </h3>
      {brand.notes && <p className={uiClasses.muted}>{brand.notes}</p>}
      {error && <Alert tone="danger">{error}</Alert>}

      {editing ? (
        <BrandForm
          initial={brand}
          submitLabel="Guardar marca"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const { error: rpcError } = await catalogApi.updateBrand(brand.id, input);
            if (rpcError) return friendlyError(rpcError);
            await onChanged();
            setEditing(false);
            return null;
          }}
        />
      ) : (
        <>
          {presentations.some((p) => p.archived_at) && (
            <CheckboxField label="Mostrar presentaciones archivadas" checked={showArchived} onChange={setShowArchived} />
          )}
          {visible.length === 0 ? (
            <p className={uiClasses.muted}>Sin presentaciones.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Envase</th>
                  <th className={uiClasses.numeric}>Contenido</th>
                  <th className={uiClasses.numeric}>Precio de referencia</th>
                  <th>Fecha del precio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.description ?? '—'} {p.archived_at && <Badge>Archivada</Badge>}
                    </td>
                    <td className={uiClasses.numeric}>{formatAmount(p.quantity, p.unit)}</td>
                    <td className={uiClasses.numeric}>{formatCLP(p.reference_price_clp)}</td>
                    <td>{formatDate(p.reference_price_date)}</td>
                    <td>
                      {!locked && !brandArchived && (
                        <Actions>
                          {!p.archived_at && (
                            <Button variant="link" onClick={() => setPresentationForm(p)}>
                              Editar
                            </Button>
                          )}
                          <Button
                            variant="link"
                            disabled={!online}
                            onClick={() => void run(() => catalogApi.setPresentationArchived(p.id, !p.archived_at))}
                          >
                            {p.archived_at ? 'Restaurar' : 'Archivar'}
                          </Button>
                        </Actions>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {presentationForm !== null ? (
            <PresentationForm
              key={presentationForm === 'new' ? 'new' : presentationForm.id}
              dimension={ingredient.dimension}
              units={units}
              initial={presentationForm === 'new' ? undefined : presentationForm}
              submitLabel={presentationForm === 'new' ? 'Agregar presentación' : 'Guardar cambios'}
              onCancel={() => setPresentationForm(null)}
              onSubmit={async (input) => {
                const { error: rpcError } =
                  presentationForm === 'new'
                    ? await catalogApi.createPresentation(presentationKey, brand.id, input)
                    : await catalogApi.updatePresentation(presentationForm.id, input);
                if (rpcError) return friendlyError(rpcError);
                if (presentationForm === 'new') renewPresentationKey();
                await onChanged();
                setPresentationForm(null);
                return null;
              }}
            />
          ) : (
            !locked && (
              <Actions>
                {!brandArchived && (
                  <>
                    <Button variant="secondary" onClick={() => setPresentationForm('new')}>
                      Agregar presentación
                    </Button>
                    <Button variant="link" onClick={() => setEditing(true)}>
                      Editar marca
                    </Button>
                  </>
                )}
                <Button
                  variant="link"
                  disabled={!online}
                  onClick={() => void run(() => catalogApi.setBrandArchived(brand.id, !brandArchived))}
                >
                  {brandArchived ? 'Restaurar marca' : 'Archivar marca'}
                </Button>
              </Actions>
            )
          )}
        </>
      )}
    </section>
  );
}

type FormProps = {
  initial?: Brand;
  submitLabel: string;
  onSubmit: (input: BrandInput) => Promise<string | null>;
  onCancel: () => void;
};

function BrandForm({ initial, submitLabel, onSubmit, onCancel }: FormProps) {
  const online = useOnlineStatus();
  const [name, setName] = useState(initial?.name ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Ingresa el nombre de la marca. Si no tiene, escribe por ejemplo «Granel».');
    setBusy(true);
    const message = await onSubmit({ name: name.trim(), notes: notes.trim() || null });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField label="Marca" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Notas (opcional)" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {!online && <Alert tone="warning">Sin conexión. Podrás guardar cuando vuelva la conexión.</Alert>}
      <Actions>
        <Button type="submit" busy={busy} disabled={!online}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </Actions>
    </form>
  );
}
