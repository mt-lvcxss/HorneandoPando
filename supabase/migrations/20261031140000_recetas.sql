-- =============================================================================
-- Etapa 3.3 · Recetas y versiones (D-024)
--
--   * Una receta tiene versiones numeradas e inmutables. Editar la formulación = crear una versión.
--   * Versión principal (reemplaza a la vigente) o alternativa (conserva la formulación base).
--   * La receta apunta a su versión vigente, que se propone por defecto y el usuario puede cambiar.
--   * Las cantidades se guardan tal como se escriben, sin redondeo. Cada línea debe poder convertirse a
--     la unidad del ingrediente (misma dimensión o equivalencia vigente al guardar).
-- =============================================================================

create table public.recipes (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts (id),
  name                text not null check (char_length(name) between 1 and 120),
  description         text check (description is null or char_length(description) <= 1000),
  current_version_id  uuid,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (account_id, id)
);

create unique index recipes_active_name_uq on public.recipes (account_id, lower(name)) where archived_at is null;

create table public.recipe_versions (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id),
  recipe_id            uuid not null,
  version_no           integer not null check (version_no >= 1),
  kind                 text not null check (kind in ('main', 'alternative')),
  label                text not null check (char_length(label) between 1 and 80),
  based_on_version_id  uuid,
  -- Rendimiento teórico: cantidad + unidad libre ("porciones", "unidades", "moldes").
  yield_quantity       numeric not null check (yield_quantity > 0),
  yield_unit           text not null check (char_length(yield_unit) between 1 and 40),
  instructions         text check (instructions is null or char_length(instructions) <= 10000),
  change_note          text check (change_note is null or char_length(change_note) <= 500),
  created_at           timestamptz not null default now(),
  unique (account_id, id),
  unique (recipe_id, version_no),
  -- Permite exigir que la versión vigente pertenezca a su receta.
  unique (account_id, id, recipe_id),
  foreign key (account_id, recipe_id) references public.recipes (account_id, id),
  foreign key (account_id, based_on_version_id) references public.recipe_versions (account_id, id)
);

alter table public.recipes
  add constraint recipes_current_version_fk
  foreign key (account_id, current_version_id, id) references public.recipe_versions (account_id, id, recipe_id)
  deferrable initially deferred;

create table public.recipe_version_items (
  account_id     uuid not null references public.accounts (id),
  version_id     uuid not null,
  line_no        smallint not null check (line_no >= 1),
  ingredient_id  uuid not null,
  quantity       numeric not null check (quantity > 0),
  unit           text not null references public.units (code),
  notes          text check (notes is null or char_length(notes) <= 300),
  primary key (version_id, line_no),
  unique (version_id, ingredient_id),
  foreign key (account_id, version_id) references public.recipe_versions (account_id, id),
  foreign key (account_id, ingredient_id) references public.ingredients (account_id, id)
);

-- Aislamiento, permisos y RLS (mismo patrón que el resto de las tablas de negocio).
do $$
declare
  t text;
begin
  foreach t in array array['recipes', 'recipe_versions', 'recipe_version_items']
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

-- Las versiones y sus líneas nunca cambian: el historial de una producción depende de ellas.
create trigger recipe_versions_immutable
  before update or delete on public.recipe_versions
  for each row execute function private.forbid_mutation();

create trigger recipe_version_items_immutable
  before update or delete on public.recipe_version_items
  for each row execute function private.forbid_mutation();

