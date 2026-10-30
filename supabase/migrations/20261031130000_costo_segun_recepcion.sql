-- =============================================================================
-- Etapa 3.2 · El costo de un envase se reparte sobre lo que realmente llegó (D-022)
--
-- Una corrección de recepción (o su reversión) cambia la cantidad recibida del envase y
-- recalcula su costo por unidad desde los datos de origen de la compra:
--   costo unitario          = (pagado de la línea / n° de envases) / cantidad recibida
--   costo de cargos por uso = (cargos proporcionales asignados / n° de envases) / cantidad recibida
-- Se calcula siempre desde el origen (no multiplicando el valor anterior) para no acumular redondeos.
-- Los consumos ya registrados conservan el costo con que se valoraron (subetapa 3.5).
-- =============================================================================

-- Los recálculos de costo también pasan por una marca de sesión, igual que los saldos.
create or replace function private.guard_container_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - 'balance' - 'opened_at' - 'received_quantity' - 'unit_cost' - 'charge_unit_cost')
        <> (to_jsonb(old) - 'balance' - 'opened_at' - 'received_quantity' - 'unit_cost' - 'charge_unit_cost') then
    perform private.fail('IMMUTABLE_RECORD', 'Los datos de un envase no se modifican. Registra un movimiento.');
  end if;
  if (new.balance is distinct from old.balance or new.opened_at is distinct from old.opened_at)
     and coalesce(current_setting('app.inventory_movement', true), '') <> 'on' then
    perform private.fail('BALANCE_DIRECT_UPDATE', 'El saldo de un envase solo cambia mediante un movimiento de inventario.');
  end if;
  if (new.received_quantity is distinct from old.received_quantity
      or new.unit_cost is distinct from old.unit_cost
      or new.charge_unit_cost is distinct from old.charge_unit_cost)
     and coalesce(current_setting('app.inventory_recost', true), '') <> 'on' then
    perform private.fail('COST_DIRECT_UPDATE', 'El costo de un envase solo cambia mediante una corrección de recepción.');
  end if;
  return new;
end;
$$;

alter table public.containers add column received_quantity numeric;

-- Envases existentes: lo recibido = cantidad inicial + correcciones de recepción netas (incluidas sus reversiones).
do $$
begin
  perform set_config('app.inventory_recost', 'on', true);
  update public.containers c
     set received_quantity = c.initial_quantity + coalesce((
           select sum(m.quantity)
             from public.inventory_movements m
             left join public.inventory_movements o on o.id = m.reverses_movement_id
            where m.account_id = c.account_id and m.container_id = c.id
              and (m.kind = 'receipt_correction' or o.kind = 'receipt_correction')), 0);
  perform set_config('app.inventory_recost', 'off', true);
end;
$$;

alter table public.containers
  alter column received_quantity set not null,
  add constraint containers_received_positive check (received_quantity > 0);

-- Recalcula el costo de un envase comprado con la cantidad recibida corregida.
create function private.recost_after_receipt_change(p_account_id uuid, p_container_id uuid, p_delta numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before     public.containers;
  v_after      public.containers;
  v_received   numeric;
  v_paid_share numeric;
  v_prop_share numeric;
begin
  select * into v_before from public.containers
   where account_id = p_account_id and id = p_container_id
   for update;

  v_received := v_before.received_quantity + p_delta;
  if v_received <= 0 then
    perform private.fail('NOTHING_RECEIVED',
      'La corrección dejaría el envase sin nada recibido. Si no llegó, registra una devolución al proveedor.');
  end if;

  select l.paid_total_clp::numeric / l.container_count,
         coalesce((select sum(a.amount_clp)
                     from public.purchase_charge_allocations a
                     join public.purchase_charges ch on ch.id = a.charge_id
                    where a.purchase_line_id = l.id and ch.partial_rule = 'proportional'), 0)::numeric / l.container_count
    into v_paid_share, v_prop_share
    from public.purchase_lines l
   where l.account_id = p_account_id and l.id = v_before.purchase_line_id;

  perform set_config('app.inventory_recost', 'on', true);
  update public.containers
     set received_quantity = v_received,
         unit_cost = v_paid_share / v_received,
         charge_unit_cost = v_prop_share / v_received
   where account_id = p_account_id and id = p_container_id
  returning * into v_after;
  perform set_config('app.inventory_recost', 'off', true);

  return jsonb_build_object(
    'before', jsonb_build_object('received_quantity', v_before.received_quantity, 'unit_cost', v_before.unit_cost,
                                 'charge_unit_cost', v_before.charge_unit_cost),
    'after',  jsonb_build_object('received_quantity', v_after.received_quantity, 'unit_cost', v_after.unit_cost,
                                 'charge_unit_cost', v_after.charge_unit_cost));
end;
$$;

-- Los envases nuevos nacen con lo recibido = cantidad inicial.
create function private.default_received_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.received_quantity := coalesce(new.received_quantity, new.initial_quantity);
  return new;
end;
$$;

create trigger containers_default_received
  before insert on public.containers
  for each row execute function private.default_received_quantity();

-- -----------------------------------------------------------------------------
-- Movimientos sobre un envase: la corrección de recepción recalcula el costo
-- -----------------------------------------------------------------------------

create or replace function public.register_container_movement(
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
  v_recost   jsonb;
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

  if p_kind = 'receipt_correction' then
    v_recost := private.recost_after_receipt_change(v_account, p_container_id, v_delta);
  end if;

  perform private.audit(v_account, 'owner', 'inventory.' || p_kind, 'container', p_container_id,
    to_jsonb(v_move) || coalesce(jsonb_build_object('recost', v_recost), '{}'::jsonb));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_move));
end;
$$;

create or replace function public.reverse_movement(p_idempotency_key uuid, p_movement_id uuid, p_reason text default null)
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
  v_recost   jsonb;
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

  if v_original.kind = 'receipt_correction' then
    v_recost := private.recost_after_receipt_change(v_account, v_original.container_id, -v_original.quantity);
  end if;

  perform private.audit(v_account, 'owner', 'inventory.reversal', 'inventory_movement', p_movement_id,
    to_jsonb(v_move) || coalesce(jsonb_build_object('recost', v_recost), '{}'::jsonb));
  perform private.mark_business_activity(v_account);
  return private.idem_finish(v_account, p_idempotency_key, to_jsonb(v_move));
end;
$$;
