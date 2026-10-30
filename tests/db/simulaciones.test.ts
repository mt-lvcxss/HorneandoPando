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
type Pick = { container_id: string; take: number; opened: boolean; cost: number | null; first_use_clp: number };
type Line = {
  ingredient_id: string;
  required: number;
  allocated: number;
  shortage: number;
  known_cost: number;
  unknown_quantity: number;
  cost_status: string;
  containers: Pick[];
};
type Estimate = {
  lines: Line[];
  ingredients_cost: number;
  total_cost: number;
  unit_cost: number;
  cost_status: string;
  warnings: string[];
  has_shortages: boolean;
  pricing: { price: number; unit_price: number } | null;
  labor: { total: number } | null;
};

const rpc = (user: TestUser, name: string, args: unknown[]) => db.asUser(user, () => db.rpc(name, args)) as Promise<Row>;

/** Ingrediente con una marca y una presentación del tamaño indicado. */
async function ingredient(user: TestUser, name: string, dimension: string, size: number, unit: string) {
  const i = await rpc(user, 'create_ingredient', [randomUUID(), name, dimension, null]);
  const b = await rpc(user, 'create_brand', [randomUUID(), i.id, 'Marca', null]);
  const p = await rpc(user, 'create_presentation', [randomUUID(), b.id, size, unit, null, null, null]);
  return { id: i.id, presentation: p.id };
}

const buy = (user: TestUser, presentation: string, count: number, paid: number, date: string, charges: unknown[] = []) =>
  rpc(user, 'confirm_purchase', [
    randomUUID(), date, JSON.stringify([{ presentation_id: presentation, container_count: count, paid_total_clp: paid }]),
    JSON.stringify(charges), null, false, null,
  ]);

const recipe = (user: TestUser, items: [string, number, string][], yieldQty = 10) =>
  rpc(user, 'create_recipe', [
    randomUUID(), `Receta ${randomUUID().slice(0, 6)}`, yieldQty, 'porciones',
    JSON.stringify(items.map(([ingredient_id, quantity, unit]) => ({ ingredient_id, quantity, unit }))), null, null,
  ]);

type EstimateOptions = { desired?: number; adjustments?: unknown[]; provisional?: unknown[]; labor?: unknown; extras?: unknown[]; pricing?: unknown };

const estimate = (user: TestUser, versionId: string, o: EstimateOptions = {}) =>
  db.asUser(user, () =>
    db.rpc('estimate_production', [
      versionId, o.desired ?? null, JSON.stringify(o.adjustments ?? []), JSON.stringify(o.provisional ?? []),
      o.labor === undefined ? null : JSON.stringify(o.labor), JSON.stringify(o.extras ?? []),
      o.pricing === undefined ? null : JSON.stringify(o.pricing),
    ]),
  ) as Promise<Estimate>;

const containers = (user: TestUser, ingredientId: string) =>
  db.asUser(user, () =>
    db.rows<{ id: string; received_on: string; balance: string }>(
      'select id, received_on, balance from public.containers where ingredient_id = $1 order by received_on, created_at', [ingredientId],
    ),
  );

const labor = { mode: 'per_batch', amount_clp: 0 };

