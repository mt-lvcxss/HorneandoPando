-- =============================================================================
-- Etapa 3.1 · Catálogo y configuración operacional
-- Unidades de medida, ingredientes, presentaciones, equivalencias entre dimensiones
-- y configuración del negocio. Ver docs/decisiones.md (D-017, D-018).
--
-- Lectura: select directo protegido por RLS. Escritura: solo mediante las RPC de este archivo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Unidades de medida (catálogo global de solo lectura)
-- Tres dimensiones con una unidad base cada una: g, ml y unidad.
-- Las conversiones dentro de una dimensión son fijas (to_base). Entre dimensiones
-- solo mediante una equivalencia del usuario (ingredient_equivalences).
-- -----------------------------------------------------------------------------

create table public.units (
  code        text primary key,
  dimension   text not null check (dimension in ('mass', 'volume', 'count')),
  to_base     numeric not null check (to_base > 0),
  label       text not null,
  sort_order  smallint not null
);

insert into public.units (code, dimension, to_base, label, sort_order) values
  ('g',      'mass',   1,    'gramos',      10),
  ('kg',     'mass',   1000, 'kilogramos',  11),
  ('ml',     'volume', 1,    'mililitros',  20),
  ('l',      'volume', 1000, 'litros',      21),
  ('unidad', 'count',  1,    'unidades',    30);

alter table public.units enable row level security;
revoke all on table public.units from anon, authenticated;
grant select on table public.units to authenticated;
create policy units_select_all on public.units for select to authenticated using (true);

