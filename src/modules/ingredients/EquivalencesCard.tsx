import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { catalogApi, type Equivalence, type Ingredient, type Unit } from '../../db/api';
import { friendlyError } from '../../shared/errors';
import { formatDateTime, parseDecimal } from '../../shared/format';
import { Actions, Alert, Button, Card, FieldRow, SelectField, Table, TextField, uiClasses } from '../../shared/ui';
import { useIdempotencyKey } from '../../shared/useIdempotencyKey';
import { useOnlineStatus } from '../../shared/useOnlineStatus';
import { BASE_UNIT, DIMENSION_LABEL, formatAmount, unitsOf } from './catalog';

type Props = {
  ingredient: Ingredient;
  units: Unit[];
  equivalences: Equivalence[];
  onChanged: () => Promise<void>;
};

const DEFAULT_TZ = 'America/Santiago';

function describe(e: Equivalence) {
  return `${formatAmount(e.other_quantity, e.other_unit)} = ${formatAmount(e.ingredient_quantity, e.ingredient_unit)}`;
}

export function EquivalencesCard({ ingredient, units, equivalences, onChanged }: Props) {
  const online = useOnlineStatus();
  const tz = useAuth().account?.timezone ?? DEFAULT_TZ;
  const [idemKey, renewKey] = useIdempotencyKey();
  const otherUnits = units.filter((u) => u.dimension !== ingredient.dimension);
  const ownUnits = unitsOf(units, ingredient.dimension);
  const [open, setOpen] = useState(false);
  const [otherQty, setOtherQty] = useState('');
  const [otherUnit, setOtherUnit] = useState(otherUnits[0]?.code ?? 'g');
  const [ownQty, setOwnQty] = useState('');
  const [ownUnit, setOwnUnit] = useState(BASE_UNIT[ingredient.dimension]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = equivalences.filter((e) => !e.superseded_at);
  const history = equivalences.filter((e) => e.superseded_at);
  const archived = !!ingredient.archived_at;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const a = parseDecimal(otherQty);
    const b = parseDecimal(ownQty);
    if (a === null || a <= 0 || b === null || b <= 0) return setError('Las dos cantidades deben ser mayores que cero.');
    setBusy(true);
    const { error: rpcError } = await catalogApi.setEquivalence(
      idemKey,
      ingredient.id,
      { quantity: a, unit: otherUnit },
      { quantity: b, unit: ownUnit },
      note.trim() || null,
    );
    if (rpcError) {
      setBusy(false);
      return setError(friendlyError(rpcError));
    }
    renewKey();
    await onChanged();
    setBusy(false);
    setOpen(false);
    setOtherQty('');
    setOwnQty('');
    setNote('');
  }

  async function retire(id: string) {
    setError(null);
    const { error: rpcError } = await catalogApi.retireEquivalence(id);
    if (rpcError) return setError(friendlyError(rpcError));
    await onChanged();
  }

  return (
    <Card>
      <h2>Equivalencias</h2>
      <p className={uiClasses.muted}>
        Permiten usar este ingrediente en otra dimensión, por ejemplo una receta que pide huevos en gramos. Las
        conversiones dentro de una misma dimensión (kg y g, l y ml) son automáticas. Una equivalencia nueva reemplaza a la
        anterior sin cambiar las operaciones ya registradas.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}

      {current.length === 0 ? (
        <p>Sin equivalencias: este ingrediente solo se puede usar en {DIMENSION_LABEL[ingredient.dimension].toLowerCase()}.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Vigente</th>
              <th>Nota</th>
              <th>Desde</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {current.map((e) => (
              <tr key={e.id}>
                <td>{describe(e)}</td>
                <td>{e.note ?? '—'}</td>
                <td>{formatDateTime(e.created_at, tz)}</td>
                <td>
                  {!archived && (
                    <Button variant="link" disabled={!online} onClick={() => void retire(e.id)}>
                      Retirar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {!archived && !open && (
        <Actions>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Agregar o reemplazar equivalencia
          </Button>
        </Actions>
      )}

      {open && (
        <form onSubmit={submit} noValidate>
          <FieldRow>
            <TextField label="Cantidad" inputMode="decimal" value={otherQty} onChange={(e) => setOtherQty(e.target.value)} />
            <SelectField
              label="Unidad"
              value={otherUnit}
              onChange={setOtherUnit}
              options={otherUnits.map((u) => ({ value: u.code, label: u.label }))}
            />
            <TextField label="Equivale a" inputMode="decimal" value={ownQty} onChange={(e) => setOwnQty(e.target.value)} />
            <SelectField
              label="Unidad"
              value={ownUnit}
              onChange={setOwnUnit}
              options={ownUnits.map((u) => ({ value: u.code, label: u.label }))}
            />
          </FieldRow>
          <TextField
            label="Nota (opcional)"
            placeholder="Por ejemplo: huevo grande sin cáscara"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Actions>
            <Button type="submit" busy={busy} disabled={!online}>
              Guardar equivalencia
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </Actions>
        </form>
      )}

      {history.length > 0 && (
        <details>
          <summary>Historial ({history.length})</summary>
          <Table>
            <thead>
              <tr>
                <th>Equivalencia</th>
                <th>Nota</th>
                <th>Vigente desde</th>
                <th>Hasta</th>
              </tr>
            </thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.id}>
                  <td>{describe(e)}</td>
                  <td>{e.note ?? '—'}</td>
                  <td>{formatDateTime(e.created_at, tz)}</td>
                  <td>{formatDateTime(e.superseded_at, tz)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      )}
    </Card>
  );
}