create trigger recipes_touch_updated_at
  before update on public.recipes
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function private.lock_recipe(p_account_id uuid, p_recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.recipes;
begin
  select * into v_row from public.recipes where account_id = p_account_id and id = p_recipe_id for update;
  if v_row.id is null then
    perform private.fail('RECIPE_NOT_FOUND', 'La receta no existe.');
  end if;
  return v_row;
end;
$$;

create function private.recipe_name_taken(p_account_id uuid, p_name text, p_except_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recipes
     where account_id = p_account_id and lower(name) = lower(p_name) and archived_at is null
       and id is distinct from p_except_id);
$$;

-- Valida e inserta una versión con sus líneas. La receta debe estar bloqueada por quien llama.
-- p_items: [{ingredient_id, quantity, unit, notes?}]
create function private.insert_recipe_version(
  p_account_id    uuid,
  p_recipe_id     uuid,
  p_kind          text,
  p_label         text,
  p_based_on      uuid,
  p_yield_qty     numeric,
  p_yield_unit    text,
  p_items         jsonb,
  p_instructions  text,
  p_change_note   text
)
returns public.recipe_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no          integer;
  v_version     public.recipe_versions;
  v_item        jsonb;
  v_ingredient  public.ingredients;
  v_qty         numeric;
  v_unit        text;
  v_notes       text;
  v_converted   numeric;
  v_yield_unit  text := nullif(trim(p_yield_unit), '');
  v_label       text := nullif(trim(p_label), '');
begin
  if p_kind is null or p_kind not in ('main', 'alternative') then
    perform private.fail('INVALID_VERSION_KIND', 'Elige si es una nueva versión principal o una alternativa.');
  end if;
  if p_yield_qty is null or p_yield_qty <= 0 then
    perform private.fail('INVALID_YIELD', 'El rendimiento debe ser mayor que cero.');
  end if;
  if v_yield_unit is null or char_length(v_yield_unit) > 40 then
    perform private.fail('YIELD_UNIT_REQUIRED', 'Indica en qué se mide el rendimiento (porciones, unidades, moldes…).');
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    perform private.fail('LABEL_TOO_LONG', 'El nombre de la versión puede tener hasta 80 caracteres.');
  end if;
  if p_instructions is not null and char_length(p_instructions) > 10000 then
    perform private.fail('INSTRUCTIONS_TOO_LONG', 'Las instrucciones pueden tener hasta 10.000 caracteres.');
  end if;
  if p_change_note is not null and char_length(p_change_note) > 500 then
    perform private.fail('NOTES_TOO_LONG', 'La nota del cambio puede tener hasta 500 caracteres.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('RECIPE_ITEMS_REQUIRED', 'Agrega al menos un ingrediente a la receta.');
  end if;
  if jsonb_array_length(p_items) > 100 then
    perform private.fail('TOO_MANY_ITEMS', 'Una receta puede tener hasta 100 ingredientes.');
  end if;
  if (select count(distinct i ->> 'ingredient_id') from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
    perform private.fail('DUPLICATE_INGREDIENT', 'Un ingrediente aparece dos veces. Suma las cantidades en una sola línea.');
  end if;
  if p_based_on is not null and not exists (
    select 1 from public.recipe_versions where account_id = p_account_id and id = p_based_on and recipe_id = p_recipe_id
  ) then
    perform private.fail('VERSION_NOT_FOUND', 'La versión de origen no existe en esta receta.');
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no from public.recipe_versions where recipe_id = p_recipe_id;

  insert into public.recipe_versions (account_id, recipe_id, version_no, kind, label, based_on_version_id,
                                      yield_quantity, yield_unit, instructions, change_note)
  values (p_account_id, p_recipe_id, v_no, p_kind,
          coalesce(v_label, case when p_kind = 'main' then 'Versión ' || v_no else 'Alternativa ' || v_no end),
          p_based_on, p_yield_qty, v_yield_unit, nullif(trim(p_instructions), ''), nullif(trim(p_change_note), ''))
  returning * into v_version;

  for i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_item := p_items -> i;
    select * into v_ingredient from public.ingredients
     where account_id = p_account_id and id = (v_item ->> 'ingredient_id')::uuid;
    if v_ingredient.id is null then
      perform private.fail('INGREDIENT_NOT_FOUND', format('Línea %s: el ingrediente no existe.', i + 1));
    end if;
    if v_ingredient.archived_at is not null then
      perform private.fail('INGREDIENT_ARCHIVED', format('Línea %s: %s está archivado.', i + 1, v_ingredient.name));
    end if;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_unit := v_item ->> 'unit';
    v_notes := nullif(trim(v_item ->> 'notes'), '');
    if v_qty is null or v_qty <= 0 then
      perform private.fail('INVALID_QUANTITY', format('Línea %s (%s): la cantidad debe ser mayor que cero.', i + 1, v_ingredient.name));
    end if;
    if not exists (select 1 from public.units where code = v_unit) then
      perform private.fail('INVALID_UNIT', format('Línea %s (%s): la unidad no es válida.', i + 1, v_ingredient.name));
    end if;
    select c.quantity into v_converted from private.to_ingredient_base(p_account_id, v_ingredient.id, v_qty, v_unit) c;
    if v_converted is null then
      perform private.fail('UNIT_NOT_CONVERTIBLE',
        format('Línea %s: %s se mide en otra dimensión y no tiene una equivalencia para %s. Agrégala en el ingrediente.',
               i + 1, v_ingredient.name, v_unit));
    end if;
    if v_notes is not null and char_length(v_notes) > 300 then
      perform private.fail('NOTES_TOO_LONG', format('Línea %s: la nota puede tener hasta 300 caracteres.', i + 1));
    end if;

    insert into public.recipe_version_items (account_id, version_id, line_no, ingredient_id, quantity, unit, notes)
    values (p_account_id, v_version.id, i + 1, v_ingredient.id, v_qty, v_unit, v_notes);
  end loop;

  return v_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC
-- -----------------------------------------------------------------------------

create function public.create_recipe(
  p_idempotency_key  uuid,
  p_name             text,
  p_yield_quantity   numeric,
  p_yield_unit       text,
  p_items            jsonb,
  p_description      text default null,
  p_instructions     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_desc     text := nullif(trim(p_description), '');
  v_previous jsonb;
  v_recipe   public.recipes;
  v_version  public.recipe_versions;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_recipe', jsonb_build_object(
    'name', v_name, 'yield_quantity', p_yield_quantity, 'yield_unit', p_yield_unit, 'items', p_items,
    'description', v_desc, 'instructions', p_instructions));
  if v_previous is not null then
    return v_previous;
  end if;

  if v_name is null or char_length(v_name) > 120 then
    perform private.fail('RECIPE_NAME_REQUIRED', 'Ingresa el nombre de la receta (hasta 120 caracteres).');
  end if;
  if v_desc is not null and char_length(v_desc) > 1000 then
    perform private.fail('DESCRIPTION_TOO_LONG', 'La descripción puede tener hasta 1.000 caracteres.');
  end if;
  if private.recipe_name_taken(v_account, v_name, null) then
    perform private.fail('RECIPE_NAME_TAKEN', 'Ya tienes una receta activa con ese nombre.');
  end if;

  insert into public.recipes (account_id, name, description) values (v_account, v_name, v_desc) returning * into v_recipe;
  v_version := private.insert_recipe_version(v_account, v_recipe.id, 'main', 'Versión 1', null,
    p_yield_quantity, p_yield_unit, p_items, p_instructions, null);
  update public.recipes set current_version_id = v_version.id where id = v_recipe.id returning * into v_recipe;

  perform private.audit(v_account, 'owner', 'recipe.created', 'recipe', v_recipe.id,
    jsonb_build_object('version_id', v_version.id));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_recipe));
