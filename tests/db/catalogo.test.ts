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

const createIngredient = (user: TestUser, name: string, dimension = 'mass', key = randomUUID()) =>
  db.asUser(user, () => db.rpc('create_ingredient', [key, name, dimension, null])) as Promise<Row>;

const createBrand = (user: TestUser, ingredientId: string, name: string, key = randomUUID()) =>
  db.asUser(user, () => db.rpc('create_brand', [key, ingredientId, name, null])) as Promise<Row>;

const createPresentation = (user: TestUser, brandId: string, quantity: number, unit: string, price: number | null = null) =>
  db.asUser(user, () =>
    db.rpc('create_presentation', [randomUUID(), brandId, quantity, unit, null, price, null]),
  ) as Promise<Row>;

/** Ingrediente con una marca, listo para agregarle presentaciones. */
async function ingredientWithBrand(user: TestUser, name: string, brand: string, dimension = 'mass') {
  const ingredient = await createIngredient(user, name, dimension);
  return { ingredient, brand: await createBrand(user, ingredient.id, brand) };
}

const setEquivalence = (user: TestUser, ingredientId: string, qa: number, ua: string, qb: number, ub: string) =>
  db.asUser(user, () => db.rpc('set_ingredient_equivalence', [randomUUID(), ingredientId, qa, ua, qb, ub, null])) as Promise<Row>;

const convert = (user: TestUser, ingredientId: string, quantity: number, unit: string) =>
  db.asUser(user, () => db.rpc('convert_to_ingredient_base', [ingredientId, quantity, unit])) as Promise<{
    convertible: boolean;
    quantity: number | null;
    base_unit: string;
    equivalence_id: string | null;
  }>;

describe('unidades', () => {
  it('ofrece tres dimensiones con su unidad base', async () => {
    const units = await db.asUser(ana, () =>
      db.rows<{ code: string }>('select code from public.units order by sort_order'),
    );
    expect(units.map((u) => u.code)).toEqual(['g', 'kg', 'ml', 'l', 'unidad']);
    expect(await db.asAnon(() => expectDbError(db.rows('select * from public.units')))).toMatch(/permission denied/);
  });
});

describe('configuración operacional', () => {
  it('cada cuenta nace con los valores por defecto (productos terminados desactivado)', async () => {
    const rows = await db.asUser(ana, () => db.rows('select * from public.account_settings'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ finished_goods_tracking: false, charge_distribution_default: 'by_value' });
    // Valores recomendados del precio sugerido (D-025).
    expect(Number(rows[0].pricing_percentage)).toBe(20);
    expect(Number(rows[0].pricing_fixed_clp)).toBe(5000);
    expect(rows[0]).not.toHaveProperty('replacement_cost_criterion');
  });

  it('se actualiza solo por RPC, valida los valores y queda auditada', async () => {
    const r = (await db.asUser(ana, () => db.rpc('update_operation_settings', [true, 'by_quantity', 25, 3000]))) as Row;
    expect(r).toMatchObject({ finished_goods_tracking: true, charge_distribution_default: 'by_quantity', pricing_percentage: 25, pricing_fixed_clp: 3000 });
    expect(await expectDbError(db.asUser(ana, () => db.rpc('update_operation_settings', [true, 'by_value', -1, 0])))).toBe(
      'INVALID_PRICING_PERCENTAGE',
    );
    expect(await expectDbError(db.asUser(ana, () => db.rpc('update_operation_settings', [true, 'by_value', 20, -5])))).toBe(
      'INVALID_PRICING_FIXED',
    );

    expect(await expectDbError(db.asUser(ana, () => db.rpc('update_operation_settings', [true, 'cualquiera', 20, 5000])))).toBe(
      'INVALID_DISTRIBUTION_CRITERION',
    );
    expect(
      await expectDbError(db.asUser(ana, () => db.rows('update public.account_settings set finished_goods_tracking = false'))),
    ).toMatch(/permission denied/);

    expect(await db.rows("select action from private.audit_log where action = 'settings.updated'")).toHaveLength(1);
    // La configuración de la otra cuenta no cambió.
    expect(await db.asUser(beto, () => db.one('select finished_goods_tracking from public.account_settings'))).toEqual({
      finished_goods_tracking: false,
    });
  });
});

