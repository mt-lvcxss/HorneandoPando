import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, expectDbError, type TestDb, type TestUser } from './harness';

let db: TestDb;
let ana: TestUser;
let beto: TestUser;

beforeEach(async () => {
  db = await createTestDb();
  ana = await db.signInVerified(await db.createUser('ana@test.cl'));
  beto = await db.signInVerified(await db.createUser('beto@test.cl'));
});

afterEach(async () => {
  await db.close();
});

type Row = Record<string, unknown> & { id: string };
type Container = { id: string; balance: string; initial_quantity: string; unit_cost: string | null; cost_status: string };

const rpc = (user: TestUser, name: string, args: unknown[]) => db.asUser(user, () => db.rpc(name, args)) as Promise<Row>;

/** Ingrediente + marca + presentación. */
async function catalog(user: TestUser, name: string, dimension: string, quantity: number, unit: string) {
  const ingredient = await rpc(user, 'create_ingredient', [randomUUID(), name, dimension, null]);
  const brand = await rpc(user, 'create_brand', [randomUUID(), ingredient.id, 'Marca', null]);
  const presentation = await rpc(user, 'create_presentation', [randomUUID(), brand.id, quantity, unit, null, null, null]);
  return { ingredient, brand, presentation };
}

const today = () => new Date().toISOString().slice(0, 10);

const buy = (user: TestUser, lines: unknown[], charges: unknown[] = [], key = randomUUID(), date = '2026-01-15') =>
  rpc(user, 'confirm_purchase', [key, date, JSON.stringify(lines), JSON.stringify(charges), null, false, null]);

const containersOf = (user: TestUser, ingredientId: string) =>
  db.asUser(user, () =>
    db.rows<Container>('select * from public.containers where ingredient_id = $1 order by created_at, id', [ingredientId]),
  );

const available = async (user: TestUser, ingredientId: string) =>
  Number(
    (await db.asUser(user, () =>
      db.one<{ available: string }>('select available from public.ingredient_stock where ingredient_id = $1', [ingredientId]),
    )).available,
  );

const move = (user: TestUser, containerId: string, kind: string, quantity: number, expected: number | null = null) =>
  rpc(user, 'register_container_movement', [randomUUID(), containerId, kind, quantity, 'Prueba', null, expected]);

async function reconciled(user: TestUser) {
  const account = (await db.asUser(user, () => db.one<{ id: string }>('select id from public.accounts'))).id;
  return db.rows('select * from private.reconcile_inventory($1)', [account]);
}

