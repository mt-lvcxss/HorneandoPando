import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, expectDbError, type TestDb, type TestUser } from './harness';

let db: TestDb;
let ana: TestUser;
let beto: TestUser;
let harina: string;
let huevo: string;

beforeEach(async () => {
  db = await createTestDb();
  ana = await db.signInVerified(await db.createUser('ana@test.cl'));
  beto = await db.signInVerified(await db.createUser('beto@test.cl'));
  harina = (await rpc(ana, 'create_ingredient', [randomUUID(), 'Harina', 'mass', null])).id;
  huevo = (await rpc(ana, 'create_ingredient', [randomUUID(), 'Huevo', 'count', null])).id;
});

afterEach(async () => {
  await db.close();
});

type Row = Record<string, unknown> & { id: string };

const rpc = (user: TestUser, name: string, args: unknown[]) => db.asUser(user, () => db.rpc(name, args)) as Promise<Row>;

const items = (list: [string, number, string][]) =>
  JSON.stringify(list.map(([ingredient_id, quantity, unit]) => ({ ingredient_id, quantity, unit })));

const createRecipe = (user: TestUser, name: string, list: [string, number, string][], key = randomUUID()) =>
  rpc(user, 'create_recipe', [key, name, 12, 'porciones', items(list), null, null]);

const newVersion = (user: TestUser, recipeId: string, kind: string, list: [string, number, string][], makeCurrent: boolean | null = null) =>
  rpc(user, 'create_recipe_version', [randomUUID(), recipeId, kind, 12, 'porciones', items(list), null, null, null, 'Cambio', makeCurrent]);

const versionsOf = (user: TestUser, recipeId: string) =>
  db.asUser(user, () =>
    db.rows<{ id: string; version_no: number; kind: string; label: string }>(
      'select id, version_no, kind, label from public.recipe_versions where recipe_id = $1 order by version_no',
      [recipeId],
    ),
  );

const currentOf = async (user: TestUser, recipeId: string) =>
  (await db.asUser(user, () => db.one<{ current_version_id: string }>('select current_version_id from public.recipes where id = $1', [recipeId])))
    .current_version_id;

