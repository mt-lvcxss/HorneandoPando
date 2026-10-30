-- =============================================================================
-- Etapa 3.1 · Ingrediente → Marca → Presentación (D-020)
--
-- El ingrediente es el producto genérico que piden las recetas («Harina», «Polvos de hornear»).
-- Cada ingrediente tiene marcas, y cada marca sus presentaciones (envase y tamaño, con precio).
-- Reemplaza la categoría de texto (que cumplía el papel de ingrediente) por esta jerarquía.
-- =============================================================================

-- Esta reestructuración no transforma datos: se aplicó con el catálogo vacío en todos los entornos.
do $$
begin
  if exists (select 1 from public.ingredients) or exists (select 1 from public.presentations) then
    raise exception 'La migración 20261031110000 requiere el catálogo vacío. Ver docs/decisiones.md (D-020).';
  end if;
end;
$$;

drop function public.create_ingredient(uuid, text, text, text, text);
drop function public.update_ingredient(uuid, text, text, text, text);
drop function public.create_presentation(uuid, uuid, numeric, text, text, text, bigint, date);
drop function public.update_presentation(uuid, numeric, text, text, text, bigint, date);
drop function private.check_ingredient_fields(text, text, text, text);
drop function private.check_presentation_fields(text, numeric, text, text, text, bigint);
drop function private.normalize_category(uuid, text);

drop index public.ingredients_category_idx;
alter table public.ingredients drop column category;

-- -----------------------------------------------------------------------------
-- Marcas de un ingrediente
-- -----------------------------------------------------------------------------

create table public.brands (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id),
  ingredient_id  uuid not null,
  name           text not null check (char_length(name) between 1 and 80),
  notes          text check (notes is null or char_length(notes) <= 1000),
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (account_id, id),
  -- Permite que las presentaciones comprueben que su marca es del mismo ingrediente.
  unique (account_id, id, ingredient_id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id)
);

create unique index brands_active_name_uq
  on public.brands (account_id, ingredient_id, lower(name))
  where archived_at is null;

create trigger brands_enforce_account
  before insert or update on public.brands
  for each row execute function private.enforce_account_id();

create trigger brands_touch_updated_at
  before update on public.brands
  for each row execute function private.touch_updated_at();

alter table public.brands enable row level security;
revoke all on table public.brands from anon, authenticated;
grant select on table public.brands to authenticated;
create policy brands_select_own on public.brands
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- -----------------------------------------------------------------------------
-- Presentaciones: ahora pertenecen a una marca (y, por ella, a un ingrediente)
-- -----------------------------------------------------------------------------

alter table public.presentations
  drop column brand,
  add column brand_id uuid not null,
  add constraint presentations_brand_fk
    foreign key (account_id, brand_id, ingredient_id) references public.brands (account_id, id, ingredient_id);

create index presentations_brand_idx on public.presentations (account_id, brand_id);

-- -----------------------------------------------------------------------------
-- Validaciones
-- -----------------------------------------------------------------------------

create function private.check_ingredient_fields(p_name text, p_dimension text, p_notes text)
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
  if p_notes is not null and char_length(p_notes) > 1000 then
    perform private.fail('NOTES_TOO_LONG', 'Las notas pueden tener hasta 1.000 caracteres.');
  end if;
end;
$$;