describe('compras', () => {
  it('crea un envase por unidad física, con su costo, y el stock aumenta de inmediato', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 25, 'kg');
    const purchase = await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 2, paid_total_clp: 37980 }]);
    expect(purchase.purchased_on).toBe('2026-01-15');

    const containers = await containersOf(ana, harina.ingredient.id);
    expect(containers).toHaveLength(2);
    for (const c of containers) {
      expect(Number(c.initial_quantity)).toBe(25000);
      expect(Number(c.balance)).toBe(25000);
      expect(c.cost_status).toBe('known');
      // 37.980 / 50.000 g = 0,7596 CLP por gramo.
      expect(Number(c.unit_cost)).toBeCloseTo(0.7596, 10);
    }
    expect(await available(ana, harina.ingredient.id)).toBe(50000);

    const movements = await db.asUser(ana, () => db.rows<{ kind: string; quantity: string }>('select kind, quantity from public.inventory_movements'));
    expect(movements.map((m) => m.kind)).toEqual(['purchase', 'purchase']);
    expect(await reconciled(ana)).toEqual([]);
  });

  it('un reintento con la misma clave no duplica la compra ni el inventario', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const lines = [{ presentation_id: harina.presentation.id, container_count: 3, paid_total_clp: 3000 }];
    const key = randomUUID();
    const first = await buy(ana, lines, [], key);
    const retry = await buy(ana, lines, [], key);
    expect(retry.id).toBe(first.id);
    expect(await containersOf(ana, harina.ingredient.id)).toHaveLength(3);
    expect(await available(ana, harina.ingredient.id)).toBe(3000);
  });

  it('registra el contenido real recibido por envase', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, content_per_container: 0.98, paid_total_clp: 1000 }]);
    expect(await available(ana, harina.ingredient.id)).toBe(980);
  });

  it('valida fecha, precio y catálogo archivado', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const line = { presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 };
    expect(await expectDbError(buy(ana, [line], [], randomUUID(), '2999-01-01'))).toBe('INVALID_PURCHASE_DATE');
    expect(await expectDbError(buy(ana, [{ ...line, paid_total_clp: 0 }]))).toBe('INVALID_PRICE');
    expect(await expectDbError(buy(ana, [{ ...line, container_count: 0 }]))).toBe('INVALID_CONTAINER_COUNT');
    expect(await expectDbError(buy(ana, []))).toBe('PURCHASE_LINES_REQUIRED');
    await rpc(ana, 'set_brand_archived', [harina.brand.id, true]);
    expect(await expectDbError(buy(ana, [line]))).toBe('CATALOG_ARCHIVED');
    // Nada quedó registrado por los intentos fallidos.
    expect(await db.asUser(ana, () => db.rows('select id from public.purchases'))).toHaveLength(0);
  });

  it('una compra confirmada no se modifica; solo se marca como verificada', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const p = await rpc(ana, 'confirm_purchase', [
      randomUUID(), today(), JSON.stringify([{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 900 }]),
      '[]', 'Boleta 123', true, null,
    ]);
    expect(p).toMatchObject({ pending_verification: true, verified_at: null, reference: 'Boleta 123' });
    expect(await expectDbError(db.rows("update public.purchases set reference = 'otra' where id = $1", [p.id]))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.rows('update public.purchase_lines set paid_total_clp = 1'))).toBe('IMMUTABLE_RECORD');
    const verified = await rpc(ana, 'set_purchase_verified', [p.id]);
    expect(verified.verified_at).not.toBeNull();
  });
});

describe('cargos adicionales', () => {
  it('se distribuyen por valor sin perder ni duplicar pesos', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const azucar = await catalog(ana, 'Azúcar', 'mass', 1, 'kg');
    const lines = [
      { presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 },
      { presentation_id: azucar.presentation.id, container_count: 1, paid_total_clp: 2000 },
    ];
    const charges = [{ description: 'Despacho', amount_clp: 1000, treatment: 'distributed', method: 'by_value', partial_rule: 'proportional' }];

    const preview = (await rpc(ana, 'preview_purchase', [JSON.stringify(lines), JSON.stringify(charges)])) as unknown as {
      charges: { allocations: number[] }[];
    };
    // 1.000 en proporción 1:2 = 333,33 + 666,67 → 333 + 667 (mayor resto).
    expect(preview.charges[0].allocations).toEqual([333, 667]);
    // La vista previa no escribe nada.
    expect(await db.asUser(ana, () => db.rows('select id from public.purchases'))).toHaveLength(0);

    await buy(ana, lines, charges);
    const alloc = await db.asUser(ana, () =>
      db.rows<{ amount_clp: string }>('select amount_clp from public.purchase_charge_allocations order by amount_clp'),
    );
    expect(alloc.map((a) => Number(a.amount_clp))).toEqual([333, 667]);

    const [c] = await containersOf(ana, harina.ingredient.id);
    expect(Number((c as unknown as { charge_unit_cost: string }).charge_unit_cost)).toBeCloseTo(0.333, 10);
  });

  it('por cantidad solo si las unidades son comparables', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const leche = await catalog(ana, 'Leche', 'volume', 1, 'l');
    const lines = [
      { presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 },
      { presentation_id: leche.presentation.id, container_count: 1, paid_total_clp: 1000 },
    ];
    const charge = { description: 'Flete', amount_clp: 500, treatment: 'distributed', method: 'by_quantity', partial_rule: 'proportional' };
    expect(await expectDbError(buy(ana, lines, [charge]))).toBe('CHARGE_QUANTITY_NOT_COMPARABLE');
  });

  it('gasto separado no se asigna a los productos; "primer uso" queda por envase', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(
      ana,
      [{ presentation_id: harina.presentation.id, container_count: 2, paid_total_clp: 2000 }],
      [
        { description: 'Estacionamiento', amount_clp: 800, treatment: 'separate_expense' },
        { description: 'Bolsa térmica', amount_clp: 300, treatment: 'distributed', method: 'by_quantity', partial_rule: 'first_use' },
      ],
    );
    expect(await db.asUser(ana, () => db.rows('select * from public.purchase_charges'))).toHaveLength(2);
    expect(await db.asUser(ana, () => db.rows('select * from public.purchase_charge_allocations'))).toHaveLength(1);
    const containers = await db.asUser(ana, () =>
      db.rows<{ charge_unit_cost: string; charge_first_use_clp: string }>('select charge_unit_cost, charge_first_use_clp from public.containers'),
    );
    for (const c of containers) {
      expect(Number(c.charge_unit_cost)).toBe(0);
      expect(Number(c.charge_first_use_clp)).toBe(150);
    }
  });
});

