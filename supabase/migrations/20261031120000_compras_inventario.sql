-- =============================================================================
-- Etapa 3.2 · Compras e inventario por envase (D-021)
--
--   * Cada envase físico es un registro (containers) con su compra de origen, costo, cantidad
--     inicial y saldo. El saldo es siempre la suma de sus movimientos.
--   * Todo cambio de saldo pasa por private.apply_movement: bloquea el ingrediente y el envase,
--     valida que el saldo no quede negativo, actualiza el saldo e inserta el movimiento.
--   * Movimientos inmutables; las correcciones son movimientos nuevos relacionados.
--   * Aviso cuando un ingrediente se agota (uno abierto a la vez; se cierra al reponer).
--
-- Cantidades de inventario: en la unidad base del ingrediente (g, ml o unidad).
-- Orden de bloqueo para evitar interbloqueos: ingredientes por id, luego envases por id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Compras
-- -----------------------------------------------------------------------------

create table public.purchases (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id),
  purchased_on          date not null,
  reference             text check (reference is null or char_length(reference) <= 120),
  notes                 text check (notes is null or char_length(notes) <= 1000),
  -- Ayuda a detectar diferencias; no bloquea el inventario ya incorporado.
  pending_verification  boolean not null default false,
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (account_id, id)
);

create index purchases_account_date_idx on public.purchases (account_id, purchased_on desc);

create table public.purchase_lines (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts (id),
  purchase_id             uuid not null,
  line_no                 smallint not null check (line_no >= 1),
  ingredient_id           uuid not null,
  brand_id                uuid not null,
  presentation_id         uuid not null,
  container_count         integer not null check (container_count between 1 and 500),
  -- Contenido real de cada envase recibido, en la unidad de la presentación y en unidad base.
  content_per_container   numeric not null check (content_per_container > 0),
  content_unit            text not null references public.units (code),
  base_per_container      numeric not null check (base_per_container > 0),
  incorporated_quantity   numeric not null check (incorporated_quantity > 0),
  list_total_clp          bigint check (list_total_clp is null or list_total_clp > 0),
  paid_total_clp          bigint not null check (paid_total_clp > 0),
  unique (account_id, id),
  unique (purchase_id, line_no),
  foreign key (account_id, purchase_id) references public.purchases (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id),
  foreign key (account_id, presentation_id) references public.presentations (account_id, id),
  foreign key (account_id, brand_id, ingredient_id) references public.brands (account_id, id, ingredient_id)
);

-- Cargos adicionales (transporte, despacho, otros).
create table public.purchase_charges (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id),
  purchase_id      uuid not null,
  charge_no        smallint not null check (charge_no >= 1),
  description      text not null check (char_length(description) between 1 and 120),
  amount_clp       bigint not null check (amount_clp > 0),
  -- separate_expense: gasto separado; distributed: se reparte entre las líneas de la compra.
  treatment        text not null check (treatment in ('separate_expense', 'distributed')),
  method           text check (method in ('by_value', 'by_quantity')),
  -- Para envases consumidos en parte: proporcional al consumo o íntegro en el primer uso.
  partial_rule     text check (partial_rule in ('proportional', 'first_use')),
  unique (account_id, id),
  unique (purchase_id, charge_no),
  foreign key (account_id, purchase_id) references public.purchases (account_id, id),
  check ((treatment = 'distributed') = (method is not null and partial_rule is not null))
);

create table public.purchase_charge_allocations (
  account_id        uuid not null references public.accounts (id),
  charge_id         uuid not null,
  purchase_line_id  uuid not null,
  amount_clp        bigint not null check (amount_clp >= 0),
  primary key (charge_id, purchase_line_id),
  foreign key (account_id, charge_id) references public.purchase_charges (account_id, id),
  foreign key (account_id, purchase_line_id) references public.purchase_lines (account_id, id)
);

-- -----------------------------------------------------------------------------
-- Envases (unidad física de inventario)
-- -----------------------------------------------------------------------------

create table public.containers (
  id                         uuid primary key default gen_random_uuid(),
  account_id                 uuid not null references public.accounts (id),
  ingredient_id              uuid not null,
  brand_id                   uuid not null,
  presentation_id            uuid not null,
  source                     text not null check (source in ('purchase', 'manual_entry')),
  purchase_line_id           uuid,
  received_on                date not null,
  initial_quantity           numeric not null check (initial_quantity > 0),
  balance                    numeric not null default 0 check (balance >= 0),
  -- Costo por unidad base (CLP). NULL = desconocido, nunca 0.
  unit_cost                  numeric check (unit_cost is null or unit_cost > 0),
  cost_status                text not null check (cost_status in ('known', 'provisional', 'unknown')),
  -- Cargos distribuidos: por unidad consumida (regla proporcional) y monto íntegro al primer uso.
  charge_unit_cost           numeric not null default 0 check (charge_unit_cost >= 0),
  charge_first_use_clp       numeric not null default 0 check (charge_first_use_clp >= 0),
  -- Un envase abierto se prioriza al consumir (3.5). Se marca al primer descuento o al ingresarlo abierto.
  opened_at                  timestamptz,
  created_at                 timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id),
  foreign key (account_id, presentation_id) references public.presentations (account_id, id),
  foreign key (account_id, brand_id, ingredient_id) references public.brands (account_id, id, ingredient_id),
  foreign key (account_id, purchase_line_id) references public.purchase_lines (account_id, id),
  check ((source = 'purchase') = (purchase_line_id is not null)),
  check ((cost_status = 'unknown') = (unit_cost is null))
);

create index containers_ingredient_idx on public.containers (account_id, ingredient_id, received_on, created_at);

-- -----------------------------------------------------------------------------
-- Movimientos de inventario (inmutables)
-- -----------------------------------------------------------------------------