create function private.base_unit(p_dimension text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_dimension when 'mass' then 'g' when 'volume' then 'ml' when 'count' then 'unidad' end;
$$;

-- -----------------------------------------------------------------------------
-- Configuración operacional del negocio (una fila por cuenta)
-- -----------------------------------------------------------------------------

create table public.account_settings (
  account_id                   uuid primary key references public.accounts (id),
  -- Seguimiento de productos terminados: desactivado por defecto (D-017).
  finished_goods_tracking      boolean not null default false,
  -- Criterio global de costo de reposición; cada ingrediente puede tener una excepción.
  replacement_cost_criterion   text not null default 'latest_purchase'
                                 check (replacement_cost_criterion in ('latest_purchase', 'lowest_unit_cost')),
  -- Criterio propuesto al distribuir cargos adicionales de una compra (se puede cambiar en cada cargo).
  charge_distribution_default  text not null default 'by_value'
                                 check (charge_distribution_default in ('by_value', 'by_quantity')),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create trigger account_settings_enforce_account
  before insert or update on public.account_settings
  for each row execute function private.enforce_account_id();

create trigger account_settings_touch_updated_at
  before update on public.account_settings
  for each row execute function private.touch_updated_at();

alter table public.account_settings enable row level security;
revoke all on table public.account_settings from anon, authenticated;
grant select on table public.account_settings to authenticated;
create policy account_settings_select_own on public.account_settings
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- Cada cuenta nueva nace con su configuración por defecto.
create function private.create_account_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_settings (account_id) values (new.id) on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger accounts_create_settings
  after insert on public.accounts
  for each row execute function private.create_account_settings();

insert into public.account_settings (account_id)
select id from public.accounts
on conflict (account_id) do nothing;

-- -----------------------------------------------------------------------------
-- Ingredientes
-- -----------------------------------------------------------------------------

create table public.ingredients (
  id                          uuid primary key default gen_random_uuid(),
  account_id                  uuid not null references public.accounts (id),
  name                        text not null check (char_length(name) between 1 and 120),
  category                    text check (category is null or char_length(category) between 1 and 60),
  dimension                   text not null check (dimension in ('mass', 'volume', 'count')),
  -- En la unidad base de la dimensión (g, ml o unidad). NULL = sin mínimo configurado.
  min_stock                   numeric check (min_stock is null or min_stock >= 0),
  -- NULL = usa el criterio global de account_settings.
  replacement_cost_criterion  text check (replacement_cost_criterion is null
                                or replacement_cost_criterion in ('latest_purchase', 'lowest_unit_cost')),
  notes                       text check (notes is null or char_length(notes) <= 1000),
  archived_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (account_id, id)
);

create unique index ingredients_active_name_uq
  on public.ingredients (account_id, lower(name))
  where archived_at is null;

create trigger ingredients_enforce_account
  before insert or update on public.ingredients
  for each row execute function private.enforce_account_id();

create trigger ingredients_touch_updated_at
  before update on public.ingredients
  for each row execute function private.touch_updated_at();

alter table public.ingredients enable row level security;
revoke all on table public.ingredients from anon, authenticated;
grant select on table public.ingredients to authenticated;
create policy ingredients_select_own on public.ingredients
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- Presentaciones comerciales (marca + contenido de un envase)
-- Cada presentación tiene su propio precio de referencia: no se asume que todas
-- tengan el mismo costo por unidad.
-- -----------------------------------------------------------------------------

create table public.presentations (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts (id),
  ingredient_id          uuid not null,
  brand                  text check (brand is null or char_length(brand) between 1 and 80),
  description            text check (description is null or char_length(description) between 1 and 120),
  -- Contenido de un envase, en una unidad de la misma dimensión que el ingrediente.
  quantity               numeric not null check (quantity > 0),
  unit                   text not null references public.units (code),
  -- Precio de referencia en CLP (no es un costo histórico). Siempre con su fecha.
  reference_price_clp    bigint check (reference_price_clp is null or reference_price_clp > 0),
  reference_price_date   date,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id),
  check ((reference_price_clp is null) = (reference_price_date is null))
);

create index presentations_ingredient_idx on public.presentations (account_id, ingredient_id);

create trigger presentations_enforce_account
  before insert or update on public.presentations
  for each row execute function private.enforce_account_id();

create trigger presentations_touch_updated_at
  before update on public.presentations
  for each row execute function private.touch_updated_at();

alter table public.presentations enable row level security;
revoke all on table public.presentations from anon, authenticated;
grant select on table public.presentations to authenticated;
create policy presentations_select_own on public.presentations
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- Equivalencias entre dimensiones, por ingrediente (p. ej. 1 unidad de huevo = 50 g)
--
-- Inmutables: una equivalencia nueva reemplaza a la vigente (superseded_at) y la
-- anterior se conserva. Las operaciones guardan la equivalencia usada, de modo que
-- cambiarla nunca altera el historial.
-- -----------------------------------------------------------------------------

create table public.ingredient_equivalences (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references public.accounts (id),
  ingredient_id             uuid not null,
  -- Tal como lo escribió el usuario: "<other_quantity> <other_unit> = <ingredient_quantity> <ingredient_unit>".
  other_quantity            numeric not null check (other_quantity > 0),
  other_unit                text not null references public.units (code),
  ingredient_quantity       numeric not null check (ingredient_quantity > 0),
  ingredient_unit           text not null references public.units (code),
  -- Normalizado a unidades base: other_base_quantity (en la otra dimensión) equivale a
  -- ingredient_base_quantity (en la dimensión del ingrediente). Se guarda como par para
  -- no perder exactitud con divisiones periódicas (3 unidades = 100 g).
  other_dimension           text not null check (other_dimension in ('mass', 'volume', 'count')),
  other_base_quantity       numeric not null check (other_base_quantity > 0),
  ingredient_base_quantity  numeric not null check (ingredient_base_quantity > 0),
  note                      text check (note is null or char_length(note) <= 300),
  created_at                timestamptz not null default now(),
  superseded_at             timestamptz,
  unique (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id)
);

create unique index ingredient_equivalences_current_uq
  on public.ingredient_equivalences (account_id, ingredient_id, other_dimension)
  where superseded_at is null;

create trigger ingredient_equivalences_enforce_account
  before insert or update on public.ingredient_equivalences
  for each row execute function private.enforce_account_id();

-- Solo se permite marcar una vigente como reemplazada; nada más cambia y nada se borra.
create function private.guard_equivalence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.superseded_at is not null
     or new.superseded_at is null
     or (to_jsonb(new) - 'superseded_at') <> (to_jsonb(old) - 'superseded_at') then
    perform private.fail('IMMUTABLE_RECORD',
      'Las equivalencias no se modifican ni eliminan. Registra una nueva para reemplazarla.');
  end if;
  return new;
end;
$$;

create trigger ingredient_equivalences_immutable
  before update or delete on public.ingredient_equivalences
  for each row execute function private.guard_equivalence_change();

alter table public.ingredient_equivalences enable row level security;
revoke all on table public.ingredient_equivalences from anon, authenticated;
grant select on table public.ingredient_equivalences to authenticated;
create policy ingredient_equivalences_select_own on public.ingredient_equivalences
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- Conversión de cantidades a la unidad base del ingrediente
--
-- Devuelve la cantidad convertida y la equivalencia utilizada (si hizo falta).
-- quantity = NULL si no hay conversión válida: nunca se inventa una equivalencia.
-- p_at permite convertir con la equivalencia vigente en un momento pasado.
-- -----------------------------------------------------------------------------

create function private.to_ingredient_base(
  p_account_id    uuid,
  p_ingredient_id uuid,
  p_quantity      numeric,
  p_unit          text,
  p_at            timestamptz default now()
)
returns table (quantity numeric, equivalence_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when u.dimension = i.dimension then p_quantity * u.to_base
      when e.id is not null then p_quantity * u.to_base * e.ingredient_base_quantity / e.other_base_quantity
    end,
    e.id
  from public.ingredients i
  join public.units u on u.code = p_unit
  left join public.ingredient_equivalences e
    on e.account_id = i.account_id
   and e.ingredient_id = i.id
   and u.dimension <> i.dimension
   and e.other_dimension = u.dimension
   and e.created_at <= p_at
   and (e.superseded_at is null or e.superseded_at > p_at)
  where i.account_id = p_account_id
    and i.id = p_ingredient_id;
$$;

-- -----------------------------------------------------------------------------
-- Validaciones compartidas
-- -----------------------------------------------------------------------------

create function private.check_ingredient_fields(
  p_name                       text,
  p_dimension                  text,
  p_category                   text,
  p_min_stock                  numeric,
  p_replacement_cost_criterion text,
  p_notes                      text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null then
    perform private.fail('INGREDIENT_NAME_REQUIRED', 'Ingresa el nombre del ingrediente.');
  end if;
  if char_length(p_name) > 120 then
    perform private.fail('INGREDIENT_NAME_TOO_LONG', 'El nombre puede tener hasta 120 caracteres.');
  end if;
  if p_dimension is null or p_dimension not in ('mass', 'volume', 'count') then
    perform private.fail('INVALID_DIMENSION', 'Elige si el ingrediente se mide en peso, volumen o unidades.');
  end if;
  if p_category is not null and char_length(p_category) > 60 then
    perform private.fail('CATEGORY_TOO_LONG', 'La categoría puede tener hasta 60 caracteres.');
  end if;
  if p_min_stock is not null and p_min_stock < 0 then
    perform private.fail('INVALID_MIN_STOCK', 'El stock mínimo no puede ser negativo.');
  end if;
  if p_replacement_cost_criterion is not null
     and p_replacement_cost_criterion not in ('latest_purchase', 'lowest_unit_cost') then
    perform private.fail('INVALID_REPLACEMENT_CRITERION', 'El criterio de costo de reposición no es válido.');
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    perform private.fail('NOTES_TOO_LONG', 'Las notas pueden tener hasta 1.000 caracteres.');
  end if;
end;
$$;

create function private.check_presentation_fields(
  p_dimension           text,
  p_quantity            numeric,
  p_unit                text,
  p_brand               text,
  p_description         text,
  p_reference_price_clp bigint
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit_dimension text;
begin
  if p_quantity is null or p_quantity <= 0 then
    perform private.fail('INVALID_QUANTITY', 'El contenido del envase debe ser mayor que cero.');
  end if;
  select dimension into v_unit_dimension from public.units where code = p_unit;
  if v_unit_dimension is null then
    perform private.fail('INVALID_UNIT', 'La unidad de medida no es válida.');
  end if;
  if v_unit_dimension <> p_dimension then
    perform private.fail('UNIT_DIMENSION_MISMATCH',
      'La unidad del envase debe ser de la misma dimensión que el ingrediente (peso, volumen o unidades).');
  end if;
  if p_brand is not null and char_length(p_brand) > 80 then
    perform private.fail('BRAND_TOO_LONG', 'La marca puede tener hasta 80 caracteres.');
  end if;
  if p_description is not null and char_length(p_description) > 120 then
    perform private.fail('DESCRIPTION_TOO_LONG', 'La descripción puede tener hasta 120 caracteres.');
  end if;
  if p_reference_price_clp is not null and p_reference_price_clp <= 0 then
    perform private.fail('INVALID_PRICE',
      'El precio de referencia debe ser mayor que cero. Si no lo conoces, déjalo vacío.');
  end if;
end;
$$;

-- Ingrediente propio, bloqueado para actualizar. Falla si no existe o es de otra cuenta.
create function private.lock_ingredient(p_account_id uuid, p_ingredient_id uuid)
returns public.ingredients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ingredients;
begin
  select * into v_row from public.ingredients
   where account_id = p_account_id and id = p_ingredient_id
   for update;
  if v_row.id is null then
    perform private.fail('INGREDIENT_NOT_FOUND', 'El ingrediente no existe.');
  end if;
  return v_row;
end;
$$;

create function private.ingredient_name_taken(p_account_id uuid, p_name text, p_except_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ingredients
     where account_id = p_account_id
       and lower(name) = lower(p_name)
       and archived_at is null
       and id is distinct from p_except_id
  );
$$;

-- -----------------------------------------------------------------------------
-- RPC: ingredientes
-- -----------------------------------------------------------------------------

create function public.create_ingredient(
  p_idempotency_key            uuid,
  p_name                       text,
  p_dimension                  text,
  p_category                   text default null,
  p_min_stock                  numeric default null,
  p_replacement_cost_criterion text default null,
  p_notes                      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(trim(p_name), '');
  v_category text := nullif(trim(p_category), '');
  v_notes    text := nullif(trim(p_notes), '');
  v_previous jsonb;
  v_row      public.ingredients;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_ingredient', jsonb_build_object(
    'name', v_name, 'dimension', p_dimension, 'category', v_category, 'min_stock', p_min_stock,
    'replacement_cost_criterion', p_replacement_cost_criterion, 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  perform private.check_ingredient_fields(v_name, p_dimension, v_category, p_min_stock,
    p_replacement_cost_criterion, v_notes);
  if private.ingredient_name_taken(v_account, v_name, null) then
    perform private.fail('INGREDIENT_NAME_TAKEN', 'Ya tienes un ingrediente activo con ese nombre.');
  end if;

  insert into public.ingredients (account_id, name, category, dimension, min_stock, replacement_cost_criterion, notes)
  values (v_account, v_name, v_category, p_dimension, p_min_stock, p_replacement_cost_criterion, v_notes)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'ingredient.created', 'ingredient', v_row.id, to_jsonb(v_row));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_row));
end;
$$;

create function public.update_ingredient(
  p_ingredient_id              uuid,
  p_name                       text,
  p_dimension                  text,
  p_category                   text default null,
  p_min_stock                  numeric default null,
  p_replacement_cost_criterion text default null,
  p_notes                      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(trim(p_name), '');
  v_category text := nullif(trim(p_category), '');
  v_notes    text := nullif(trim(p_notes), '');
  v_before   public.ingredients;
  v_after    public.ingredients;
begin
  v_before := private.lock_ingredient(v_account, p_ingredient_id);
  perform private.check_ingredient_fields(v_name, p_dimension, v_category, p_min_stock,
    p_replacement_cost_criterion, v_notes);

  if v_before.archived_at is null and private.ingredient_name_taken(v_account, v_name, p_ingredient_id) then
    perform private.fail('INGREDIENT_NAME_TAKEN', 'Ya tienes un ingrediente activo con ese nombre.');
  end if;

  if p_dimension <> v_before.dimension and (
       exists (select 1 from public.presentations where account_id = v_account and ingredient_id = p_ingredient_id)
    or exists (select 1 from public.ingredient_equivalences where account_id = v_account and ingredient_id = p_ingredient_id)
  ) then
    perform private.fail('DIMENSION_LOCKED',
      'No se puede cambiar cómo se mide un ingrediente que ya tiene presentaciones o equivalencias. Archívalo y crea uno nuevo.');
  end if;

  update public.ingredients
     set name = v_name,
         dimension = p_dimension,
         category = v_category,
         min_stock = p_min_stock,
         replacement_cost_criterion = p_replacement_cost_criterion,
         notes = v_notes
   where account_id = v_account and id = p_ingredient_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'ingredient.updated', 'ingredient', p_ingredient_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

create function public.set_ingredient_archived(p_ingredient_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.ingredients;
  v_after   public.ingredients;
begin
  v_before := private.lock_ingredient(v_account, p_ingredient_id);
  if p_archived is null then
    perform private.fail('INVALID_ARCHIVE_FLAG', 'Indica si quieres archivar o restaurar el ingrediente.');
  end if;
  if (v_before.archived_at is not null) = p_archived then
    return to_jsonb(v_before);
  end if;
  if not p_archived and private.ingredient_name_taken(v_account, v_before.name, p_ingredient_id) then
    perform private.fail('INGREDIENT_NAME_TAKEN',
      'Ya tienes un ingrediente activo con ese nombre. Cambia el nombre de uno de los dos antes de restaurarlo.');
  end if;

  update public.ingredients
     set archived_at = case when p_archived then now() end
   where account_id = v_account and id = p_ingredient_id
  returning * into v_after;

  perform private.audit(v_account, 'owner',
    case when p_archived then 'ingredient.archived' else 'ingredient.restored' end,
    'ingredient', p_ingredient_id);
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: presentaciones
-- -----------------------------------------------------------------------------

create function public.create_presentation(
  p_idempotency_key      uuid,
  p_ingredient_id        uuid,
  p_quantity             numeric,
  p_unit                 text,
  p_brand                text default null,
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
  v_brand       text := nullif(trim(p_brand), '');
  v_description text := nullif(trim(p_description), '');
  v_price_date  date;
  v_previous    jsonb;
  v_ingredient  public.ingredients;
  v_row         public.presentations;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_presentation', jsonb_build_object(
    'ingredient_id', p_ingredient_id, 'quantity', p_quantity, 'unit', p_unit, 'brand', v_brand,
    'description', v_description, 'reference_price_clp', p_reference_price_clp,
    'reference_price_date', p_reference_price_date));
  if v_previous is not null then
    return v_previous;
  end if;

  v_ingredient := private.lock_ingredient(v_account, p_ingredient_id);
  if v_ingredient.archived_at is not null then
    perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo para agregarle presentaciones.');
  end if;
  perform private.check_presentation_fields(v_ingredient.dimension, p_quantity, p_unit, v_brand, v_description,
    p_reference_price_clp);

  -- Un precio de referencia siempre lleva fecha; si no se indica, es la de hoy en la zona del negocio.
  if p_reference_price_clp is not null then
    v_price_date := coalesce(p_reference_price_date,
      (now() at time zone (select timezone from public.accounts where id = v_account))::date);
  end if;

  insert into public.presentations (account_id, ingredient_id, brand, description, quantity, unit,
                                    reference_price_clp, reference_price_date)
  values (v_account, p_ingredient_id, v_brand, v_description, p_quantity, p_unit, p_reference_price_clp, v_price_date)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'presentation.created', 'presentation', v_row.id, to_jsonb(v_row));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_row));
