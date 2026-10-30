-- =============================================================================
-- Etapa 3.1 · Ajustes al catálogo pedidos por el usuario (D-019)
--   * La categoría del ingrediente es obligatoria y se reutiliza sin duplicados por mayúsculas.
--   * Se elimina el stock mínimo: la app muestra siempre la cantidad disponible y solo avisa
--     cuando un ingrediente se agota (subetapa 3.2).
--   * Se elimina el criterio de costo de reposición (global y por ingrediente).
-- =============================================================================

drop function public.create_ingredient(uuid, text, text, text, numeric, text, text);
drop function public.update_ingredient(uuid, text, text, text, numeric, text, text);
drop function public.update_operation_settings(boolean, text, text);
drop function private.check_ingredient_fields(text, text, text, numeric, text, text);

-- Ingredientes creados antes de este ajuste sin categoría (solo datos de prueba): se marcan de forma
-- explícita para que el usuario los reclasifique; no se adivina una categoría.
update public.ingredients set category = 'Sin categoría' where category is null;

alter table public.ingredients
  drop column min_stock,
  drop column replacement_cost_criterion,
  alter column category set not null;

alter table public.account_settings drop column replacement_cost_criterion;

create index ingredients_category_idx on public.ingredients (account_id, lower(category));

-- -----------------------------------------------------------------------------
-- Validaciones
-- -----------------------------------------------------------------------------

create function private.check_ingredient_fields(p_name text, p_dimension text, p_category text, p_notes text)
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
  if p_category is null then
    perform private.fail('CATEGORY_REQUIRED', 'Elige o escribe la categoría del ingrediente.');
  end if;
  if char_length(p_category) > 60 then
    perform private.fail('CATEGORY_TOO_LONG', 'La categoría puede tener hasta 60 caracteres.');
  end if;
  if p_dimension is null or p_dimension not in ('mass', 'volume', 'count') then
    perform private.fail('INVALID_DIMENSION', 'Elige si el ingrediente se mide en peso, volumen o unidades.');
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    perform private.fail('NOTES_TOO_LONG', 'Las notas pueden tener hasta 1.000 caracteres.');
  end if;
end;
$$;

-- Limpia espacios y, si la cuenta ya usa la misma categoría con otras mayúsculas, conserva la
-- forma existente ("harinas" → "Harinas").
create function private.normalize_category(p_account_id uuid, p_category text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select i.category from public.ingredients i
      where i.account_id = p_account_id
        and lower(i.category) = lower(regexp_replace(trim(p_category), '\s+', ' ', 'g'))
      order by i.created_at
      limit 1),
    nullif(regexp_replace(trim(p_category), '\s+', ' ', 'g'), ''));
$$;

-- -----------------------------------------------------------------------------
-- RPC: ingredientes
-- -----------------------------------------------------------------------------

create function public.create_ingredient(
  p_idempotency_key uuid,
  p_name            text,
  p_dimension       text,
  p_category        text,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(trim(p_name), '');
  v_category text := private.normalize_category(v_account, p_category);
  v_notes    text := nullif(trim(p_notes), '');
  v_previous jsonb;
  v_row      public.ingredients;
begin
  v_previous := private.idem_begin(v_account, p_idempotency_key, 'create_ingredient', jsonb_build_object(
    'name', v_name, 'dimension', p_dimension, 'category', lower(v_category), 'notes', v_notes));
  if v_previous is not null then
    return v_previous;
  end if;

  perform private.check_ingredient_fields(v_name, p_dimension, v_category, v_notes);
  if private.ingredient_name_taken(v_account, v_name, null) then
    perform private.fail('INGREDIENT_NAME_TAKEN', 'Ya tienes un ingrediente activo con ese nombre.');
  end if;

  insert into public.ingredients (account_id, name, category, dimension, notes)
  values (v_account, v_name, v_category, p_dimension, v_notes)
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
  p_category      text,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  uuid := private.require_account_id();
  v_name     text := nullif(trim(p_name), '');
  v_category text := private.normalize_category(v_account, p_category);
  v_notes    text := nullif(trim(p_notes), '');
  v_before   public.ingredients;
  v_after    public.ingredients;
begin
  v_before := private.lock_ingredient(v_account, p_ingredient_id);
  perform private.check_ingredient_fields(v_name, p_dimension, v_category, v_notes);

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
         notes = v_notes
   where account_id = v_account and id = p_ingredient_id
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'ingredient.updated', 'ingredient', p_ingredient_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  perform private.mark_business_activity(v_account);
  return to_jsonb(v_after);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: configuración operacional
-- -----------------------------------------------------------------------------

create function public.update_operation_settings(
  p_finished_goods_tracking     boolean,
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
  if p_charge_distribution_default is null or p_charge_distribution_default not in ('by_value', 'by_quantity') then
    perform private.fail('INVALID_DISTRIBUTION_CRITERION', 'El criterio de distribución de cargos no es válido.');
  end if;

  select * into v_before from public.account_settings where account_id = v_account for update;

  update public.account_settings
     set finished_goods_tracking = p_finished_goods_tracking,
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

revoke execute on function public.create_ingredient(uuid, text, text, text, text) from public, anon;
revoke execute on function public.update_ingredient(uuid, text, text, text, text) from public, anon;
revoke execute on function public.update_operation_settings(boolean, text) from public, anon;

grant execute on function public.create_ingredient(uuid, text, text, text, text) to authenticated;
grant execute on function public.update_ingredient(uuid, text, text, text, text) to authenticated;
grant execute on function public.update_operation_settings(boolean, text) to authenticated;
