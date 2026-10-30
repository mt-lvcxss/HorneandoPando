-- =============================================================================
-- Etapa 3.4 · Valores recomendados para el precio sugerido (D-025)
--   * Porcentaje sobre el costo: 20 % por defecto.
--   * Valor fijo sobre el costo: $5.000 por defecto.
-- Cada negocio puede cambiar sus valores recomendados; en cada simulación se pueden editar.
-- =============================================================================

alter table public.account_settings
  add column pricing_percentage numeric not null default 20
    check (pricing_percentage >= 0 and pricing_percentage <= 1000),
  add column pricing_fixed_clp bigint not null default 5000
    check (pricing_fixed_clp >= 0);

drop function public.update_operation_settings(boolean, text);

create function public.update_operation_settings(
  p_finished_goods_tracking     boolean,
  p_charge_distribution_default text,
  p_pricing_percentage          numeric,
  p_pricing_fixed_clp           bigint
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
  if p_pricing_percentage is null or p_pricing_percentage < 0 or p_pricing_percentage > 1000 then
    perform private.fail('INVALID_PRICING_PERCENTAGE', 'El porcentaje recomendado debe estar entre 0 y 1.000.');
  end if;
  if p_pricing_fixed_clp is null or p_pricing_fixed_clp < 0 then
    perform private.fail('INVALID_PRICING_FIXED', 'El valor fijo recomendado no puede ser negativo.');
  end if;

  select * into v_before from public.account_settings where account_id = v_account for update;

  update public.account_settings
     set finished_goods_tracking = p_finished_goods_tracking,
         charge_distribution_default = p_charge_distribution_default,
         pricing_percentage = p_pricing_percentage,
         pricing_fixed_clp = p_pricing_fixed_clp
   where account_id = v_account
  returning * into v_after;

  perform private.audit(v_account, 'owner', 'settings.updated', 'account', v_account,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  return to_jsonb(v_after);
end;
$$;

revoke execute on function public.update_operation_settings(boolean, text, numeric, bigint) from public, anon;
grant execute on function public.update_operation_settings(boolean, text, numeric, bigint) to authenticated;
