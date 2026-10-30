-- =============================================================================
-- Etapa 3.4 · Asignación de envases, estimación de costos y simulaciones (D-026)
--
--   * private.allocate_ingredient propone de qué envases consumir (sección 7.4):
--       1. envases abiertos, del más antiguo al más nuevo;
--       2. luego cerrados, abriendo la menor cantidad posible: si uno solo cubre lo que falta, el más
--          antiguo de los que alcanzan; si no, el más grande (empate: el más antiguo);
--     sin bloquear nada: es una propuesta. La producción real (3.5) la revalida con bloqueo.
--   * private.compute_estimate calcula cantidades, faltantes y costos de una versión de receta para un
--     rendimiento. Un costo desconocido nunca se cuenta como 0: el resultado queda incompleto.
--   * Una simulación guarda una foto inmutable del cálculo. No toca inventario ni reserva nada.
-- =============================================================================

create function private.allocate_ingredient(p_account_id uuid, p_ingredient_id uuid, p_required numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_remaining numeric := p_required;
  v_picks     jsonb := '[]'::jsonb;
  v_chosen    uuid[] := '{}';
  v_take      numeric;
  v_cost      numeric;
  v_first_use numeric;
  r           public.containers;
begin
  -- 1. Abiertos, del más antiguo al más nuevo.
  for r in
    select * from public.containers
     where account_id = p_account_id and ingredient_id = p_ingredient_id and balance > 0 and opened_at is not null
     order by received_on, created_at, id
  loop
    exit when v_remaining <= 0;
    v_take := least(r.balance, v_remaining);
    v_remaining := v_remaining - v_take;
    v_chosen := v_chosen || r.id;
    v_cost := case when r.unit_cost is not null then v_take * (r.unit_cost + r.charge_unit_cost) end;
    v_picks := v_picks || jsonb_build_object(
      'container_id', r.id, 'brand_id', r.brand_id, 'received_on', r.received_on, 'opened', true,
      'balance', r.balance, 'take', v_take, 'unit_cost', r.unit_cost, 'cost_status', r.cost_status,
      'charge_unit_cost', r.charge_unit_cost, 'first_use_clp', 0, 'cost', v_cost);
  end loop;

  -- 2. Cerrados, abriendo la menor cantidad posible.
  while v_remaining > 0 loop
    select * into r from public.containers c
     where c.account_id = p_account_id and c.ingredient_id = p_ingredient_id and c.balance > 0
       and c.opened_at is null and not (c.id = any (v_chosen))
     order by (c.balance >= v_remaining) desc,
              case when c.balance >= v_remaining then 0 else -c.balance end,
              c.received_on, c.created_at, c.id
     limit 1;
    exit when r.id is null;
    v_take := least(r.balance, v_remaining);
    v_remaining := v_remaining - v_take;
    v_chosen := v_chosen || r.id;
    -- Un cargo "completo en el primer uso" se imputa entero al abrir el envase.
    v_first_use := r.charge_first_use_clp;
    v_cost := case when r.unit_cost is not null then v_take * (r.unit_cost + r.charge_unit_cost) + v_first_use end;
    v_picks := v_picks || jsonb_build_object(
      'container_id', r.id, 'brand_id', r.brand_id, 'received_on', r.received_on, 'opened', false,
      'balance', r.balance, 'take', v_take, 'unit_cost', r.unit_cost, 'cost_status', r.cost_status,
      'charge_unit_cost', r.charge_unit_cost, 'first_use_clp', v_first_use, 'cost', v_cost);
    r := null;
  end loop;

  return jsonb_build_object('containers', v_picks, 'allocated', p_required - v_remaining, 'shortage', v_remaining);
end;
$$;

-- Estimación completa de una producción, sin escribir nada.
--   p_adjustments: [{ingredient_id, quantity, unit}] reemplaza temporalmente la cantidad escalada de esa línea.
--   p_provisional: [{ingredient_id, unit_cost}] costo provisional por unidad base para la parte sin costo conocido.
--   p_labor:       {mode: 'per_batch' | 'per_unit', amount_clp} o null (no registrada).
--   p_extras:      [{kind: 'packaging' | 'label' | 'presentation' | 'other', description, amount_clp}].
--   p_pricing:     {method: 'percentage' | 'fixed', value} o null.
create function private.compute_estimate(
  p_account_id     uuid,
  p_version_id     uuid,
  p_desired_yield  numeric,
  p_adjustments    jsonb,
  p_provisional    jsonb,
  p_labor          jsonb,
  p_extras         jsonb,
  p_pricing        jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version       public.recipe_versions;
  v_recipe        public.recipes;
  v_desired       numeric;
  v_factor        numeric;
  v_item          record;
  v_adj           jsonb;
  v_qty           numeric;
  v_unit          text;
  v_required      numeric;
  v_equiv         uuid;
  v_alloc         jsonb;
  v_known         numeric;
  v_unknown_qty   numeric;
  v_prov          numeric;
  v_line_status   text;
  v_has_prov      boolean;
  v_lines         jsonb := '[]'::jsonb;
  v_ingr_total    numeric := 0;
  v_labor_mode    text := p_labor ->> 'mode';
  v_labor_amount  numeric;
  v_labor_total   numeric;
  v_extras        jsonb := '[]'::jsonb;
  v_extra         jsonb;
  v_extras_total  numeric := 0;
  v_total         numeric;
  v_warnings      text[] := '{}';
  v_status        text;
  v_method        text := p_pricing ->> 'method';
  v_pvalue        numeric := (p_pricing ->> 'value')::numeric;
  v_price         numeric;
  v_shortages     boolean := false;
  v_ingredient    public.ingredients;
begin
  select * into v_version from public.recipe_versions where account_id = p_account_id and id = p_version_id;
  if v_version.id is null then
    perform private.fail('VERSION_NOT_FOUND', 'La versión de la receta no existe.');
  end if;
  select * into v_recipe from public.recipes where account_id = p_account_id and id = v_version.recipe_id;

  v_desired := coalesce(p_desired_yield, v_version.yield_quantity);
  if v_desired <= 0 then
    perform private.fail('INVALID_YIELD', 'El rendimiento deseado debe ser mayor que cero.');
  end if;
  v_factor := v_desired / v_version.yield_quantity;

  if p_adjustments is not null and jsonb_typeof(p_adjustments) <> 'array' then
    perform private.fail('INVALID_ADJUSTMENTS', 'Los ajustes no tienen un formato válido.');
  end if;

  for v_item in
    select i.* from public.recipe_version_items i where i.version_id = p_version_id order by i.line_no
  loop
    select * into v_ingredient from public.ingredients where account_id = p_account_id and id = v_item.ingredient_id;
    v_adj := (select a from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) a
               where a ->> 'ingredient_id' = v_item.ingredient_id::text limit 1);
    if v_adj is not null then
      v_qty := (v_adj ->> 'quantity')::numeric;
      v_unit := coalesce(v_adj ->> 'unit', v_item.unit);
      if v_qty is null or v_qty < 0 then
        perform private.fail('INVALID_QUANTITY', format('%s: la cantidad ajustada no puede ser negativa.', v_ingredient.name));
      end if;
    else
      v_qty := v_item.quantity * v_factor;
      v_unit := v_item.unit;
    end if;

    select c.quantity, c.equivalence_id into v_required, v_equiv
      from private.to_ingredient_base(p_account_id, v_item.ingredient_id, v_qty, v_unit) c;
    if v_required is null then
      perform private.fail('UNIT_NOT_CONVERTIBLE',
        format('%s: ya no hay una equivalencia vigente para %s. Agrégala en el ingrediente.', v_ingredient.name, v_unit));
    end if;

    v_alloc := private.allocate_ingredient(p_account_id, v_item.ingredient_id, v_required);

    -- Costo conocido de lo asignado y cantidad sin costo (envases sin costo + faltante).
    select coalesce(sum((c ->> 'cost')::numeric), 0),
           coalesce(sum((c ->> 'take')::numeric) filter (where c ->> 'cost' is null), 0),
           coalesce(bool_or(c ->> 'cost_status' = 'provisional'), false)
      into v_known, v_unknown_qty, v_has_prov
      from jsonb_array_elements(v_alloc -> 'containers') c;
    v_unknown_qty := v_unknown_qty + (v_alloc ->> 'shortage')::numeric;
    if (v_alloc ->> 'shortage')::numeric > 0 then
      v_shortages := true;
    end if;

    v_prov := (select (p ->> 'unit_cost')::numeric from jsonb_array_elements(coalesce(p_provisional, '[]'::jsonb)) p
                where p ->> 'ingredient_id' = v_item.ingredient_id::text limit 1);
    if v_prov is not null and v_prov <= 0 then
      perform private.fail('INVALID_PRICE', format('%s: el costo provisional debe ser mayor que cero.', v_ingredient.name));
    end if;
    if v_unknown_qty > 0 and v_prov is not null then
      v_known := v_known + v_unknown_qty * v_prov;
      v_unknown_qty := 0;
      v_has_prov := true;
    end if;

    v_line_status := case when v_unknown_qty > 0 then 'incomplete' when v_has_prov then 'provisional' else 'complete' end;
    v_ingr_total := v_ingr_total + v_known;

    v_lines := v_lines || jsonb_build_object(
      'line_no', v_item.line_no,
      'ingredient_id', v_item.ingredient_id,
      'ingredient_name', v_ingredient.name,
      'dimension', v_ingredient.dimension,
      'recipe_quantity', v_item.quantity,
      'recipe_unit', v_item.unit,
      'quantity', v_qty,
      'unit', v_unit,
      'adjusted', v_adj is not null,
      'required', v_required,
      'equivalence_id', v_equiv,
      'allocated', (v_alloc ->> 'allocated')::numeric,
      'shortage', (v_alloc ->> 'shortage')::numeric,
      'containers', v_alloc -> 'containers',
      'known_cost', v_known,
      'unknown_quantity', v_unknown_qty,
      'provisional_unit_cost', v_prov,
      'cost_status', v_line_status);
  end loop;

  -- Mano de obra (9.4): por producción o por unidad; si no se registra, el resultado queda incompleto.
  if v_labor_mode is null then
    v_labor_total := null;
    v_warnings := array_append(v_warnings, 'labor_missing');
  else
    v_labor_amount := (p_labor ->> 'amount_clp')::numeric;
    if v_labor_mode not in ('per_batch', 'per_unit') then
      perform private.fail('INVALID_LABOR_MODE', 'Elige si la mano de obra es por producción o por unidad.');
    end if;
    if v_labor_amount is null or v_labor_amount < 0 then
      perform private.fail('INVALID_LABOR_AMOUNT', 'El costo de mano de obra no puede ser negativo.');
    end if;
    v_labor_total := case when v_labor_mode = 'per_unit' then v_labor_amount * v_desired else v_labor_amount end;
  end if;

  -- Embalajes, etiquetas, presentación y otros (ingresados a mano, D-017).
  if p_extras is not null and jsonb_typeof(p_extras) <> 'array' then
    perform private.fail('INVALID_EXTRAS', 'Los costos adicionales no tienen un formato válido.');
  end if;
  for v_extra in select * from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) loop
    if coalesce(v_extra ->> 'kind', '') not in ('packaging', 'label', 'presentation', 'other') then
      perform private.fail('INVALID_EXTRA_KIND', 'El tipo de costo adicional no es válido.');
    end if;
    if nullif(trim(v_extra ->> 'description'), '') is null or char_length(v_extra ->> 'description') > 120 then
      perform private.fail('EXTRA_DESCRIPTION_REQUIRED', 'Describe cada costo adicional (hasta 120 caracteres).');
    end if;
    if (v_extra ->> 'amount_clp')::numeric is null or (v_extra ->> 'amount_clp')::numeric <= 0 then
      perform private.fail('INVALID_EXTRA_AMOUNT', 'Cada costo adicional debe ser mayor que cero.');
    end if;
    v_extras_total := v_extras_total + (v_extra ->> 'amount_clp')::numeric;
    v_extras := v_extras || jsonb_build_object('kind', v_extra ->> 'kind', 'description', trim(v_extra ->> 'description'),
                                               'amount_clp', (v_extra ->> 'amount_clp')::numeric);
  end loop;

  if exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'cost_status' = 'incomplete') then
    v_warnings := array_append(v_warnings, 'unknown_ingredient_cost');
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) l where l ->> 'cost_status' = 'provisional') then
    v_warnings := array_append(v_warnings, 'provisional_cost');
  end if;
  if v_shortages then
    v_warnings := array_append(v_warnings, 'shortage');
  end if;

  v_total := v_ingr_total + coalesce(v_labor_total, 0) + v_extras_total;
  v_status := case
    when 'unknown_ingredient_cost' = any (v_warnings) or 'labor_missing' = any (v_warnings) then 'incomplete'
    when 'provisional_cost' = any (v_warnings) then 'provisional'
    else 'complete' end;

  -- Precio sugerido (D-025): porcentaje o valor fijo sobre el costo.
  if v_method is not null then
    if v_method not in ('percentage', 'fixed') then
      perform private.fail('INVALID_PRICING_METHOD', 'Elige porcentaje o valor fijo para el precio sugerido.');
    end if;
    if v_pvalue is null or v_pvalue < 0 then
      perform private.fail('INVALID_PRICING_VALUE', 'El valor del precio sugerido no puede ser negativo.');
    end if;
    v_price := case when v_method = 'percentage' then v_total * (1 + v_pvalue / 100) else v_total + v_pvalue end;
  end if;

  return jsonb_build_object(
    'recipe_id', v_recipe.id,
    'recipe_name', v_recipe.name,
    'version_id', v_version.id,
    'version_label', v_version.label,
    'yield_quantity', v_version.yield_quantity,
    'yield_unit', v_version.yield_unit,
    'desired_yield', v_desired,
    'scale_factor', v_factor,
    'lines', v_lines,
    'ingredients_cost', v_ingr_total,
    'labor', case when v_labor_mode is null then null
                  else jsonb_build_object('mode', v_labor_mode, 'amount_clp', v_labor_amount, 'total', v_labor_total) end,
    'extras', v_extras,
    'extras_cost', v_extras_total,
    'total_cost', v_total,
    'unit_cost', v_total / v_desired,
    'cost_status', v_status,
    'warnings', to_jsonb(v_warnings),
    'has_shortages', v_shortages,
    'pricing', case when v_method is null then null
                    else jsonb_build_object('method', v_method, 'value', v_pvalue, 'price', v_price,
                                            'unit_price', v_price / v_desired) end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Simulaciones guardadas (foto inmutable de la estimación)
-- -----------------------------------------------------------------------------

create table public.simulations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id),
  recipe_id       uuid not null,
  version_id      uuid not null,
  desired_yield   numeric not null check (desired_yield > 0),
  total_cost      numeric not null check (total_cost >= 0),
  cost_status     text not null check (cost_status in ('complete', 'provisional', 'incomplete')),
  has_shortages   boolean not null,
  -- Parámetros con que se calculó (para repetirla) y resultado completo.
  parameters      jsonb not null,
  result          jsonb not null,
  notes           text check (notes is null or char_length(notes) <= 1000),
  created_at      timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, recipe_id) references public.recipes (account_id, id),
  foreign key (account_id, version_id, recipe_id) references public.recipe_versions (account_id, id, recipe_id)
);