create table public.inventory_movements (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id),
  container_id          uuid not null,
  ingredient_id         uuid not null,
  kind                  text not null check (kind in (
                          'purchase', 'manual_entry', 'adjustment', 'waste', 'supplier_return',
                          'receipt_correction', 'reversal', 'production_consumption')),
  quantity              numeric not null check (quantity <> 0),
  balance_before        numeric not null check (balance_before >= 0),
  balance_after         numeric not null check (balance_after >= 0),
  reason                text check (reason is null or char_length(reason) <= 300),
  reference             text check (reference is null or char_length(reference) <= 120),
  -- Agrupa los movimientos de una misma operación (compra, conteo, etc.).
  operation_type        text not null,
  operation_id          uuid not null,
  reverses_movement_id  uuid,
  created_at            timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, container_id) references public.containers (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id),
  foreign key (account_id, reverses_movement_id) references public.inventory_movements (account_id, id),
  check (balance_after = balance_before + quantity),
  check ((kind = 'reversal') = (reverses_movement_id is not null))
);

-- Un movimiento se revierte una sola vez.
create unique index inventory_movements_reversal_uq on public.inventory_movements (reverses_movement_id)
  where reverses_movement_id is not null;
create index inventory_movements_container_idx on public.inventory_movements (account_id, container_id, created_at);
create index inventory_movements_ingredient_idx on public.inventory_movements (account_id, ingredient_id, created_at);

-- -----------------------------------------------------------------------------
-- Conteo físico
-- -----------------------------------------------------------------------------

create table public.inventory_counts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id),
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  unique (account_id, id)
);

create table public.inventory_count_lines (
  account_id        uuid not null references public.accounts (id),
  count_id          uuid not null,
  container_id      uuid not null,
  system_balance    numeric not null check (system_balance >= 0),
  counted_quantity  numeric not null check (counted_quantity >= 0),
  -- NULL si el conteo coincidió con el sistema.
  movement_id       uuid,
  primary key (count_id, container_id),
  foreign key (account_id, count_id) references public.inventory_counts (account_id, id),
  foreign key (account_id, container_id) references public.containers (account_id, id),
  foreign key (account_id, movement_id) references public.inventory_movements (account_id, id)
);

-- -----------------------------------------------------------------------------
-- Avisos de ingrediente agotado
-- -----------------------------------------------------------------------------

create table public.stock_alerts (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id),
  ingredient_id  uuid not null,
  opened_at      timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id)
);

create unique index stock_alerts_open_uq on public.stock_alerts (account_id, ingredient_id) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Aislamiento, permisos y RLS
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['purchases', 'purchase_lines', 'purchase_charges', 'purchase_charge_allocations',
                           'containers', 'inventory_movements', 'inventory_counts', 'inventory_count_lines',
                           'stock_alerts']
  loop
    execute format('create trigger %I before insert or update on public.%I
                      for each row execute function private.enforce_account_id()', t || '_enforce_account', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using (account_id = (select private.current_account_id()))', t || '_select_own', t);
  end loop;
end;
$$;

-- Registros históricos que nunca cambian.
do $$
declare
  t text;
begin
  foreach t in array array['purchase_lines', 'purchase_charges', 'purchase_charge_allocations',
                           'inventory_movements', 'inventory_counts', 'inventory_count_lines']
  loop
    execute format('create trigger %I before update or delete on public.%I
                      for each row execute function private.forbid_mutation()', t || '_immutable', t);
  end loop;
end;
$$;

-- Compras: solo cambia la verificación.
create function private.guard_purchase_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - 'verified_at' - 'pending_verification') <> (to_jsonb(old) - 'verified_at' - 'pending_verification') then
    perform private.fail('IMMUTABLE_RECORD',
      'Una compra confirmada no se modifica. Registra una corrección o devolución.');
  end if;
  return new;
end;
$$;

create trigger purchases_guard
  before update or delete on public.purchases
  for each row execute function private.guard_purchase_change();

-- Envases: solo cambian el saldo y la marca de apertura, y únicamente desde apply_movement.
create function private.guard_container_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - 'balance' - 'opened_at') <> (to_jsonb(old) - 'balance' - 'opened_at') then
    perform private.fail('IMMUTABLE_RECORD', 'Los datos de un envase no se modifican. Registra un movimiento.');
  end if;
  if coalesce(current_setting('app.inventory_movement', true), '') <> 'on' then
    perform private.fail('BALANCE_DIRECT_UPDATE', 'El saldo de un envase solo cambia mediante un movimiento de inventario.');
  end if;
  return new;
end;
$$;

create trigger containers_guard
  before update or delete on public.containers
  for each row execute function private.guard_container_change();

-- Disponible por ingrediente (suma de saldos). security_invoker: aplica la RLS de quien consulta.
create view public.ingredient_stock with (security_invoker = true) as
select
  i.account_id,
  i.id as ingredient_id,
  coalesce(sum(c.balance), 0) as available,
  count(c.id) filter (where c.balance > 0) as containers_with_stock,
  count(c.id) filter (where c.balance > 0 and c.opened_at is not null) as open_containers
from public.ingredients i
left join public.containers c on c.account_id = i.account_id and c.ingredient_id = i.id
group by i.account_id, i.id;

revoke all on public.ingredient_stock from anon, authenticated;
grant select on public.ingredient_stock to authenticated;

-- -----------------------------------------------------------------------------
-- Núcleo: un movimiento de inventario
-- -----------------------------------------------------------------------------