create function private.check_brand_fields(p_name text, p_notes text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null then
    perform private.fail('BRAND_NAME_REQUIRED', 'Ingresa el nombre de la marca. Si no tiene, escribe por ejemplo «Granel».');
  end if;
  if char_length(p_name) > 80 then
    perform private.fail('BRAND_TOO_LONG', 'La marca puede tener hasta 80 caracteres.');
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
  if p_description is not null and char_length(p_description) > 120 then
    perform private.fail('DESCRIPTION_TOO_LONG', 'La descripción puede tener hasta 120 caracteres.');
  end if;
  if p_reference_price_clp is not null and p_reference_price_clp <= 0 then
    perform private.fail('INVALID_PRICE',
      'El precio de referencia debe ser mayor que cero. Si no lo conoces, déjalo vacío.');
  end if;
end;
$$;

create function private.lock_brand(p_account_id uuid, p_brand_id uuid)
returns public.brands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.brands;
begin
  select * into v_row from public.brands
   where account_id = p_account_id and id = p_brand_id
   for update;
  if v_row.id is null then
    perform private.fail('BRAND_NOT_FOUND', 'La marca no existe.');
  end if;
  return v_row;
end;
$$;

create function private.brand_name_taken(p_account_id uuid, p_ingredient_id uuid, p_name text, p_except_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.brands
     where account_id = p_account_id
       and ingredient_id = p_ingredient_id
       and lower(name) = lower(p_name)
       and archived_at is null
       and id is distinct from p_except_id
  );
$$;

-- -----------------------------------------------------------------------------
-- RPC: ingredientes
-- -----------------------------------------------------------------------------

create function public.create_ingredient(
  p_idempotency_key uuid,
  p_name            text,
  p_dimension       text,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_notes    text := nullif(trim(p_notes), '');
  v_previous jsonb;
  v_row      public.ingredients;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_ingredient', jsonb_build_object(
    'name', v_name, 'dimension', p_dimension, 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  perform private.check_ingredient_fields(v_name, p_dimension, v_notes);
  if private.ingredient_name_taken(v_account, v_name, null) then
    perform private.fail('INGREDIENT_NAME_TAKEN', 'Ya tienes un ingrediente activo con ese nombre. Agrega la marca dentro de él.');
  end if;

  insert into public.ingredients (account_id, name, dimension, notes)
  values (v_account, v_name, p_dimension, v_notes)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'ingredient.created', 'ingredient', v_row.id, to_jsonb(v_row));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_row));
end;
$$;

create function public.update_ingredient(
  p_ingredient_id uuid,
  p_name          text,
  p_dimension     text,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_notes    text := nullif(trim(p_notes), '');
  v_before   public.ingredients;
  v_after    public.ingredients;
begin
  v_before := private.lock_ingredient(v_account, p_ingredient_id);
  perform private.check_ingredient_fields(v_name, p_dimension, v_notes);

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
     set name = v_name, dimension = p_dimension, notes = v_notes
   where account_id = v_account and id = p_ingredient_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'ingredient.updated', 'ingredient', p_ingredient_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: marcas
-- -----------------------------------------------------------------------------

create function public.create_brand(
  p_idempotency_key uuid,
  p_ingredient_id   uuid,
  p_name            text,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account    uuid := private.require_account_id();
  v_name       text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_notes      text := nullif(trim(p_notes), '');
  v_previous   jsonb;
  v_ingredient public.ingredients;
  v_row        public.brands;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_brand', jsonb_build_object(
    'ingredient_id', p_ingredient_id, 'name', v_name, 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  v_ingredient := private.lock_ingredient(v_account, p_ingredient_id);
  if v_ingredient.archived_at is not null then
    perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo para agregarle marcas.');
  end if;
  perform private.check_brand_fields(v_name, v_notes);
  if private.brand_name_taken(v_account, p_ingredient_id, v_name, null) then
    perform private.fail('BRAND_NAME_TAKEN', 'Este ingrediente ya tiene una marca activa con ese nombre.');
  end if;

  insert into public.brands (account_id, ingredient_id, name, notes)
  values (v_account, p_ingredient_id, v_name, v_notes)
  returning * into v_row;

  perform private.audit(v_account, 'owner', 'brand.created', 'brand', v_row.id, to_jsonb(v_row));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_row));
end;
$$;