describe('asignación de envases (7.4)', () => {
  it('usa primero los envases abiertos y luego el cerrado más antiguo que alcanza', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01');
    await buy(ana, harina.presentation, 1, 1200, '2026-01-05');
    await buy(ana, harina.presentation, 1, 1100, '2026-01-10');
    const [oldest, middle, newest] = await containers(ana, harina.id);
    // Abre el más nuevo con una merma: queda con 400 g.
    await rpc(ana, 'register_container_movement', [randomUUID(), newest.id, 'waste', 600, null, null, null]);

    const r = await recipe(ana, [[harina.id, 900, 'g']]);
    const e = await estimate(ana, r.current_version_id as string, { labor });
    const picks = e.lines[0].containers;
    // 400 g del abierto (aunque sea el más nuevo) y 500 g del cerrado más antiguo.
    expect(picks.map((p) => [p.container_id, Number(p.take), p.opened])).toEqual([
      [newest.id, 400, true],
      [oldest.id, 500, false],
    ]);
    expect(picks.some((p) => p.container_id === middle.id)).toBe(false);
    // Costo: 400 g × 1,1 + 500 g × 1,0.
    expect(Number(e.ingredients_cost)).toBeCloseTo(940, 8);
  });

  it('si ningún cerrado alcanza, abre primero el más grande para abrir menos envases', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    const saco = await rpc(ana, 'create_presentation', [
      randomUUID(),
      (await db.asUser(ana, () => db.one<{ id: string }>('select id from public.brands'))).id,
      5, 'kg', null, null, null,
    ]);
    await buy(ana, harina.presentation, 3, 3000, '2026-01-01');
    await rpc(ana, 'confirm_purchase', [
      randomUUID(), '2026-01-08', JSON.stringify([{ presentation_id: saco.id, container_count: 1, paid_total_clp: 4500 }]), '[]', null, false, null,
    ]);
    const r = await recipe(ana, [[harina.id, 6, 'kg']]);
    const e = await estimate(ana, r.current_version_id as string, { labor });
    // Saco de 5 kg + una bolsa de 1 kg = 2 envases abiertos (en vez de 3 bolsas + parte del saco).
    expect(e.lines[0].containers.map((p) => Number(p.take))).toEqual([5000, 1000]);
  });

  it('informa faltantes sin fallar y el costo faltante nunca cuenta como cero', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01');
    const r = await recipe(ana, [[harina.id, 1.5, 'kg']]);
    const e = await estimate(ana, r.current_version_id as string, { labor });
    expect(e.lines[0]).toMatchObject({ required: 1500, allocated: 1000, shortage: 500, cost_status: 'incomplete' });
    expect(Number(e.lines[0].unknown_quantity)).toBe(500);
    expect(e).toMatchObject({ has_shortages: true, cost_status: 'incomplete' });
    expect(e.warnings).toEqual(expect.arrayContaining(['shortage', 'unknown_ingredient_cost']));

    // Con un costo provisional explícito, la parte faltante se valora y queda marcada como provisional.
    const p = await estimate(ana, r.current_version_id as string, { labor, provisional: [{ ingredient_id: harina.id, unit_cost: 1.2 }] });
    expect(Number(p.ingredients_cost)).toBeCloseTo(1600, 8);
    expect(p.cost_status).toBe('provisional');
  });
});

describe('estimación de costos', () => {
  it('escala exacto, permite ajustes temporales y suma mano de obra y embalajes', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    const huevo = await ingredient(ana, 'Huevo', 'count', 30, 'unidad');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01');
    await buy(ana, huevo.presentation, 1, 6000, '2026-01-01');
    const r = await recipe(ana, [[harina.id, 600, 'g'], [huevo.id, 3, 'unidad']], 12);

    const e = await estimate(ana, r.current_version_id as string, {
      desired: 10,
      labor: { mode: 'per_unit', amount_clp: 100 },
      extras: [{ kind: 'packaging', description: 'Cajas', amount_clp: 500 }],
    });
    // 3 huevos × 10/12 = 2,5 huevos, sin redondear.
    expect(Number(e.lines[1].required)).toBe(2.5);
    expect(Number(e.labor!.total)).toBe(1000);
    // 500 g × 1 + 2,5 × 200 + mano de obra 1.000 + cajas 500.
    expect(Number(e.total_cost)).toBeCloseTo(2500, 8);
    expect(e.cost_status).toBe('complete');

    const adj = await estimate(ana, r.current_version_id as string, {
      desired: 10, labor, adjustments: [{ ingredient_id: huevo.id, quantity: 3, unit: 'unidad' }],
    });
    expect(Number(adj.lines[1].required)).toBe(3);
  });

  it('sin mano de obra registrada, el resultado queda incompleto', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01');
    const r = await recipe(ana, [[harina.id, 100, 'g']]);
    const e = await estimate(ana, r.current_version_id as string);
    expect(e.cost_status).toBe('incomplete');
    expect(e.warnings).toContain('labor_missing');
  });

  it('un envase sin costo conocido deja la línea incompleta', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await rpc(ana, 'register_manual_entry', [randomUUID(), harina.presentation, 1, 1, '2026-01-01', null, false, false, null]);
    const r = await recipe(ana, [[harina.id, 100, 'g']]);
    const e = await estimate(ana, r.current_version_id as string, { labor });
    expect(e.lines[0]).toMatchObject({ cost_status: 'incomplete', shortage: 0 });
    expect(Number(e.lines[0].known_cost)).toBe(0);
    expect(Number(e.lines[0].unknown_quantity)).toBe(100);
    expect(e.cost_status).toBe('incomplete');
  });

  it('el cargo "completo en el primer uso" se imputa al abrir un envase cerrado', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01', [
      { description: 'Bolsa', amount_clp: 300, treatment: 'distributed', method: 'by_value', partial_rule: 'first_use' },
    ]);
    const r = await recipe(ana, [[harina.id, 100, 'g']]);
    const e = await estimate(ana, r.current_version_id as string, { labor });
    expect(Number(e.lines[0].containers[0].first_use_clp)).toBe(300);
    expect(Number(e.ingredients_cost)).toBeCloseTo(400, 8);
  });

  it('precio sugerido por porcentaje o por valor fijo sobre el costo', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 10, 10000, '2026-01-01');
    const r = await recipe(ana, [[harina.id, 10, 'kg']], 20);
    const pct = await estimate(ana, r.current_version_id as string, { labor, pricing: { method: 'percentage', value: 20 } });
    expect(Number(pct.pricing!.price)).toBeCloseTo(12000, 8);
    expect(Number(pct.pricing!.unit_price)).toBeCloseTo(600, 8);
    const fixed = await estimate(ana, r.current_version_id as string, { labor, pricing: { method: 'fixed', value: 5000 } });
    expect(Number(fixed.pricing!.price)).toBeCloseTo(15000, 8);
  });
});