end;
$$;

-- kind = 'main': nueva formulación de la receta (por defecto pasa a ser la vigente).
-- kind = 'alternative': variante que preserva la base (por defecto no cambia la vigente).
create function public.create_recipe_version(
  p_idempotency_key  uuid,
  p_recipe_id        uuid,
  p_kind             text,
  p_yield_quantity   numeric,
  p_yield_unit       text,
  p_items            jsonb,
  p_label            text default null,
  p_based_on         uuid default null,
  p_instructions     text default null,
  p_change_note      text default null,
  p_make_current     boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_previous jsonb;
  v_recipe   public.recipes;
  v_version  public.recipe_versions;
  v_current  boolean;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_recipe_version', jsonb_build_object(
    'recipe_id', p_recipe_id, 'kind', p_kind, 'yield_quantity', p_yield_quantity, 'yield_unit', p_yield_unit,
    'items', p_items, 'label', p_label, 'based_on', p_based_on, 'instructions', p_instructions,
    'change_note', p_change_note, 'make_current', p_make_current));
  if v_previous is not null then
    return v_previous;
  end if;

  v_recipe := private.lock_recipe(v_account, p_recipe_id);
  if v_recipe.archived_at is not null then
    perform private.fail('RECIPE_ARCHIVED', 'La receta está archivada. Restáurala para crear versiones.');
  end if;

  v_version := private.insert_recipe_version(v_account, p_recipe_id, p_kind, p_label, p_based_on,
    p_yield_quantity, p_yield_unit, p_items, p_instructions, p_change_note);

  v_current := coalesce(p_make_current, p_kind = 'main');
  if v_current then
    update public.recipes set current_version_id = v_version.id where id = p_recipe_id;
  end if;

  perform private.audit(v_account, 'owner', 'recipe.version_created', 'recipe', p_recipe_id,
    jsonb_build_object('version_id', v_version.id, 'version_no', v_version.version_no, 'kind', p_kind,
                       'made_current', v_current, 'previous_current', v_recipe.current_version_id));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_version) || jsonb_build_object('is_current', v_current));