create function public.update_brand(p_brand_id uuid, p_name text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_name    text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_notes   text := nullif(trim(p_notes), '');
  v_before  public.brands;
  v_after   public.brands;
begin
  v_before := private.lock_brand(v_account, p_brand_id);
  perform private.check_brand_fields(v_name, v_notes);
  if v_before.archived_at is null and private.brand_name_taken(v_account, v_before.ingredient_id, v_name, p_brand_id) then
    perform private.fail('BRAND_NAME_TAKEN', 'Este ingrediente ya tiene una marca activa con ese nombre.');
  end if;

  update public.brands
     set name = v_name, notes = v_notes
   where account_id = v_account and id = p_brand_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'brand.updated', 'brand', p_brand_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

create function public.set_brand_archived(p_brand_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.brands;
  v_after   public.brands;
begin
  v_before := private.lock_brand(v_account, p_brand_id);
  if p_archived is null then
    perform private.fail('INVALID_ARCHIVE_FLAG', 'Indica si quieres archivar o restaurar la marca.');
  end if;
  if (v_before.archived_at is not null) = p_archived then
    return to_jsonb(v_before);
  end if;
  if not p_archived then
    if exists (select 1 from public.ingredients
                where account_id = v_account and id = v_before.ingredient_id and archived_at is not null) then
      perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo primero.');
    end if;
    if private.brand_name_taken(v_account, v_before.ingredient_id, v_before.name, p_brand_id) then
      perform private.fail('BRAND_NAME_TAKEN',
        'Ya hay una marca activa con ese nombre en este ingrediente. Cambia el nombre de una antes de restaurarla.');
    end if;
  end if;

  update public.brands
     set archived_at = case when p_archived then now() end
   where account_id = v_account and id = p_brand_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', case when p_archived then 'brand.archived' else 'brand.restored' end,
    'brand', p_brand_id);
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: presentaciones (envase y tamaño de una marca)
-- -----------------------------------------------------------------------------

create function public.create_presentation(
  p_idempotency_key      uuid,
  p_brand_id             uuid,
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
  v_previous    jsonb;
  v_brand       public.brands;
  v_ingredient  public.ingredients;
  v_row         public.presentations;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_presentation', jsonb_build_object(
    'brand_id', p_brand_id, 'quantity', p_quantity, 'unit', p_unit, 'description', v_description,
    'reference_price_clp', p_reference_price_clp, 'reference_price_date', p_reference_price_date));
  if v_previous is not null then
    return v_previous;
  end if;

  v_brand := private.lock_brand(v_account, p_brand_id);
  v_ingredient := private.lock_ingredient(v_account, v_brand.ingredient_id);
  if v_ingredient.archived_at is not null then
    perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo para agregarle presentaciones.');
  end if;
  if v_brand.archived_at is not null then
    perform private.fail('BRAND_ARCHIVED', 'La marca está archivada. Restáurala para agregarle presentaciones.');
  end if;
  perform private.check_presentation_fields(v_ingredient.dimension, p_quantity, p_unit, v_description,
    p_reference_price_clp);

  -- Un precio de referencia siempre lleva fecha; si no se indica, es la de hoy en la zona del negocio.
  if p_reference_price_clp is not null then
    v_price_date := coalesce(p_reference_price_date,
      (now() at time zone (select timezone from public.accounts where id = v_account))::date);
  end if;

  insert into public.presentations (account_id, ingredient_id, brand_id, description, quantity, unit,
                                    reference_price_clp, reference_price_date)
  values (v_account, v_brand.ingredient_id, p_brand_id, v_description, p_quantity, p_unit,
          p_reference_price_clp, v_price_date)
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

-- Restaurar una presentación exige que su marca y su ingrediente estén activos.
create or replace function public.set_presentation_archived(p_presentation_id uuid, p_archived boolean)
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
  if not p_archived then
    if exists (select 1 from public.ingredients
                where account_id = v_account and id = v_before.ingredient_id and archived_at is not null) then
      perform private.fail('INGREDIENT_ARCHIVED', 'El ingrediente está archivado. Restáuralo primero.');
    end if;
    if exists (select 1 from public.brands
                where account_id = v_account and id = v_before.brand_id and archived_at is not null) then
      perform private.fail('BRAND_ARCHIVED', 'La marca está archivada. Restáurala primero.');
    end if;
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
-- Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function public.create_ingredient(uuid, text, text, text) from public, anon;
revoke execute on function public.update_ingredient(uuid, text, text, text) from public, anon;
revoke execute on function public.create_brand(uuid, uuid, text, text) from public, anon;
revoke execute on function public.update_brand(uuid, text, text) from public, anon;
revoke execute on function public.set_brand_archived(uuid, boolean) from public, anon;
revoke execute on function public.create_presentation(uuid, uuid, numeric, text, text, bigint, date) from public, anon;
revoke execute on function public.update_presentation(uuid, numeric, text, text, bigint, date) from public, anon;

grant execute on function public.create_ingredient(uuid, text, text, text) to authenticated;
grant execute on function public.update_ingredient(uuid, text, text, text) to authenticated;
grant execute on function public.create_brand(uuid, uuid, text, text) to authenticated;
grant execute on function public.update_brand(uuid, text, text) to authenticated;
grant execute on function public.set_brand_archived(uuid, boolean) to authenticated;
grant execute on function public.create_presentation(uuid, uuid, numeric, text, text, bigint, date) to authenticated;
grant execute on function public.update_presentation(uuid, numeric, text, text, bigint, date) to authenticated;