end;
$$;

-- Nota: desde la subetapa 3.2, el contenido (quantity / unit) de una presentación usada en compras
-- quedará bloqueado; aquí todavía no existen compras.
create function public.update_presentation(
  p_presentation_id      uuid,
  p_quantity             numeric,
  p_unit                 text,
  p_brand                text default null,
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
  v_brand       text := nullif(trim(p_brand), '');
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

  select dimension into v_dimension from public.ingredients
   where account_id = v_account and id = v_before.ingredient_id;
  perform private.check_presentation_fields(v_dimension, p_quantity, p_unit, v_brand, v_description,
    p_reference_price_clp);

  if p_reference_price_clp is not null then
    v_price_date := coalesce(p_reference_price_date,
      case when p_reference_price_clp = v_before.reference_price_clp then v_before.reference_price_date end,
      (now() at time zone (select timezone from public.accounts where id = v_account))::date);
  end if;

  update public.presentations
     set quantity = p_quantity,
         unit = p_unit,
         brand = v_brand,
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

create function public.set_presentation_archived(p_presentation_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.presentations;
  v_after   public.presentations;
begin
  select * into v_before from public.presentations
   where account_id = v_account and id = p_presentation_id
   for update;
  if v_before.id is null then
    perform private.fail('PRESENTATION_NOT_FOUND', 'La presentación no existe.');
  end if;
  if p_archived is null then
    perform private.fail('INVALID_ARCHIVE_FLAG', 'Indica si quieres archivar o restaurar la presentación.');
  end if;
  if (v_before.archived_at is not null) = p_archived then
    return to_jsonb(v_before);
  end if;
  if not p_archived and exists (
    select 1 from public.ingredients
     where account_id = v_account and id = v_before.ingredient_id and archived_at is not null
  ) then
    perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo primero.');
  end if;

  update public.presentations
     set archived_at = case when p_archived then now() end
   where account_id = v_account and id = p_presentation_id
  returning * into v_after;

  perform private.audit(v_account, 'owner',
    case when p_archived then 'presentation.archived' else 'presentation.restored' end,
    'presentation', p_presentation_id);
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: equivalencias
-- Se acepta "A = B" en cualquier orden; uno de los lados debe estar en la dimensión del
-- ingrediente y el otro en una dimensión distinta.
-- -----------------------------------------------------------------------------

create function public.set_ingredient_equivalence(
  p_idempotency_key uuid,
  p_ingredient_id   uuid,
  p_quantity_a      numeric,
  p_unit_a          text,
  p_quantity_b      numeric,
  p_unit_b          text,
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account     uuid := private.require_account_id();
  v_note        text := nullif(trim(p_note), '');
  v_previous    jsonb;
  v_ingredient  public.ingredients;
  v_unit_a      public.units;
  v_unit_b      public.units;
  v_other_qty   numeric;
  v_other_unit  public.units;
  v_ingr_qty    numeric;
  v_ingr_unit   public.units;
  v_replaced    uuid;
  v_row         public.ingredient_equivalences;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'set_ingredient_equivalence', jsonb_build_object(
    'ingredient_id', p_ingredient_id, 'quantity_a', p_quantity_a, 'unit_a', p_unit_a,
    'quantity_b', p_quantity_b, 'unit_b', p_unit_b, 'note', v_note));
  if v_previous is not null then
    return v_previous;
  end if;

  v_ingredient := private.lock_ingredient(v_account, p_ingredient_id);
  if v_ingredient.archived_at is not null then
    perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo para editarlo.');
  end if;
  if p_quantity_a is null or p_quantity_a <= 0 or p_quantity_b is null or p_quantity_b <= 0 then
    perform private.fail('INVALID_QUANTITY', 'Las dos cantidades de la equivalencia deben ser mayores que cero.');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    perform private.fail('NOTES_TOO_LONG', 'La nota puede tener hasta 300 caracteres.');
  end if;

  select * into v_unit_a from public.units where code = p_unit_a;
  select * into v_unit_b from public.units where code = p_unit_b;
  if v_unit_a.code is null or v_unit_b.code is null then
    perform private.fail('INVALID_UNIT', 'La unidad de medida no es válida.');
  end if;
  if v_unit_a.dimension = v_unit_b.dimension then
    perform private.fail('EQUIVALENCE_SAME_DIMENSION',
      'Las conversiones dentro de una misma dimensión (por ejemplo kg y g) ya son automáticas.');
  end if;

  if v_unit_b.dimension = v_ingredient.dimension then
    v_ingr_qty := p_quantity_b; v_ingr_unit := v_unit_b; v_other_qty := p_quantity_a; v_other_unit := v_unit_a;
  elsif v_unit_a.dimension = v_ingredient.dimension then
    v_ingr_qty := p_quantity_a; v_ingr_unit := v_unit_a; v_other_qty := p_quantity_b; v_other_unit := v_unit_b;
  else
    perform private.fail('EQUIVALENCE_DIMENSION',
      'Uno de los lados de la equivalencia debe estar en la unidad con que se mide el ingrediente.');
  end if;

  update public.ingredient_equivalences
     set superseded_at = now()
   where account_id = v_account
     and ingredient_id = p_ingredient_id
     and other_dimension = v_other_unit.dimension
     and superseded_at is null
  returning id into v_replaced;

  insert into public.ingredient_equivalences (
    account_id, ingredient_id, other_quantity, other_unit, ingredient_quantity, ingredient_unit,
    other_dimension, other_base_quantity, ingredient_base_quantity, note)
  values (
    v_account, p_ingredient_id, v_other_qty, v_other_unit.code, v_ingr_qty, v_ingr_unit.code,
    v_other_unit.dimension, v_other_qty * v_other_unit.to_base, v_ingr_qty * v_ingr_unit.to_base, v_note)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'ingredient_equivalence.created', 'ingredient_equivalence', v_row.id,
    to_jsonb(v_row) || jsonb_build_object('replaced_id', v_replaced));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_row));