describe('movimientos de inventario', () => {
  it('merma, devolución y ajuste nunca dejan saldos negativos y se reconcilian', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    const [c] = await containersOf(ana, harina.ingredient.id);

    await move(ana, c.id, 'waste', 100);
    await move(ana, c.id, 'supplier_return', 200);
    expect(await expectDbError(move(ana, c.id, 'waste', 701))).toBe('INSUFFICIENT_STOCK');
    expect(await available(ana, harina.ingredient.id)).toBe(700);

    const adj = await move(ana, c.id, 'adjustment', 650, 700);
    expect(adj).toMatchObject({ kind: 'adjustment', quantity: -50, balance_before: 700, balance_after: 650 });
    expect(await expectDbError(move(ana, c.id, 'adjustment', 600, 700))).toBe('STALE_BALANCE');
    expect(await reconciled(ana)).toEqual([]);
  });

  it('una reversión crea un movimiento opuesto vinculado y solo una vez', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    const [c] = await containersOf(ana, harina.ingredient.id);
    const waste = await move(ana, c.id, 'waste', 300);

    const rev = await rpc(ana, 'reverse_movement', [randomUUID(), waste.id, 'Me equivoqué']);
    expect(rev).toMatchObject({ kind: 'reversal', quantity: 300, reverses_movement_id: waste.id });
    expect(await available(ana, harina.ingredient.id)).toBe(1000);
    expect(await expectDbError(rpc(ana, 'reverse_movement', [randomUUID(), waste.id, null]))).toBe('ALREADY_REVERSED');

    const purchaseMove = await db.asUser(ana, () => db.one<{ id: string }>("select id from public.inventory_movements where kind = 'purchase'"));
    expect(await expectDbError(rpc(ana, 'reverse_movement', [randomUUID(), purchaseMove.id, null]))).toBe('MOVEMENT_NOT_REVERSIBLE');
    // El original sigue intacto.
    expect(await db.asUser(ana, () => db.rows('select id from public.inventory_movements'))).toHaveLength(3);
  });

  it('la corrección de recepción solo aplica a envases comprados', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    const [c] = await containersOf(ana, harina.ingredient.id);
    await move(ana, c.id, 'receipt_correction', -20);
    expect(await available(ana, harina.ingredient.id)).toBe(980);

    await rpc(ana, 'register_manual_entry', [randomUUID(), harina.presentation.id, 1, 1, '2026-01-10', null, false, false, null]);
    const manual = (await containersOf(ana, harina.ingredient.id)).find((x) => x.id !== c.id)!;
    expect(await expectDbError(move(ana, manual.id, 'receipt_correction', 10))).toBe('NOT_A_PURCHASE');
  });

  it('el saldo y los movimientos no se pueden alterar fuera de las operaciones', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    const [c] = await containersOf(ana, harina.ingredient.id);
    // Ni siquiera el dueño de la base de datos.
    expect(await expectDbError(db.rows('update public.containers set balance = 5 where id = $1', [c.id]))).toBe('BALANCE_DIRECT_UPDATE');
    expect(await expectDbError(db.rows('update public.containers set unit_cost = 2 where id = $1', [c.id]))).toBe('COST_DIRECT_UPDATE');
    expect(await expectDbError(db.rows('update public.containers set initial_quantity = 2 where id = $1', [c.id]))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.rows('delete from public.inventory_movements'))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.asUser(ana, () => db.rows('update public.containers set balance = 5')))).toMatch(/permission denied/);
  });
});