describe('recetas', () => {
  it('se crea con su versión 1 vigente y un reintento no la duplica', async () => {
    const key = randomUUID();
    const r = await createRecipe(ana, 'Queque', [[harina, 0.5, 'kg'], [huevo, 3, 'unidad']], key);
    expect((await createRecipe(ana, 'Queque', [[harina, 0.5, 'kg'], [huevo, 3, 'unidad']], key)).id).toBe(r.id);

    const versions = await versionsOf(ana, r.id);
    expect(versions).toEqual([{ id: r.current_version_id, version_no: 1, kind: 'main', label: 'Versión 1' }]);
    const lines = await db.asUser(ana, () =>
      db.rows<{ quantity: string; unit: string }>('select quantity, unit from public.recipe_version_items order by line_no'),
    );
    // La cantidad se guarda tal como se escribió (0,5 kg), sin convertir ni redondear.
    expect(lines.map((l) => [Number(l.quantity), l.unit])).toEqual([
      [0.5, 'kg'],
      [3, 'unidad'],
    ]);
  });

  it('valida nombre, rendimiento, ingredientes y unidades convertibles', async () => {
    expect(await expectDbError(createRecipe(ana, ' ', [[harina, 1, 'kg']]))).toBe('RECIPE_NAME_REQUIRED');
    expect(await expectDbError(createRecipe(ana, 'X', []))).toBe('RECIPE_ITEMS_REQUIRED');
    expect(await expectDbError(createRecipe(ana, 'X', [[harina, 0, 'kg']]))).toBe('INVALID_QUANTITY');
    expect(await expectDbError(createRecipe(ana, 'X', [[harina, 1, 'kg'], [harina, 2, 'g']]))).toBe('DUPLICATE_INGREDIENT');
    expect(
      await expectDbError(rpc(ana, 'create_recipe', [randomUUID(), 'X', 0, 'porciones', items([[harina, 1, 'kg']]), null, null])),
    ).toBe('INVALID_YIELD');
    // Huevos en gramos sin equivalencia: no se mezclan unidades incompatibles.
    expect(await expectDbError(createRecipe(ana, 'X', [[huevo, 150, 'g']]))).toBe('UNIT_NOT_CONVERTIBLE');
    await rpc(ana, 'set_ingredient_equivalence', [randomUUID(), huevo, 1, 'unidad', 50, 'g', null]);
    await createRecipe(ana, 'X', [[huevo, 150, 'g']]);

    await createRecipe(ana, 'Pan', [[harina, 1, 'kg']]);
    expect(await expectDbError(createRecipe(ana, 'pan', [[harina, 1, 'kg']]))).toBe('RECIPE_NAME_TAKEN');
  });

  it('una versión principal pasa a ser la vigente; una alternativa conserva la base', async () => {
    const r = await createRecipe(ana, 'Queque', [[harina, 500, 'g'], [huevo, 3, 'unidad']]);
    const v1 = r.current_version_id as string;

    const alt = await newVersion(ana, r.id, 'alternative', [[harina, 500, 'g'], [huevo, 4, 'unidad']]);
    expect(alt).toMatchObject({ version_no: 2, kind: 'alternative', label: 'Alternativa 2', is_current: false });
    expect(await currentOf(ana, r.id)).toBe(v1);

    const v3 = await newVersion(ana, r.id, 'main', [[harina, 450, 'g'], [huevo, 3, 'unidad']]);
    expect(v3).toMatchObject({ version_no: 3, is_current: true });
    expect(await currentOf(ana, r.id)).toBe(v3.id);

    // El usuario puede elegir cualquier versión existente como vigente.
    await rpc(ana, 'set_current_recipe_version', [r.id, alt.id]);
    expect(await currentOf(ana, r.id)).toBe(alt.id);

    // La versión 1 conserva su formulación original.
    const v1Items = await db.asUser(ana, () =>
      db.rows<{ quantity: string }>('select quantity from public.recipe_version_items where version_id = $1 order by line_no', [v1]),
    );
    expect(v1Items.map((i) => Number(i.quantity))).toEqual([500, 3]);
  });

  it('las versiones y sus líneas son inmutables', async () => {
    const r = await createRecipe(ana, 'Queque', [[harina, 500, 'g']]);
    expect(await expectDbError(db.rows('update public.recipe_version_items set quantity = 1'))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.rows('update public.recipe_versions set yield_quantity = 1'))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.rows('delete from public.recipe_versions where recipe_id = $1', [r.id]))).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.asUser(ana, () => db.rows("update public.recipes set name = 'X'")))).toMatch(/permission denied/);
  });

  it('la versión vigente debe pertenecer a su receta', async () => {
    const a = await createRecipe(ana, 'Queque', [[harina, 500, 'g']]);
    const b = await createRecipe(ana, 'Pan', [[harina, 1, 'kg']]);
    expect(await expectDbError(rpc(ana, 'set_current_recipe_version', [a.id, b.current_version_id]))).toBe('VERSION_NOT_FOUND');
    // Ni siquiera escribiendo directamente como superusuario.
    expect(
      await expectDbError(db.rows('update public.recipes set current_version_id = $1 where id = $2', [b.current_version_id, a.id])),
    ).toMatch(/foreign key/);
  });

  it('nombre y descripción se editan sin crear versión; archivar bloquea nuevas versiones', async () => {
    const r = await createRecipe(ana, 'Queque', [[harina, 500, 'g']]);
    await rpc(ana, 'update_recipe', [r.id, 'Queque de vainilla', 'Clásico']);
    expect(await versionsOf(ana, r.id)).toHaveLength(1);

    await rpc(ana, 'set_recipe_archived', [r.id, true]);
    expect(await expectDbError(newVersion(ana, r.id, 'main', [[harina, 1, 'kg']]))).toBe('RECIPE_ARCHIVED');
    await rpc(ana, 'set_recipe_archived', [r.id, false]);

    // Un ingrediente archivado no se puede usar en una versión nueva.
    await rpc(ana, 'set_ingredient_archived', [harina, true]);
    expect(await expectDbError(newVersion(ana, r.id, 'main', [[harina, 1, 'kg']]))).toBe('INGREDIENT_ARCHIVED');
  });

  it('otra cuenta no ve ni usa las recetas ajenas', async () => {
    const r = await createRecipe(ana, 'Queque', [[harina, 500, 'g']]);
    for (const table of ['recipes', 'recipe_versions', 'recipe_version_items']) {
      expect(await db.asUser(beto, () => db.rows(`select * from public.${table}`))).toHaveLength(0);
    }
    expect(await expectDbError(newVersion(beto, r.id, 'main', [[harina, 1, 'kg']]))).toBe('RECIPE_NOT_FOUND');
    expect(await expectDbError(rpc(beto, 'update_recipe', [r.id, 'Robada', null]))).toBe('RECIPE_NOT_FOUND');
    // Beto tampoco puede usar un ingrediente de Ana en su receta.
    expect(await expectDbError(createRecipe(beto, 'Mía', [[harina, 1, 'kg']]))).toBe('INGREDIENT_NOT_FOUND');
  });
});