end;
$$;

create function public.retire_ingredient_equivalence(p_equivalence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_row     public.ingredient_equivalences;
begin
  select * into v_row from public.ingredient_equivalences
   where account_id = v_account and id = p_equivalence_id
   for update;
  if v_row.id is null then
    perform private.fail('EQUIVALENCE_NOT_FOUND', 'La equivalencia no existe.');
  end if;
  if v_row.superseded_at is not null then
    return to_jsonb(v_row);
  end if;

  update public.ingredient_equivalences
     set superseded_at = now()
   where account_id = v_account and id = p_equivalence_id
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'ingredient_equivalence.retired', 'ingredient_equivalence', v_row.id);
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_row);
end;
$$;

-- Conversión para mostrar en pantalla (no modifica nada).
-- { convertible, quantity (en unidad base del ingrediente), base_unit, equivalence_id }
create function public.convert_to_ingredient_base(p_ingredient_id uuid, p_quantity numeric, p_unit text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account   uuid := private.require_account_id();
  v_dimension text;
  v_quantity  numeric;
  v_equiv     uuid;
begin
  select dimension into v_dimension from public.ingredients where account_id = v_account and id = p_ingredient_id;
  if v_dimension is null then
    perform private.fail('INGREDIENT_NOT_FOUND', 'El ingrediente no existe.');
  end if;
  select c.quantity, c.equivalence_id into v_quantity, v_equiv
    from private.to_ingredient_base(v_account, p_ingredient_id, p_quantity, p_unit) c;
  return jsonb_build_object(
    'convertible', v_quantity is not null,
    'quantity', v_quantity,
    'base_unit', private.base_unit(v_dimension),
    'equivalence_id', v_equiv);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: configuración operacional
-- -----------------------------------------------------------------------------

create function public.update_operation_settings(
  p_finished_goods_tracking     boolean,
  p_replacement_cost_criterion  text,
  p_charge_distribution_default text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.account_settings;
  v_after   public.account_settings;
begin
  if p_finished_goods_tracking is null then
    perform private.fail('INVALID_SETTING', 'Indica si quieres llevar el seguimiento de productos terminados.');
  end if;
  if p_replacement_cost_criterion is null or p_replacement_cost_criterion not in ('latest_purchase', 'lowest_unit_cost') then
    perform private.fail('INVALID_REPLACEMENT_CRITERION', 'El criterio de costo de reposición no es válido.');
  end if;
  if p_charge_distribution_default is null or p_charge_distribution_default not in ('by_value', 'by_quantity') then
    perform private.fail('INVALID_DISTRIBUTION_CRITERION', 'El criterio de distribución de cargos no es válido.');
  end if;

  select * into v_before from public.account_settings where account_id = v_account for update;

  update public.account_settings
     set finished_goods_tracking = p_finished_goods_tracking,
         replacement_cost_criterion = p_replacement_cost_criterion,
         charge_distribution_default = p_charge_distribution_default
   where account_id = v_account
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'settings.updated', 'account', v_account,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function public.create_ingredient(uuid, text, text, text, numeric, text, text) from public, anon;
revoke execute on function public.update_ingredient(uuid, text, text, text, numeric, text, text) from public, anon;
revoke execute on function public.set_ingredient_archived(uuid, boolean) from public, anon;
revoke execute on function public.create_presentation(uuid, uuid, numeric, text, text, text, bigint, date) from public, anon;
revoke execute on function public.update_presentation(uuid, numeric, text, text, text, bigint, date) from public, anon;
revoke execute on function public.set_presentation_archived(uuid, boolean) from public, anon;
revoke execute on function public.set_ingredient_equivalence(uuid, uuid, numeric, text, numeric, text, text) from public, anon;
revoke execute on function public.retire_ingredient_equivalence(uuid) from public, anon;
revoke execute on function public.convert_to_ingredient_base(uuid, numeric, text) from public, anon;
revoke execute on function public.update_operation_settings(boolean, text, text) from public, anon;

grant execute on function public.create_ingredient(uuid, text, text, text, numeric, text, text) to authenticated;
grant execute on function public.update_ingredient(uuid, text, text, text, numeric, text, text) to authenticated;
grant execute on function public.set_ingredient_archived(uuid, boolean) to authenticated;
grant execute on function public.create_presentation(uuid, uuid, numeric, text, text, text, bigint, date) to authenticated;
grant execute on function public.update_presentation(uuid, numeric, text, text, text, bigint, date) to authenticated;
grant execute on function public.set_presentation_archived(uuid, boolean) to authenticated;
grant execute on function public.set_ingredient_equivalence(uuid, uuid, numeric, text, numeric, text, text) to authenticated;
grant execute on function public.retire_ingredient_equivalence(uuid) to authenticated;
grant execute on function public.convert_to_ingredient_base(uuid, numeric, text) to authenticated;
grant execute on function public.update_operation_settings(boolean, text, text) to authenticated;