describe('ingredientes', () => {
  it('crea un ingrediente y un reintento con la misma clave no lo duplica', async () => {
    const key = randomUUID();
    const first = await createIngredient(ana, 'Harina', 'mass', key);
    const retry = await createIngredient(ana, 'Harina', 'mass', key);
    expect(retry.id).toBe(first.id);
    expect(await db.asUser(ana, () => db.rows('select id from public.ingredients'))).toHaveLength(1);

    expect(await expectDbError(createIngredient(ana, 'Azúcar', 'mass', key))).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('valida nombre y dimensión', async () => {
    expect(await expectDbError(createIngredient(ana, '   '))).toBe('INGREDIENT_NAME_REQUIRED');
    expect(await expectDbError(createIngredient(ana, 'Sal', 'peso'))).toBe('INVALID_DIMENSION');
  });

  it('no permite dos ingredientes activos con el mismo nombre, pero sí tras archivar', async () => {
    const harina = await createIngredient(ana, 'Harina');
    expect(await expectDbError(createIngredient(ana, '  harina '))).toBe('INGREDIENT_NAME_TAKEN');

    await db.asUser(ana, () => db.rpc('set_ingredient_archived', [harina.id, true]));
    const nueva = await createIngredient(ana, 'Harina');
    expect(nueva.id).not.toBe(harina.id);

    // Restaurar el archivado chocaría con el nombre activo.
    expect(await expectDbError(db.asUser(ana, () => db.rpc('set_ingredient_archived', [harina.id, false])))).toBe(
      'INGREDIENT_NAME_TAKEN',
    );
    // Otra cuenta puede usar el mismo nombre.
    await createIngredient(beto, 'Harina');
  });

  it('el navegador no puede escribir directamente en las tablas', async () => {
    const { ingredient, brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    for (const sql of [
      "insert into public.ingredients (name, dimension) values ('X', 'mass')",
      `update public.ingredients set name = 'Otra' where id = '${ingredient.id}'`,
      `delete from public.ingredients where id = '${ingredient.id}'`,
      `insert into public.brands (ingredient_id, name) values ('${ingredient.id}', 'X')`,
      `update public.brands set name = 'Otra' where id = '${brand.id}'`,
      `insert into public.presentations (ingredient_id, brand_id, quantity, unit) values ('${ingredient.id}', '${brand.id}', 1, 'kg')`,
    ]) {
      expect(await expectDbError(db.asUser(ana, () => db.rows(sql)))).toMatch(/permission denied/);
    }
  });

  it('una cuenta no ve ni modifica el catálogo de otra', async () => {
    const { ingredient, brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    const presentation = await createPresentation(ana, brand.id, 25, 'kg');
    for (const table of ['ingredients', 'brands', 'presentations']) {
      expect(await db.asUser(beto, () => db.rows(`select id from public.${table}`))).toHaveLength(0);
    }

    const asBeto = (name: string, args: unknown[]) => expectDbError(db.asUser(beto, () => db.rpc(name, args)));
    expect(await asBeto('update_ingredient', [ingredient.id, 'Robada', 'mass', null])).toBe('INGREDIENT_NOT_FOUND');
    expect(await asBeto('set_ingredient_archived', [ingredient.id, true])).toBe('INGREDIENT_NOT_FOUND');
    expect(await asBeto('create_brand', [randomUUID(), ingredient.id, 'Intrusa', null])).toBe('INGREDIENT_NOT_FOUND');
    expect(await asBeto('update_brand', [brand.id, 'Robada', null])).toBe('BRAND_NOT_FOUND');
    expect(await asBeto('set_brand_archived', [brand.id, true])).toBe('BRAND_NOT_FOUND');
    expect(await asBeto('create_presentation', [randomUUID(), brand.id, 1, 'kg', null, null, null])).toBe('BRAND_NOT_FOUND');
    expect(await asBeto('update_presentation', [presentation.id, 1, 'kg', null, null, null])).toBe('PRESENTATION_NOT_FOUND');
    expect(await asBeto('set_presentation_archived', [presentation.id, true])).toBe('PRESENTATION_NOT_FOUND');
    expect(await expectDbError(setEquivalence(beto, ingredient.id, 1, 'l', 900, 'g'))).toBe('INGREDIENT_NOT_FOUND');
    expect(await expectDbError(convert(beto, ingredient.id, 1, 'kg'))).toBe('INGREDIENT_NOT_FOUND');

    expect(await db.asUser(ana, () => db.one('select name, archived_at from public.brands'))).toEqual({
      name: 'Selecta',
      archived_at: null,
    });
  });

  it('la dimensión solo cambia mientras no haya presentaciones', async () => {
    const { ingredient: huevo, brand } = await ingredientWithBrand(ana, 'Huevo', 'Del campo', 'mass');
    // Tener marcas no bloquea: aún no hay envases con unidad.
    const fixed = (await db.asUser(ana, () => db.rpc('update_ingredient', [huevo.id, 'Huevo', 'count', null]))) as Row;
    expect(fixed).toMatchObject({ dimension: 'count' });

    await createPresentation(ana, brand.id, 30, 'unidad');
    expect(await expectDbError(db.asUser(ana, () => db.rpc('update_ingredient', [huevo.id, 'Huevo', 'mass', null])))).toBe(
      'DIMENSION_LOCKED',
    );
  });

  it('requiere sesión verificada', async () => {
    const intruso = await db.createUser('sinverificar@test.cl');
    await db.asUser(intruso, () => db.rpc('begin_session', [intruso.deviceToken, null]));
    expect(await expectDbError(createIngredient(intruso, 'Harina'))).toBe('SESSION_NOT_VALID');
    expect(
      await db.asAnon(() => expectDbError(db.rpc('create_ingredient', [randomUUID(), 'X', 'mass', null]))),
    ).toMatch(/permission denied/);
  });
});

describe('marcas', () => {
  it('un ingrediente tiene varias marcas, sin repetir nombre entre las activas', async () => {
    const harina = await createIngredient(ana, 'Harina');
    const key = randomUUID();
    const selecta = await createBrand(ana, harina.id, 'Selecta', key);
    expect((await createBrand(ana, harina.id, 'Selecta', key)).id).toBe(selecta.id);
    await createBrand(ana, harina.id, 'Collico');
    expect(await expectDbError(createBrand(ana, harina.id, ' selecta '))).toBe('BRAND_NAME_TAKEN');
    expect(await expectDbError(createBrand(ana, harina.id, '  '))).toBe('BRAND_NAME_REQUIRED');

    // La misma marca puede existir en otro ingrediente.
    const polvos = await createIngredient(ana, 'Polvos de hornear');
    await createBrand(ana, polvos.id, 'Selecta');

    expect(await db.asUser(ana, () => db.rows('select id from public.brands where ingredient_id = $1', [harina.id]))).toHaveLength(2);
  });

  it('archivar y restaurar respeta la marca y el ingrediente', async () => {
    const { ingredient, brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    await db.asUser(ana, () => db.rpc('set_brand_archived', [brand.id, true]));
    expect(await expectDbError(createPresentation(ana, brand.id, 1, 'kg'))).toBe('BRAND_ARCHIVED');

    await createBrand(ana, ingredient.id, 'Selecta');
    expect(await expectDbError(db.asUser(ana, () => db.rpc('set_brand_archived', [brand.id, false])))).toBe(
      'BRAND_NAME_TAKEN',
    );

    await db.asUser(ana, () => db.rpc('set_ingredient_archived', [ingredient.id, true]));
    expect(await expectDbError(createBrand(ana, ingredient.id, 'Collico'))).toBe('INGREDIENT_ARCHIVED');
  });
});

describe('presentaciones', () => {
  it('exige una unidad de la misma dimensión que el ingrediente', async () => {
    const { ingredient, brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    const saco = await createPresentation(ana, brand.id, 25, 'kg', 18990);
    expect(saco).toMatchObject({ quantity: 25, unit: 'kg', reference_price_clp: 18990, ingredient_id: ingredient.id });
    // El precio de referencia siempre queda con fecha.
    expect(saco.reference_price_date).toBeTruthy();

    expect(await expectDbError(createPresentation(ana, brand.id, 1, 'l'))).toBe('UNIT_DIMENSION_MISMATCH');
    expect(await expectDbError(createPresentation(ana, brand.id, 0, 'kg'))).toBe('INVALID_QUANTITY');
    expect(await expectDbError(createPresentation(ana, brand.id, 1, 'taza'))).toBe('INVALID_UNIT');
  });

  it('un precio cero no se acepta: un costo desconocido se deja vacío', async () => {
    const { brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    expect(await expectDbError(createPresentation(ana, brand.id, 1, 'kg', 0))).toBe('INVALID_PRICE');
    const sinPrecio = await createPresentation(ana, brand.id, 1, 'kg', null);
    expect(sinPrecio).toMatchObject({ reference_price_clp: null, reference_price_date: null });
  });

  it('no se restaura una presentación si su marca o su ingrediente están archivados', async () => {
    const { ingredient, brand } = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    const kilo = await createPresentation(ana, brand.id, 1, 'kg');
    await db.asUser(ana, () => db.rpc('set_presentation_archived', [kilo.id, true]));
    await db.asUser(ana, () => db.rpc('set_brand_archived', [brand.id, true]));
    expect(await expectDbError(db.asUser(ana, () => db.rpc('set_presentation_archived', [kilo.id, false])))).toBe(
      'BRAND_ARCHIVED',
    );
    await db.asUser(ana, () => db.rpc('set_ingredient_archived', [ingredient.id, true]));
    expect(await expectDbError(db.asUser(ana, () => db.rpc('set_presentation_archived', [kilo.id, false])))).toBe(
      'INGREDIENT_ARCHIVED',
    );
  });

  it('la base de datos impide mezclar cuentas o asignar una marca de otro ingrediente', async () => {
    const harina = await ingredientWithBrand(ana, 'Harina', 'Selecta');
    const azucar = await ingredientWithBrand(ana, 'Azúcar', 'Iansa');
    const accountAna = (await db.asUser(ana, () => db.one<{ id: string }>('select id from public.accounts'))).id;
    const accountBeto = (await db.asUser(beto, () => db.one<{ id: string }>('select id from public.accounts'))).id;
    const insert = (account: string, ingredientId: string, brandId: string) =>
      db.rows(
        "insert into public.presentations (account_id, ingredient_id, brand_id, quantity, unit) values ($1, $2, $3, 1, 'kg')",
        [account, ingredientId, brandId],
      );
    // Incluso escribiendo como superusuario, las FK compuestas lo rechazan.
    expect(await expectDbError(insert(accountBeto, harina.ingredient.id, harina.brand.id))).toMatch(/foreign key/);
    expect(await expectDbError(insert(accountAna, harina.ingredient.id, azucar.brand.id))).toMatch(/foreign key/);
  });
});

describe('equivalencias y conversiones', () => {
  it('convierte automáticamente dentro de una dimensión y nunca entre dimensiones sin equivalencia', async () => {
    const harina = await createIngredient(ana, 'Harina', 'mass');
    expect(await convert(ana, harina.id, 2.5, 'kg')).toMatchObject({ convertible: true, quantity: 2500, base_unit: 'g' });
    expect(await convert(ana, harina.id, 1, 'unidad')).toMatchObject({ convertible: false, quantity: null });
  });

  it('usa la equivalencia del usuario, en cualquier orden, sin perder exactitud', async () => {
    const huevo = await createIngredient(ana, 'Huevo', 'count');
    // Escrita como "100 g = 3 unidades" (el lado del ingrediente a la derecha o a la izquierda da igual).
    const eq = await setEquivalence(ana, huevo.id, 100, 'g', 3, 'unidad');
    expect(eq).toMatchObject({ other_unit: 'g', ingredient_unit: 'unidad', other_dimension: 'mass' });

    const r = await convert(ana, huevo.id, 100, 'g');
    expect(r).toMatchObject({ convertible: true, base_unit: 'unidad', equivalence_id: eq.id });
    expect(Number(r.quantity)).toBe(3);

    expect(await expectDbError(setEquivalence(ana, huevo.id, 1, 'kg', 500, 'g'))).toBe('EQUIVALENCE_SAME_DIMENSION');
    expect(await expectDbError(setEquivalence(ana, huevo.id, 1, 'l', 1000, 'g'))).toBe('EQUIVALENCE_DIMENSION');
  });

  it('una equivalencia nueva reemplaza a la anterior y conserva la historia', async () => {
    const huevo = await createIngredient(ana, 'Huevo', 'count');
    const primera = await setEquivalence(ana, huevo.id, 1, 'unidad', 50, 'g');
    const segunda = await setEquivalence(ana, huevo.id, 1, 'unidad', 60, 'g');

    const all = await db.asUser(ana, () =>
      db.rows<{ id: string; superseded_at: string | null }>('select id, superseded_at from public.ingredient_equivalences'),
    );
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.id === primera.id)?.superseded_at).not.toBeNull();
    expect(all.find((e) => e.id === segunda.id)?.superseded_at).toBeNull();

    expect(Number((await convert(ana, huevo.id, 120, 'g')).quantity)).toBe(2);

    // Una conversión en la fecha de la primera usa la equivalencia vigente entonces.
    const past = await db.one<{ quantity: string; equivalence_id: string }>(
      'select * from private.to_ingredient_base((select account_id from public.ingredients where id = $1), $1, 100, $2, $3)',
      [huevo.id, 'g', primera.created_at],
    );
    expect(Number(past.quantity)).toBe(2);
    expect(past.equivalence_id).toBe(primera.id);
  });

  it('las equivalencias no se editan ni se borran', async () => {
    const huevo = await createIngredient(ana, 'Huevo', 'count');
    const eq = await setEquivalence(ana, huevo.id, 1, 'unidad', 50, 'g');
    expect(
      await expectDbError(db.rows('update public.ingredient_equivalences set ingredient_base_quantity = 70 where id = $1', [eq.id])),
    ).toBe('IMMUTABLE_RECORD');
    expect(await expectDbError(db.rows('delete from public.ingredient_equivalences where id = $1', [eq.id]))).toBe(
      'IMMUTABLE_RECORD',
    );

    await db.asUser(ana, () => db.rpc('retire_ingredient_equivalence', [eq.id]));
    expect((await convert(ana, huevo.id, 50, 'g')).convertible).toBe(false);
    // Una equivalencia retirada no se puede reactivar.
    expect(
      await expectDbError(db.rows('update public.ingredient_equivalences set superseded_at = null where id = $1', [eq.id])),
    ).toBe('IMMUTABLE_RECORD');
  });
});