create index simulations_account_created_idx on public.simulations (account_id, created_at desc);

create trigger simulations_enforce_account
  before insert or update on public.simulations
  for each row execute function private.enforce_account_id();

create trigger simulations_immutable
  before update or delete on public.simulations
  for each row execute function private.forbid_mutation();

alter table public.simulations enable row level security;
revoke all on table public.simulations from anon, authenticated;
grant select on table public.simulations to authenticated;
create policy simulations_select_own on public.simulations
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- RPC
-- -----------------------------------------------------------------------------

create function public.estimate_production(
  p_version_id     uuid,
  p_desired_yield  numeric default null,
  p_adjustments    jsonb default '[]'::jsonb,
  p_provisional    jsonb default '[]'::jsonb,
  p_labor          jsonb default null,
  p_extras         jsonb default '[]'::jsonb,
  p_pricing        jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.compute_estimate(private.require_account_id(), p_version_id, p_desired_yield, p_adjustments,
    p_provisional, p_labor, p_extras, p_pricing);
end;
$$;

create function public.save_simulation(
  p_idempotency_key uuid,
  p_version_id      uuid,
  p_desired_yield   numeric default null,
  p_adjustments     jsonb default '[]'::jsonb,
  p_provisional     jsonb default '[]'::jsonb,
  p_labor           jsonb default null,
  p_extras          jsonb default '[]'::jsonb,
  p_pricing         jsonb default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account    uuid := private.require_account_id();
  v_notes      text := nullif(trim(p_notes), '');
  v_parameters jsonb := jsonb_build_object(
    'version_id', p_version_id, 'desired_yield', p_desired_yield, 'adjustments', coalesce(p_adjustments, '[]'::jsonb),
    'provisional', coalesce(p_provisional, '[]'::jsonb), 'labor', p_labor, 'extras', coalesce(p_extras, '[]'::jsonb),
    'pricing', p_pricing);
  v_previous   jsonb;
  v_result     jsonb;
  v_row        public.simulations;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'save_simulation', v_parameters || jsonb_build_object('notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    perform private.fail('NOTES_TOO_LONG', 'Las notas pueden tener hasta 1.000 caracteres.');
  end if;

  v_result := private.compute_estimate(v_account, p_version_id, p_desired_yield, p_adjustments, p_provisional,
    p_labor, p_extras, p_pricing);

  insert into public.simulations (account_id, recipe_id, version_id, desired_yield, total_cost, cost_status,
                                  has_shortages, parameters, result, notes)
  values (v_account, (v_result ->> 'recipe_id')::uuid, p_version_id, (v_result ->> 'desired_yield')::numeric,
          (v_result ->> 'total_cost')::numeric, v_result ->> 'cost_status', (v_result ->> 'has_shortages')::boolean,
          v_parameters, v_result, v_notes)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'simulation.saved', 'simulation', v_row.id,
    jsonb_build_object('version_id', p_version_id, 'total_cost', v_row.total_cost, 'cost_status', v_row.cost_status));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at));
end;
$$;

revoke execute on function public.estimate_production(uuid, numeric, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.save_simulation(uuid, uuid, numeric, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.estimate_production(uuid, numeric, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_simulation(uuid, uuid, numeric, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