create function private.refresh_stock_alert(p_account_id uuid, p_ingredient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric;
begin
  select coalesce(sum(balance), 0) into v_total
    from public.containers
   where account_id = p_account_id and ingredient_id = p_ingredient_id;

  if v_total = 0 then
    insert into public.stock_alerts (account_id, ingredient_id)
    values (p_account_id, p_ingredient_id)
    on conflict (account_id, ingredient_id) where resolved_at is null do nothing;
  else
    update public.stock_alerts
       set resolved_at = now()
     where account_id = p_account_id and ingredient_id = p_ingredient_id and resolved_at is null;
  end if;
end;
$$;

-- Bloquea los ingredientes indicados en orden de id (primer paso de toda operación de inventario).
create function private.lock_ingredients(p_account_id uuid, p_ingredient_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select null from (
    select id from public.ingredients
     where account_id = p_account_id and id = any (p_ingredient_ids)
     order by id
     for update
  ) locked;
$$;

create function private.apply_movement(
  p_account_id        uuid,
  p_container_id      uuid,
  p_delta             numeric,
  p_kind              text,
  p_operation_type    text,
  p_operation_id      uuid,
  p_reason            text default null,
  p_reference         text default null,
  p_reverses          uuid default null,
  p_expected_balance  numeric default null
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_container public.containers;
  v_new       numeric;
  v_movement  public.inventory_movements;
begin
  select * into v_container from public.containers
   where account_id = p_account_id and id = p_container_id;
  if v_container.id is null then
    perform private.fail('CONTAINER_NOT_FOUND', 'El envase no existe.');
  end if;

  -- Ingrediente primero, envase después: mismo orden en todas las operaciones.
  perform private.lock_ingredients(p_account_id, array[v_container.ingredient_id]);
  select * into v_container from public.containers
   where account_id = p_account_id and id = p_container_id
   for update;

  if p_expected_balance is not null and v_container.balance <> p_expected_balance then
    perform private.fail('STALE_BALANCE',
      'El saldo del envase cambió mientras revisabas. Actualiza la pantalla y vuelve a revisar la cantidad.');
  end if;
  if p_delta is null or p_delta = 0 then
    perform private.fail('NO_CHANGE', 'La cantidad del movimiento debe ser distinta de cero.');
  end if;

  v_new := v_container.balance + p_delta;
  if v_new < 0 then
    perform private.fail('INSUFFICIENT_STOCK',
      format('El envase solo tiene %s disponible; el movimiento dejaría el saldo negativo.', v_container.balance));
  end if;

  perform set_config('app.inventory_movement', 'on', true);
  update public.containers
     set balance = v_new,
         opened_at = case when p_delta < 0 and opened_at is null then now() else opened_at end
   where account_id = p_account_id and id = p_container_id;
  perform set_config('app.inventory_movement', 'off', true);

  insert into public.inventory_movements (
    account_id, container_id, ingredient_id, kind, quantity, balance_before, balance_after,
    reason, reference, operation_type, operation_id, reverses_movement_id)
  values (
    p_account_id, p_container_id, v_container.ingredient_id, p_kind, p_delta, v_container.balance, v_new,
    nullif(trim(p_reason), ''), nullif(trim(p_reference), ''), p_operation_type, p_operation_id, p_reverses)
  returning * into v_movement;

  perform private.refresh_stock_alert(p_account_id, v_container.ingredient_id);
  return v_movement;
end;
$$;

-- Envases cuyo saldo no coincide con la suma de sus movimientos (debe estar siempre vacío).
create function private.reconcile_inventory(p_account_id uuid)
returns table (container_id uuid, balance numeric, movements_total numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.balance, coalesce(sum(m.quantity), 0)
    from public.containers c
    left join public.inventory_movements m on m.account_id = c.account_id and m.container_id = c.id
   where c.account_id = p_account_id
   group by c.id, c.balance
  having c.balance <> coalesce(sum(m.quantity), 0);
$$;

-- -----------------------------------------------------------------------------
-- Cálculo de una compra (compartido por la vista previa y la confirmación)
-- -----------------------------------------------------------------------------

-- Reparte un importe entero según pesos, sin perder ni duplicar pesos (método del mayor resto;
-- empates a favor de la primera línea).
create function private.distribute_amount(p_amount bigint, p_weights numeric[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total    numeric;
  v_shares   bigint[] := '{}';
  v_rest     numeric[] := '{}';
  v_assigned bigint := 0;
  v_exact    numeric;
  v_idx      integer;
begin
  select sum(w) into v_total from unnest(p_weights) w;
  if v_total is null or v_total <= 0 then
    perform private.fail('INVALID_DISTRIBUTION_BASE', 'No hay una base válida para distribuir el cargo.');
  end if;
  for i in 1 .. coalesce(array_length(p_weights, 1), 0) loop
    v_exact := p_amount * p_weights[i] / v_total;
    v_shares[i] := floor(v_exact);
    v_rest[i] := v_exact - floor(v_exact);
    v_assigned := v_assigned + v_shares[i];
  end loop;
  for v_idx in
    select k from unnest(v_rest) with ordinality as r(rest, k) order by rest desc, k limit (p_amount - v_assigned)
  loop
    v_shares[v_idx] := v_shares[v_idx] + 1;
  end loop;
  return v_shares;
end;
$$;

-- Valida y calcula una compra sin escribir nada.
-- p_lines:   [{presentation_id, container_count, content_per_container?, list_total_clp?, paid_total_clp}]
--            content_per_container en la unidad de la presentación (por defecto, su contenido).
-- p_charges: [{description, amount_clp, treatment, method?, partial_rule?}]
create function private.compute_purchase(p_account_id uuid, p_lines jsonb, p_charges jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line        jsonb;
  v_charge      jsonb;
  v_pres        record;
  v_lines       jsonb := '[]'::jsonb;
  v_charges     jsonb := '[]'::jsonb;
  v_count       integer;
  v_content     numeric;
  v_base        numeric;
  v_paid        bigint;
  v_list        bigint;
  v_value_w     numeric[] := '{}';
  v_qty_w       numeric[] := '{}';
  v_dimensions  text[] := '{}';
  v_alloc       bigint[];
  v_amount      bigint;
  v_treatment   text;
  v_method      text;
  v_rule        text;
  v_desc        text;
  v_n           integer;
  v_prop        numeric[];
  v_first       numeric[];
  v_paid_total  bigint := 0;
  v_dist_total  bigint := 0;
  v_sep_total   bigint := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.fail('PURCHASE_LINES_REQUIRED', 'Agrega al menos un producto a la compra.');
  end if;
  if jsonb_array_length(p_lines) > 100 then
    perform private.fail('TOO_MANY_LINES', 'Una compra puede tener hasta 100 productos.');
  end if;
  if p_charges is not null and jsonb_typeof(p_charges) <> 'array' then
    perform private.fail('INVALID_CHARGES', 'Los cargos adicionales no tienen un formato válido.');
  end if;
  if coalesce(jsonb_array_length(p_charges), 0) > 20 then
    perform private.fail('TOO_MANY_CHARGES', 'Una compra puede tener hasta 20 cargos adicionales.');
  end if;

  v_n := jsonb_array_length(p_lines);
  v_prop := array_fill(0::numeric, array[v_n]);
  v_first := array_fill(0::numeric, array[v_n]);

  for i in 0 .. v_n - 1 loop
    v_line := p_lines -> i;
    select p.*, b.name as brand_name, b.archived_at as brand_archived, i2.name as ingredient_name,
           i2.dimension, i2.archived_at as ingredient_archived, u.to_base
      into v_pres
      from public.presentations p
      join public.brands b on b.account_id = p.account_id and b.id = p.brand_id
      join public.ingredients i2 on i2.account_id = p.account_id and i2.id = p.ingredient_id
      join public.units u on u.code = p.unit
     where p.account_id = p_account_id and p.id = (v_line ->> 'presentation_id')::uuid;
    if v_pres.id is null then
      perform private.fail('PRESENTATION_NOT_FOUND', format('Producto %s: la presentación no existe.', i + 1));
    end if;
    if v_pres.archived_at is not null or v_pres.brand_archived is not null or v_pres.ingredient_archived is not null then
      perform private.fail('CATALOG_ARCHIVED',
        format('Producto %s: %s %s está archivado. Restáuralo para comprarlo.', i + 1, v_pres.ingredient_name, v_pres.brand_name));
    end if;

    v_count := (v_line ->> 'container_count')::integer;
    if v_count is null or v_count < 1 or v_count > 500 then
      perform private.fail('INVALID_CONTAINER_COUNT', format('Producto %s: indica entre 1 y 500 envases.', i + 1));
    end if;
    v_content := coalesce((v_line ->> 'content_per_container')::numeric, v_pres.quantity);
    if v_content <= 0 then
      perform private.fail('INVALID_QUANTITY', format('Producto %s: el contenido por envase debe ser mayor que cero.', i + 1));
    end if;
    v_paid := (v_line ->> 'paid_total_clp')::bigint;
    if v_paid is null or v_paid <= 0 then
      perform private.fail('INVALID_PRICE',
        format('Producto %s: indica el total pagado (mayor que cero). Para inventario sin costo usa una entrada manual.', i + 1));
    end if;
    v_list := (v_line ->> 'list_total_clp')::bigint;
    if v_list is not null and v_list <= 0 then
      perform private.fail('INVALID_PRICE', format('Producto %s: el precio de lista debe ser mayor que cero.', i + 1));
    end if;

    v_base := v_content * v_pres.to_base;
    v_value_w := v_value_w || v_paid::numeric;
    v_qty_w := v_qty_w || (v_base * v_count);
    v_dimensions := v_dimensions || v_pres.dimension;
    v_paid_total := v_paid_total + v_paid;

    v_lines := v_lines || jsonb_build_object(
      'line_no', i + 1,
      'presentation_id', v_pres.id,
      'ingredient_id', v_pres.ingredient_id,
      'brand_id', v_pres.brand_id,
      'ingredient_name', v_pres.ingredient_name,
      'brand_name', v_pres.brand_name,
      'container_count', v_count,
      'content_per_container', v_content,
      'content_unit', v_pres.unit,
      'base_per_container', v_base,
      'incorporated_quantity', v_base * v_count,
      'list_total_clp', v_list,
      'paid_total_clp', v_paid,
      'unit_cost', v_paid / (v_base * v_count));
  end loop;

  for j in 0 .. coalesce(jsonb_array_length(p_charges), 0) - 1 loop
    v_charge := p_charges -> j;
    v_desc := nullif(trim(v_charge ->> 'description'), '');
    v_amount := (v_charge ->> 'amount_clp')::bigint;
    v_treatment := v_charge ->> 'treatment';
    v_method := v_charge ->> 'method';
    v_rule := v_charge ->> 'partial_rule';
    if v_desc is null or char_length(v_desc) > 120 then
      perform private.fail('CHARGE_DESCRIPTION_REQUIRED', format('Cargo %s: describe el cargo (hasta 120 caracteres).', j + 1));
    end if;
    if v_amount is null or v_amount <= 0 then
      perform private.fail('INVALID_CHARGE_AMOUNT', format('Cargo %s: el monto debe ser mayor que cero.', j + 1));
    end if;
    if v_treatment is null or v_treatment not in ('separate_expense', 'distributed') then
      perform private.fail('INVALID_CHARGE_TREATMENT', format('Cargo %s: elige si es gasto separado o se distribuye.', j + 1));
    end if;

    if v_treatment = 'separate_expense' then
      v_alloc := null;
      v_method := null;
      v_rule := null;
      v_sep_total := v_sep_total + v_amount;
    else
      if v_method is null or v_method not in ('by_value', 'by_quantity') then
        perform private.fail('INVALID_DISTRIBUTION_CRITERION', format('Cargo %s: elige cómo distribuirlo.', j + 1));
      end if;
      if v_rule is null or v_rule not in ('proportional', 'first_use') then
        perform private.fail('INVALID_PARTIAL_RULE',
          format('Cargo %s: elige cómo se carga en envases usados en parte.', j + 1));
      end if;
      if v_method = 'by_quantity' and (select count(distinct d) from unnest(v_dimensions) d) > 1 then
        perform private.fail('CHARGE_QUANTITY_NOT_COMPARABLE',
          format('Cargo %s: los productos se miden en unidades distintas (peso, volumen, unidades); distribúyelo por valor.', j + 1));
      end if;
      v_alloc := private.distribute_amount(v_amount, case when v_method = 'by_value' then v_value_w else v_qty_w end);
      v_dist_total := v_dist_total + v_amount;
      for i in 1 .. v_n loop
        if v_rule = 'proportional' then
          v_prop[i] := v_prop[i] + v_alloc[i] / ((v_lines -> (i - 1) ->> 'incorporated_quantity')::numeric);
        else
          v_first[i] := v_first[i] + v_alloc[i]::numeric / ((v_lines -> (i - 1) ->> 'container_count')::integer);
        end if;
      end loop;
    end if;

    v_charges := v_charges || jsonb_build_object(
      'charge_no', j + 1, 'description', v_desc, 'amount_clp', v_amount, 'treatment', v_treatment,
      'method', v_method, 'partial_rule', v_rule, 'allocations', to_jsonb(v_alloc));
  end loop;

  for i in 1 .. v_n loop
    v_lines := jsonb_set(v_lines, array[(i - 1)::text, 'charge_unit_cost'], to_jsonb(v_prop[i]));
    v_lines := jsonb_set(v_lines, array[(i - 1)::text, 'charge_first_use_clp'], to_jsonb(v_first[i]));
  end loop;

  return jsonb_build_object(
    'lines', v_lines,
    'charges', v_charges,
    'paid_total_clp', v_paid_total,
    'distributed_charges_clp', v_dist_total,
    'separate_charges_clp', v_sep_total);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: compras
-- -----------------------------------------------------------------------------

create function public.preview_purchase(p_lines jsonb, p_charges jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.compute_purchase(private.require_account_id(), p_lines, coalesce(p_charges, '[]'::jsonb));
end;
$$;

create function public.confirm_purchase(
  p_idempotency_key       uuid,
  p_purchased_on          date,
  p_lines                 jsonb,
  p_charges               jsonb default '[]'::jsonb,
  p_reference             text default null,
  p_pending_verification  boolean default false,
  p_notes                 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account    uuid := private.require_account_id();
  v_reference  text := nullif(trim(p_reference), '');
  v_notes      text := nullif(trim(p_notes), '');
  v_today      date;
  v_previous   jsonb;
  v_calc       jsonb;
  v_line       jsonb;
  v_charge     jsonb;
  v_purchase   public.purchases;
  v_line_ids   uuid[] := '{}';
  v_line_id    uuid;
  v_charge_id  uuid;
  v_container  uuid;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'confirm_purchase', jsonb_build_object(
    'purchased_on', p_purchased_on, 'lines', p_lines, 'charges', coalesce(p_charges, '[]'::jsonb),
    'reference', v_reference, 'pending_verification', coalesce(p_pending_verification, false), 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  select (now() at time zone timezone)::date into v_today from public.accounts where id = v_account;
  if p_purchased_on is null or p_purchased_on > v_today then
    perform private.fail('INVALID_PURCHASE_DATE', 'Indica la fecha de la compra; no puede ser posterior a hoy.');
  end if;
  if v_reference is not null and char_length(v_reference) > 120 then
    perform private.fail('REFERENCE_TOO_LONG', 'La referencia puede tener hasta 120 caracteres.');
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    perform private.fail('NOTES_TOO_LONG', 'Las notas pueden tener hasta 1.000 caracteres.');
  end if;

  v_calc := private.compute_purchase(v_account, p_lines, coalesce(p_charges, '[]'::jsonb));

  perform private.lock_ingredients(v_account,
    array(select (l ->> 'ingredient_id')::uuid from jsonb_array_elements(v_calc -> 'lines') l));

  insert into public.purchases (account_id, purchased_on, reference, notes, pending_verification)
  values (v_account, p_purchased_on, v_reference, v_notes, coalesce(p_pending_verification, false))
  returning * into v_purchase;

  for v_line in select * from jsonb_array_elements(v_calc -> 'lines') loop
    insert into public.purchase_lines (
      account_id, purchase_id, line_no, ingredient_id, brand_id, presentation_id, container_count,
      content_per_container, content_unit, base_per_container, incorporated_quantity, list_total_clp, paid_total_clp)
    values (
      v_account, v_purchase.id, (v_line ->> 'line_no')::smallint, (v_line ->> 'ingredient_id')::uuid,
      (v_line ->> 'brand_id')::uuid, (v_line ->> 'presentation_id')::uuid, (v_line ->> 'container_count')::integer,
      (v_line ->> 'content_per_container')::numeric, v_line ->> 'content_unit', (v_line ->> 'base_per_container')::numeric,
      (v_line ->> 'incorporated_quantity')::numeric, (v_line ->> 'list_total_clp')::bigint, (v_line ->> 'paid_total_clp')::bigint)
    returning id into v_line_id;
    v_line_ids := v_line_ids || v_line_id;

    for k in 1 .. (v_line ->> 'container_count')::integer loop
      insert into public.containers (
        account_id, ingredient_id, brand_id, presentation_id, source, purchase_line_id, received_on,
        initial_quantity, unit_cost, cost_status, charge_unit_cost, charge_first_use_clp)
      values (
        v_account, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'brand_id')::uuid,
        (v_line ->> 'presentation_id')::uuid, 'purchase', v_line_id, p_purchased_on,
        (v_line ->> 'base_per_container')::numeric, (v_line ->> 'unit_cost')::numeric, 'known',
        (v_line ->> 'charge_unit_cost')::numeric, (v_line ->> 'charge_first_use_clp')::numeric)
      returning id into v_container;
      perform private.apply_movement(v_account, v_container, (v_line ->> 'base_per_container')::numeric,
        'purchase', 'purchase', v_purchase.id, null, v_reference);
    end loop;
  end loop;

  for v_charge in select * from jsonb_array_elements(v_calc -> 'charges') loop
    insert into public.purchase_charges (account_id, purchase_id, charge_no, description, amount_clp, treatment,
                                         method, partial_rule)
    values (v_account, v_purchase.id, (v_charge ->> 'charge_no')::smallint, v_charge ->> 'description',
            (v_charge ->> 'amount_clp')::bigint, v_charge ->> 'treatment', v_charge ->> 'method', v_charge ->> 'partial_rule')
    returning id into v_charge_id;
    if v_charge ->> 'treatment' = 'distributed' then
      for i in 1 .. array_length(v_line_ids, 1) loop
        insert into public.purchase_charge_allocations (account_id, charge_id, purchase_line_id, amount_clp)
        values (v_account, v_charge_id, v_line_ids[i], (v_charge -> 'allocations' ->> (i - 1))::bigint);
      end loop;
    end if;
  end loop;

  perform private.audit(v_account, 'owner', 'purchase.confirmed', 'purchase', v_purchase.id,
    jsonb_build_object('paid_total_clp', v_calc -> 'paid_total_clp', 'lines', jsonb_array_length(v_calc -> 'lines')));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_purchase));
end;
$$;

create function public.set_purchase_verified(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_row     public.purchases;
begin
  update public.purchases
     set verified_at = coalesce(verified_at, now())
   where account_id = v_account and id = p_purchase_id
  returning * into v_row;
  if v_row.id is null then
    perform private.fail('PURCHASE_NOT_FOUND', 'La compra no existe.');
  end if;
  perform private.audit(v_account, 'owner', 'purchase.verified', 'purchase', p_purchase_id);
  return to_jsonb(v_row);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: entrada manual (inventario existente, regalos, etc.; no es una compra)
-- -----------------------------------------------------------------------------

create function public.register_manual_entry(
  p_idempotency_key        uuid,
  p_presentation_id        uuid,
  p_container_count        integer,
  p_quantity_per_container numeric,
  p_received_on            date,
  p_total_cost_clp         bigint default null,
  p_cost_is_provisional    boolean default false,
  p_opened                 boolean default false,
  p_reason                 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account    uuid := private.require_account_id();
  v_previous   jsonb;
  v_pres       record;
  v_base       numeric;
  v_today      date;
  v_operation  uuid := gen_random_uuid();
  v_container  uuid;
  v_ids        uuid[] := '{}';
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'register_manual_entry', jsonb_build_object(
    'presentation_id', p_presentation_id, 'container_count', p_container_count,
    'quantity_per_container', p_quantity_per_container, 'received_on', p_received_on,
    'total_cost_clp', p_total_cost_clp, 'cost_is_provisional', p_cost_is_provisional, 'opened', p_opened,
    'reason', p_reason));
  if v_previous is not null then
    return v_previous;
  end if;

  select p.*, b.archived_at as brand_archived, i.archived_at as ingredient_archived, u.to_base into v_pres
    from public.presentations p
    join public.brands b on b.account_id = p.account_id and b.id = p.brand_id
    join public.ingredients i on i.account_id = p.account_id and i.id = p.ingredient_id
    join public.units u on u.code = p.unit
   where p.account_id = v_account and p.id = p_presentation_id;
  if v_pres.id is null then
    perform private.fail('PRESENTATION_NOT_FOUND', 'La presentación no existe.');
  end if;
  if v_pres.archived_at is not null or v_pres.brand_archived is not null or v_pres.ingredient_archived is not null then
    perform private.fail('CATALOG_ARCHIVED', 'La presentación, su marca o su ingrediente están archivados.');
  end if;
  if p_container_count is null or p_container_count < 1 or p_container_count > 500 then
    perform private.fail('INVALID_CONTAINER_COUNT', 'Indica entre 1 y 500 envases.');
  end if;
  if p_quantity_per_container is null or p_quantity_per_container <= 0 then
    perform private.fail('INVALID_QUANTITY', 'La cantidad por envase debe ser mayor que cero.');
  end if;
  select (now() at time zone timezone)::date into v_today from public.accounts where id = v_account;
  if p_received_on is null or p_received_on > v_today then
    perform private.fail('INVALID_DATE', 'Indica la fecha; no puede ser posterior a hoy.');
  end if;
  if p_total_cost_clp is not null and p_total_cost_clp <= 0 then
    perform private.fail('INVALID_PRICE', 'El costo debe ser mayor que cero. Si no lo conoces, déjalo vacío.');
  end if;

  -- La cantidad se indica en la unidad de la presentación.
  v_base := p_quantity_per_container * v_pres.to_base;
  perform private.lock_ingredients(v_account, array[v_pres.ingredient_id]);

  for k in 1 .. p_container_count loop
    insert into public.containers (
      account_id, ingredient_id, brand_id, presentation_id, source, received_on, initial_quantity,
      unit_cost, cost_status, opened_at)
    values (
      v_account, v_pres.ingredient_id, v_pres.brand_id, v_pres.id, 'manual_entry', p_received_on, v_base,
      case when p_total_cost_clp is not null then p_total_cost_clp::numeric / (v_base * p_container_count) end,
      case when p_total_cost_clp is null then 'unknown'
           when coalesce(p_cost_is_provisional, false) then 'provisional' else 'known' end,
      case when coalesce(p_opened, false) then now() end)
    returning id into v_container;
    perform private.apply_movement(v_account, v_container, v_base, 'manual_entry', 'manual_entry', v_operation, p_reason);
    v_ids := v_ids || v_container;
  end loop;

  perform private.audit(v_account, 'owner', 'inventory.manual_entry', 'presentation', p_presentation_id,
    jsonb_build_object('containers', p_container_count, 'quantity_per_container', v_base, 'total_cost_clp', p_total_cost_clp));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key,
    jsonb_build_object('operation_id', v_operation, 'container_ids', to_jsonb(v_ids)));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: movimientos sobre un envase (cantidades en unidad base del ingrediente)
-- -----------------------------------------------------------------------------

create function public.register_container_movement(
  p_idempotency_key  uuid,
  p_container_id     uuid,
  p_kind             text,
  p_quantity         numeric,
  p_reason           text default null,
  p_reference        text default null,
  p_expected_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_previous jsonb;
  v_current  numeric;
  v_delta    numeric;
  v_move     public.inventory_movements;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'register_container_movement', jsonb_build_object(
    'container_id', p_container_id, 'kind', p_kind, 'quantity', p_quantity, 'reason', p_reason,
    'reference', p_reference, 'expected_balance', p_expected_balance));
  if v_previous is not null then
    return v_previous;
  end if;

  if p_reason is not null and char_length(p_reason) > 300 then
    perform private.fail('REASON_TOO_LONG', 'El motivo puede tener hasta 300 caracteres.');
  end if;

  select balance into v_current from public.containers where account_id = v_account and id = p_container_id;
  if v_current is null then
    perform private.fail('CONTAINER_NOT_FOUND', 'El envase no existe.');
  end if;

  case p_kind
    -- Ajuste: p_quantity es el saldo correcto; se registra la diferencia.
    when 'adjustment' then
      if p_quantity is null or p_quantity < 0 then
        perform private.fail('INVALID_QUANTITY', 'El saldo corregido no puede ser negativo.');
      end if;
      if p_expected_balance is null then
        perform private.fail('EXPECTED_BALANCE_REQUIRED', 'Falta el saldo que estabas viendo. Actualiza la pantalla.');
      end if;
      v_delta := p_quantity - p_expected_balance;
    -- Merma y devolución a proveedor: p_quantity es lo que sale.
    when 'waste', 'supplier_return' then
      if p_quantity is null or p_quantity <= 0 then
        perform private.fail('INVALID_QUANTITY', 'La cantidad debe ser mayor que cero.');
      end if;
      v_delta := -p_quantity;
    -- Corrección de recepción: diferencia con signo entre lo registrado y lo recibido.
    when 'receipt_correction' then
      if p_quantity is null or p_quantity = 0 then
        perform private.fail('INVALID_QUANTITY', 'Indica la diferencia (positiva si llegó más, negativa si llegó menos).');
      end if;
      if not exists (select 1 from public.containers where account_id = v_account and id = p_container_id and source = 'purchase') then
        perform private.fail('NOT_A_PURCHASE', 'Solo los envases de una compra tienen una recepción que corregir.');
      end if;
      v_delta := p_quantity;
    else
      perform private.fail('INVALID_MOVEMENT_KIND', 'El tipo de movimiento no es válido.');
  end case;

  v_move := private.apply_movement(v_account, p_container_id, v_delta, p_kind, p_kind, p_idempotency_key,
    p_reason, p_reference, null, p_expected_balance);

  perform private.audit(v_account, 'owner', 'inventory.' || p_kind, 'container', p_container_id, to_jsonb(v_move));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_move));
end;
$$;

-- Revierte un ajuste, merma, devolución o corrección con un movimiento opuesto vinculado.
create function public.reverse_movement(p_idempotency_key uuid, p_movement_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_previous jsonb;
  v_original public.inventory_movements;
  v_move     public.inventory_movements;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'reverse_movement',
    jsonb_build_object('movement_id', p_movement_id, 'reason', p_reason));
  if v_previous is not null then
    return v_previous;
  end if;

  select * into v_original from public.inventory_movements where account_id = v_account and id = p_movement_id;
  if v_original.id is null then
    perform private.fail('MOVEMENT_NOT_FOUND', 'El movimiento no existe.');
  end if;
  if v_original.kind not in ('adjustment', 'waste', 'supplier_return', 'receipt_correction') then
    perform private.fail('MOVEMENT_NOT_REVERSIBLE',
      'Solo se revierten ajustes, mermas, devoluciones y correcciones. Una compra o entrada se corrige con un ajuste.');
  end if;
  if exists (select 1 from public.inventory_movements where reverses_movement_id = p_movement_id) then
    perform private.fail('ALREADY_REVERSED', 'Este movimiento ya fue revertido.');
  end if;

  v_move := private.apply_movement(v_account, v_original.container_id, -v_original.quantity, 'reversal',
    'reversal', p_idempotency_key, coalesce(nullif(trim(p_reason), ''), 'Reversión'), null, v_original.id);

  perform private.audit(v_account, 'owner', 'inventory.reversal', 'inventory_movement', p_movement_id, to_jsonb(v_move));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_move));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: conteo físico (parcial o total)
-- p_lines: [{container_id, expected_balance, counted_quantity}] en unidad base.
-- Si el saldo cambió desde que se mostró, falla para que el usuario revise.
-- -----------------------------------------------------------------------------

create function public.confirm_inventory_count(p_idempotency_key uuid, p_lines jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_notes    text := nullif(trim(p_notes), '');
  v_previous jsonb;
  v_count    public.inventory_counts;
  v_line     record;
  v_move     public.inventory_movements;
  v_adjusted integer := 0;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'confirm_inventory_count',
    jsonb_build_object('lines', p_lines, 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.fail('COUNT_LINES_REQUIRED', 'Cuenta al menos un envase.');
  end if;
  if (select count(distinct l ->> 'container_id') from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines) then
    perform private.fail('DUPLICATE_CONTAINER', 'Un envase aparece dos veces en el conteo.');
  end if;

  perform private.lock_ingredients(v_account, array(
    select distinct c.ingredient_id from public.containers c
     where c.account_id = v_account
       and c.id in (select (l ->> 'container_id')::uuid from jsonb_array_elements(p_lines) l)));

  insert into public.inventory_counts (account_id, notes) values (v_account, v_notes) returning * into v_count;

  for v_line in
    select (l ->> 'container_id')::uuid as container_id,
           (l ->> 'expected_balance')::numeric as expected,
           (l ->> 'counted_quantity')::numeric as counted
      from jsonb_array_elements(p_lines) l
     order by 1
  loop
    if v_line.counted is null or v_line.counted < 0 then
      perform private.fail('INVALID_QUANTITY', 'La cantidad contada no puede estar vacía ni ser negativa.');
    end if;
    if v_line.expected is null then
      perform private.fail('EXPECTED_BALANCE_REQUIRED', 'Falta el saldo que estabas viendo. Actualiza la pantalla.');
    end if;
    if not exists (select 1 from public.containers where account_id = v_account and id = v_line.container_id) then
      perform private.fail('CONTAINER_NOT_FOUND', 'Uno de los envases no existe.');
    end if;

    v_move := null;
    if v_line.counted <> v_line.expected then
      v_move := private.apply_movement(v_account, v_line.container_id, v_line.counted - v_line.expected, 'adjustment',
        'inventory_count', v_count.id, coalesce(v_notes, 'Conteo físico'), null, null, v_line.expected);
      v_adjusted := v_adjusted + 1;
    elsif (select balance from public.containers where account_id = v_account and id = v_line.container_id) <> v_line.expected then
      perform private.fail('STALE_BALANCE',
        'El saldo de un envase cambió mientras contabas. Actualiza la pantalla y revisa el conteo.');
    end if;

    insert into public.inventory_count_lines (account_id, count_id, container_id, system_balance, counted_quantity, movement_id)
    values (v_account, v_count.id, v_line.container_id, v_line.expected, v_line.counted, v_move.id);
  end loop;

  perform private.audit(v_account, 'owner', 'inventory.count', 'inventory_count', v_count.id,
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'adjusted', v_adjusted));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key,
    to_jsonb(v_count) || jsonb_build_object('adjusted', v_adjusted));
end;
$$;

-- -----------------------------------------------------------------------------
-- Presentaciones con envases: su contenido ya no se puede cambiar
-- -----------------------------------------------------------------------------

create or replace function public.update_presentation(
  p_presentation_id      uuid,
  p_quantity             numeric,
  p_unit                 text,
  p_description          text default null,
  p_reference_price_clp  bigint default null,
  p_reference_price_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account     uuid := private.require_account_id();
  v_description text := nullif(trim(p_description), '');
  v_price_date  date;
  v_before      public.presentations;
  v_after       public.presentations;
  v_dimension   text;
begin
  select * into v_before from public.presentations
   where account_id = v_account and id = p_presentation_id
   for update;
  if v_before.id is null then
    perform private.fail('PRESENTATION_NOT_FOUND', 'La presentación no existe.');
  end if;

  if (p_quantity is distinct from v_before.quantity or p_unit is distinct from v_before.unit)
     and exists (select 1 from public.containers where account_id = v_account and presentation_id = p_presentation_id) then
    perform private.fail('PRESENTATION_IN_USE',
      'Esta presentación ya tiene envases en inventario: su contenido no se puede cambiar. Crea una presentación nueva.');
  end if;

  select dimension into v_dimension from public.ingredients
   where account_id = v_account and id = v_before.ingredient_id;
  perform private.check_presentation_fields(v_dimension, p_quantity, p_unit, v_description, p_reference_price_clp);

  if p_reference_price_clp is not null then
    v_price_date := coalesce(p_reference_price_date,
      case when p_reference_price_clp = v_before.reference_price_clp then v_before.reference_price_date end,
      (now() at time zone (select timezone from public.accounts where id = v_account))::date);
  end if;

  update public.presentations
     set quantity = p_quantity,
         unit = p_unit,
         description = v_description,
         reference_price_clp = p_reference_price_clp,
         reference_price_date = v_price_date
   where account_id = v_account and id = p_presentation_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'presentation.updated', 'presentation', p_presentation_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function public.preview_purchase(jsonb, jsonb) from public, anon;
revoke execute on function public.confirm_purchase(uuid, date, jsonb, jsonb, text, boolean, text) from public, anon;
revoke execute on function public.set_purchase_verified(uuid) from public, anon;
revoke execute on function public.register_manual_entry(uuid, uuid, integer, numeric, date, bigint, boolean, boolean, text) from public, anon;
revoke execute on function public.register_container_movement(uuid, uuid, text, numeric, text, text, numeric) from public, anon;
revoke execute on function public.reverse_movement(uuid, uuid, text) from public, anon;
revoke execute on function public.confirm_inventory_count(uuid, jsonb, text) from public, anon;

grant execute on function public.preview_purchase(jsonb, jsonb) to authenticated;
grant execute on function public.confirm_purchase(uuid, date, jsonb, jsonb, text, boolean, text) to authenticated;
grant execute on function public.set_purchase_verified(uuid) to authenticated;
grant execute on function public.register_manual_entry(uuid, uuid, integer, numeric, date, bigint, boolean, boolean, text) to authenticated;
grant execute on function public.register_container_movement(uuid, uuid, text, numeric, text, text, numeric) to authenticated;
grant execute on function public.reverse_movement(uuid, uuid, text) to authenticated;
grant execute on function public.confirm_inventory_count(uuid, jsonb, text) to authenticated;