end;
$$;

create function public.set_current_recipe_version(p_recipe_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.recipes;
  v_after   public.recipes;
begin
  v_before := private.lock_recipe(v_account, p_recipe_id);
  if not exists (select 1 from public.recipe_versions where account_id = v_account and id = p_version_id and recipe_id = p_recipe_id) then
    perform private.fail('VERSION_NOT_FOUND', 'La versión no existe en esta receta.');
  end if;
  update public.recipes set current_version_id = p_version_id where id = p_recipe_id returning * into v_after;
  perform private.audit(v_account, 'owner', 'recipe.current_version_changed', 'recipe', p_recipe_id,
    jsonb_build_object('before', v_before.current_version_id, 'after', p_version_id));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- Nombre y descripción no son parte de la formulación: se editan sin crear versión.
create function public.update_recipe(p_recipe_id uuid, p_name text, p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_name    text := nullif(regexp_replace(trim(p_name), '\s+', ' ', 'g'), '');
  v_desc    text := nullif(trim(p_description), '');
  v_before  public.recipes;
  v_after   public.recipes;
begin
  v_before := private.lock_recipe(v_account, p_recipe_id);
  if v_name is null or char_length(v_name) > 120 then
    perform private.fail('RECIPE_NAME_REQUIRED', 'Ingresa el nombre de la receta (hasta 120 caracteres).');
  end if;
  if v_desc is not null and char_length(v_desc) > 1000 then
    perform private.fail('DESCRIPTION_TOO_LONG', 'La descripción puede tener hasta 1.000 caracteres.');
  end if;
  if v_before.archived_at is null and private.recipe_name_taken(v_account, v_name, p_recipe_id) then
    perform private.fail('RECIPE_NAME_TAKEN', 'Ya tienes una receta activa con ese nombre.');
  end if;
  update public.recipes set name = v_name, description = v_desc where id = p_recipe_id returning * into v_after;
  perform private.audit(v_account, 'owner', 'recipe.updated', 'recipe', p_recipe_id,
    jsonb_build_object('before', jsonb_build_object('name', v_before.name, 'description', v_before.description),
                       'after', jsonb_build_object('name', v_after.name, 'description', v_after.description)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

create function public.set_recipe_archived(p_recipe_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := private.require_account_id();
  v_before  public.recipes;
  v_after   public.recipes;
begin
  v_before := private.lock_recipe(v_account, p_recipe_id);
  if p_archived is null then
    perform private.fail('INVALID_ARCHIVE_FLAG', 'Indica si quieres archivar o restaurar la receta.');
  end if;
  if (v_before.archived_at is not null) = p_archived then
    return to_jsonb(v_before);
  end if;
  if not p_archived and private.recipe_name_taken(v_account, v_before.name, p_recipe_id) then
    perform private.fail('RECIPE_NAME_TAKEN', 'Ya tienes una receta activa con ese nombre. Cambia uno de los nombres primero.');
  end if;
  update public.recipes set archived_at = case when p_archived then now() end where id = p_recipe_id returning * into v_after;
  perform private.audit(v_account, 'owner', case when p_archived then 'recipe.archived' else 'recipe.restored' end,
    'recipe', p_recipe_id);
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

revoke execute on function public.create_recipe(uuid, text, numeric, text, jsonb, text, text) from public, anon;
revoke execute on function public.create_recipe_version(uuid, uuid, text, numeric, text, jsonb, text, uuid, text, text, boolean) from public, anon;
revoke execute on function public.set_current_recipe_version(uuid, uuid) from public, anon;
revoke execute on function public.update_recipe(uuid, text, text) from public, anon;
revoke execute on function public.set_recipe_archived(uuid, boolean) from public, anon;

grant execute on function public.create_recipe(uuid, text, numeric, text, jsonb, text, text) to authenticated;
grant execute on function public.create_recipe_version(uuid, uuid, text, numeric, text, jsonb, text, uuid, text, text, boolean) to authenticated;
grant execute on function public.set_current_recipe_version(uuid, uuid) to authenticated;
grant execute on function public.update_recipe(uuid, text, text) to authenticated;
grant execute on function public.set_recipe_archived(uuid, boolean) to authenticated;