describe('costo según lo recibido', () => {
  it('una corrección de recepción reparte lo pagado sobre lo que realmente llegó', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(
      ana,
      [{ presentation_id: harina.presentation.id, container_count: 2, paid_total_clp: 2000 }],
      [{ description: 'Despacho', amount_clp: 200, treatment: 'distributed', method: 'by_value', partial_rule: 'proportional' }],
    );
    const [c] = await containersOf(ana, harina.ingredient.id);
    type Costs = { unit_cost: string; charge_unit_cost: string; received_quantity: string };
    const costs = () =>
      db.asUser(ana, () => db.one<Costs>('select unit_cost, charge_unit_cost, received_quantity from public.containers where id = $1', [c.id]));
    expect(Number((await costs()).unit_cost)).toBe(1);

    // Llegaron 800 g en vez de 1.000: los $1.000 pagados por el envase se reparten sobre 800 g.
    const correction = await move(ana, c.id, 'receipt_correction', -200);
    let now = await costs();
    expect(Number(now.received_quantity)).toBe(800);
    expect(Number(now.unit_cost)).toBe(1.25);
    expect(Number(now.charge_unit_cost)).toBe(0.125);

    // El otro envase de la misma compra no cambia.
    const other = (await containersOf(ana, harina.ingredient.id)).find((x) => x.id !== c.id)!;
    expect(Number(other.unit_cost)).toBe(1);

    // Revertir la corrección restituye el costo original.
    await rpc(ana, 'reverse_movement', [randomUUID(), correction.id, null]);
    now = await costs();
    expect(Number(now.received_quantity)).toBe(1000);
    expect(Number(now.unit_cost)).toBe(1);

    // Si no llegó nada, corresponde una devolución, no una corrección.
    expect(await expectDbError(move(ana, c.id, 'receipt_correction', -1000))).toBe('NOTHING_RECEIVED');
    expect(await reconciled(ana)).toEqual([]);
  });
});

describe('entrada manual', () => {
  it('un costo desconocido queda como desconocido, nunca como cero', async () => {
    const huevo = await catalog(ana, 'Huevo', 'count', 30, 'unidad');
    await rpc(ana, 'register_manual_entry', [randomUUID(), huevo.presentation.id, 1, 18, '2026-01-10', null, false, true, 'Bandeja abierta']);
    const [c] = await db.asUser(ana, () =>
      db.rows<Container & { opened_at: string | null; source: string }>('select * from public.containers'),
    );
    expect(c).toMatchObject({ cost_status: 'unknown', unit_cost: null, source: 'manual_entry' });
    expect(Number(c.initial_quantity)).toBe(18);
    expect(c.opened_at).not.toBeNull();

    await rpc(ana, 'register_manual_entry', [randomUUID(), huevo.presentation.id, 1, 30, '2026-01-10', 6000, true, false, null]);
    const provisional = await db.asUser(ana, () => db.one<Container>("select * from public.containers where cost_status = 'provisional'"));
    expect(Number(provisional.unit_cost)).toBe(200);
  });
});