describe('simulaciones guardadas', () => {
  it('se guardan sin tocar el inventario, una sola vez por clave, y no se modifican', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    await buy(ana, harina.presentation, 1, 1000, '2026-01-01');
    const r = await recipe(ana, [[harina.id, 800, 'g']]);
    const before = await db.asUser(ana, () => db.rows('select id, balance, opened_at from public.containers order by id'));
    const movesBefore = await db.asUser(ana, () => db.rows('select id from public.inventory_movements'));

    const key = randomUUID();
    const args = [key, r.current_version_id, null, '[]', '[]', JSON.stringify(labor), '[]', null, 'Prueba'];
    const s = await rpc(ana, 'save_simulation', args);
    expect((await rpc(ana, 'save_simulation', args)).id).toBe(s.id);
    expect(await db.asUser(ana, () => db.rows('select id from public.simulations'))).toHaveLength(1);

    expect(await db.asUser(ana, () => db.rows('select id, balance, opened_at from public.containers order by id'))).toEqual(before);
    expect(await db.asUser(ana, () => db.rows('select id from public.inventory_movements'))).toHaveLength(movesBefore.length);

    const saved = await db.asUser(ana, () =>
      db.one<{ result: Estimate; cost_status: string }>('select result, cost_status from public.simulations where id = $1', [s.id]),
    );
    expect(saved.cost_status).toBe('complete');
    expect(Number(saved.result.total_cost)).toBeCloseTo(800, 8);
    expect(await expectDbError(db.rows('update public.simulations set total_cost = 0'))).toBe('IMMUTABLE_RECORD');
  });

  it('otra cuenta no estima ni ve recetas o simulaciones ajenas', async () => {
    const harina = await ingredient(ana, 'Harina', 'mass', 1, 'kg');
    const r = await recipe(ana, [[harina.id, 100, 'g']]);
    await rpc(ana, 'save_simulation', [randomUUID(), r.current_version_id, null, '[]', '[]', null, '[]', null, null]);
    expect(await expectDbError(estimate(beto, r.current_version_id as string))).toBe('VERSION_NOT_FOUND');
    expect(
      await expectDbError(rpc(beto, 'save_simulation', [randomUUID(), r.current_version_id, null, '[]', '[]', null, '[]', null, null])),
    ).toBe('VERSION_NOT_FOUND');
    expect(await db.asUser(beto, () => db.rows('select id from public.simulations'))).toHaveLength(0);
  });
});