describe('conteo físico', () => {
  it('ajusta solo las diferencias y rechaza un conteo desactualizado', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 2, paid_total_clp: 2000 }]);
    const [a, b] = await containersOf(ana, harina.ingredient.id);

    const count = await rpc(ana, 'confirm_inventory_count', [
      randomUUID(),
      JSON.stringify([
        { container_id: a.id, expected_balance: 1000, counted_quantity: 1000 },
        { container_id: b.id, expected_balance: 1000, counted_quantity: 940 },
      ]),
      'Conteo de enero',
    ]);
    expect(count.adjusted).toBe(1);
    expect(await available(ana, harina.ingredient.id)).toBe(1940);
    const lines = await db.asUser(ana, () => db.rows<{ movement_id: string | null }>('select movement_id from public.inventory_count_lines'));
    expect(lines.filter((l) => l.movement_id)).toHaveLength(1);

    expect(
      await expectDbError(
        rpc(ana, 'confirm_inventory_count', [
          randomUUID(),
          JSON.stringify([{ container_id: b.id, expected_balance: 1000, counted_quantity: 900 }]),
          null,
        ]),
      ),
    ).toBe('STALE_BALANCE');
    expect(await reconciled(ana)).toEqual([]);
  });
});

describe('avisos de ingrediente agotado', () => {
  it('se abre al agotarse, no se duplica, se cierra al reponer y se repite con historial', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const line = [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }];
    await buy(ana, line);
    const alerts = () =>
      db.asUser(ana, () => db.rows<{ resolved_at: string | null }>('select resolved_at from public.stock_alerts order by opened_at'));
    expect(await alerts()).toHaveLength(0);

    const [c1] = await containersOf(ana, harina.ingredient.id);
    await move(ana, c1.id, 'waste', 1000);
    expect(await alerts()).toEqual([{ resolved_at: null }]);

    await buy(ana, line);
    expect((await alerts())[0].resolved_at).not.toBeNull();

    const c2 = (await containersOf(ana, harina.ingredient.id)).find((c) => c.id !== c1.id)!;
    await move(ana, c2.id, 'waste', 400);
    expect(await alerts()).toHaveLength(1);
    await move(ana, c2.id, 'waste', 600);
    const history = await alerts();
    expect(history).toHaveLength(2);
    expect(history[1].resolved_at).toBeNull();
  });
});

describe('aislamiento y catálogo en uso', () => {
  it('otra cuenta no ve ni mueve el inventario ajeno', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    const purchase = await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    const [c] = await containersOf(ana, harina.ingredient.id);

    for (const table of ['purchases', 'purchase_lines', 'containers', 'inventory_movements', 'ingredient_stock']) {
      expect(await db.asUser(beto, () => db.rows(`select * from public.${table}`))).toHaveLength(0);
    }
    expect(await expectDbError(move(beto, c.id, 'waste', 1))).toBe('CONTAINER_NOT_FOUND');
    expect(await expectDbError(buy(beto, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1 }]))).toBe(
      'PRESENTATION_NOT_FOUND',
    );
    expect(await expectDbError(rpc(beto, 'set_purchase_verified', [purchase.id]))).toBe('PURCHASE_NOT_FOUND');
    expect(await available(ana, harina.ingredient.id)).toBe(1000);
  });

  it('el contenido de una presentación con envases ya no cambia', async () => {
    const harina = await catalog(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, [{ presentation_id: harina.presentation.id, container_count: 1, paid_total_clp: 1000 }]);
    expect(await expectDbError(rpc(ana, 'update_presentation', [harina.presentation.id, 2, 'kg', null, null, null]))).toBe(
      'PRESENTATION_IN_USE',
    );
    // El precio de referencia sí se puede actualizar.
    const updated = await rpc(ana, 'update_presentation', [harina.presentation.id, 1, 'kg', 'Bolsa', 1100, null]);
    expect(updated.reference_price_clp).toBe(1100);
  });
});
