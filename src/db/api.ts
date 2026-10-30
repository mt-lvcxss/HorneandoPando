/**
 * Capa de acceso a datos y autenticación.
 *
 * Es el ÚNICO lugar del frontend que conoce el SDK de Supabase. Los componentes usan estas
 * funciones, de modo que migrar a otro backend (PostgREST propio, una API propia sobre PostgreSQL,
 * etc.) solo requiere reimplementar este archivo con el mismo contrato.
 * Ver docs/portabilidad-postgresql.md.
 */
import { clearAuthParamsFromAddressBar, parseAuthLink } from './authLink';
import { appUrl, requireSupabase, sessionIdFromAccessToken } from './supabase';

/** Resultado uniforme: `error` conserva el error original para traducirlo con shared/errors. */
export type Result<T> = { data: T | null; error: unknown };

export type AppSession = { sessionId: string | null; email: string | null };

export type Account = {
  id: string;
  status: 'active' | 'inactive' | 'deactivated' | 'closed';
  business_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  timezone: string;
  currency: 'CLP';
  onboarding_completed_at: string | null;
  created_at: string;
};

export type BeginSessionResult = {
  status: 'verified' | 'verification_required' | 'session_ended' | 'account_unavailable';
  kind: 'owner' | 'admin';
};

export type SendCodeStatus =
  | 'sent'
  | 'rate_limited'
  | 'not_required'
  | 'no_session'
  | 'email_failed'
  | 'email_not_configured'
  | 'error';

export type VerifyCodeResult = {
  status: 'verified' | 'invalid_code' | 'no_active_code' | 'too_many_attempts';
  remaining_attempts?: number;
};

export type BusinessProfileInput = {
  businessName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  timezone: string;
  completeOnboarding: boolean;
};

function toAppSession(session: { access_token: string; user: { email?: string | null } } | null): AppSession | null {
  if (!session) return null;
  return { sessionId: sessionIdFromAccessToken(session.access_token), email: session.user.email ?? null };
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

export const authApi = {
  async getSession(): Promise<AppSession | null> {
    const { data } = await requireSupabase().auth.getSession();
    return toAppSession(data.session);
  },

  /** Notifica cambios de sesión. No hacer llamadas a la API dentro del callback. */
  onSessionChange(callback: (session: AppSession | null) => void): () => void {
    const { data } = requireSupabase().auth.onAuthStateChange((_event, session) => callback(toAppSession(session)));
    return () => data.subscription.unsubscribe();
  },

  async signIn(email: string, password: string): Promise<Result<true>> {
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    return { data: error ? null : true, error };
  },

  async signUp(email: string, password: string): Promise<Result<true>> {
    const { error } = await requireSupabase().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${appUrl}/auth/confirmado` },
    });
    return { data: error ? null : true, error };
  },

  async requestPasswordReset(email: string): Promise<Result<true>> {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/restablecer`,
    });
    return { data: error ? null : true, error };
  },

  /**
   * Completa un enlace de correo (confirmación de registro o recuperación de contraseña).
   * Acepta los formatos de las plantillas propias y de las plantillas por defecto de Supabase.
   * Al terminar, quita los tokens de la barra de direcciones.
   */
  async completeAuthLink(url: URL, purpose: 'email' | 'recovery'): Promise<Result<true>> {
    const link = parseAuthLink(url);
    const auth = requireSupabase().auth;
    let error: unknown = null;

    switch (link.kind) {
      case 'error':
        error = { code: link.code, message: link.description ?? link.code };
        break;
      case 'missing':
        error = { code: 'link_incomplete', message: 'El enlace está incompleto.' };
        break;
      case 'token_hash':
        ({ error } = await auth.verifyOtp({ token_hash: link.tokenHash, type: purpose }));
        break;
      case 'session':
        ({ error } = await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken }));
        break;
      case 'pkce':
        ({ error } = await auth.exchangeCodeForSession(link.code));
        break;
    }

    if (link.kind !== 'missing') clearAuthParamsFromAddressBar();
    return { data: error ? null : true, error };
  },

  async updatePassword(password: string): Promise<Result<true>> {
    const { error } = await requireSupabase().auth.updateUser({ password });
    return { data: error ? null : true, error };
  },

  /** Cierra la sesión solo en este navegador. */
  async signOutLocal(): Promise<void> {
    await requireSupabase().auth.signOut({ scope: 'local' });
  },
};

// ---------------------------------------------------------------------------
// Sesión verificada (funciones del servidor)
// ---------------------------------------------------------------------------

export const sessionApi = {
  async begin(deviceToken: string, deviceLabel: string): Promise<Result<BeginSessionResult>> {
    const { data, error } = await requireSupabase().rpc('begin_session', {
      p_device_token: deviceToken,
      p_device_label: deviceLabel,
    });
    return { data: data as BeginSessionResult | null, error };
  },

  async sendDeviceCode(): Promise<SendCodeStatus> {
    const { data, error } = await requireSupabase().functions.invoke('send-device-code', { body: {} });
    if (error) return 'error';
    return (data as { status?: SendCodeStatus } | null)?.status ?? 'error';
  },

  async verifyDeviceCode(deviceToken: string, code: string): Promise<Result<VerifyCodeResult>> {
    const { data, error } = await requireSupabase().rpc('verify_device_code', {
      p_device_token: deviceToken,
      p_code: code,
    });
    return { data: data as VerifyCodeResult | null, error };
  },

  /** Informa actividad real del usuario. Devuelve 'ended' si la sesión ya venció en el servidor. */
  async touch(): Promise<'active' | 'ended' | 'unverified' | 'error'> {
    const { data, error } = await requireSupabase().rpc('touch_session');
    if (error) return 'error';
    return ((data as { status?: string } | null)?.status as 'active' | 'ended' | 'unverified') ?? 'error';
  },

  async end(reason: 'logout' | 'idle_timeout'): Promise<void> {
    await requireSupabase().rpc('end_session', { p_reason: reason });
  },
};

// ---------------------------------------------------------------------------
// Cuenta del negocio
// ---------------------------------------------------------------------------

export const accountApi = {
  /** La cuenta propia. RLS garantiza que nunca llega otra. */
  async getMine(): Promise<Result<Account>> {
    const { data, error } = await requireSupabase().from('accounts').select('*').maybeSingle();
    return { data: data as Account | null, error };
  },

  async updateProfile(input: BusinessProfileInput): Promise<Result<true>> {
    const { error } = await requireSupabase().rpc('update_business_profile', {
      p_business_name: input.businessName,
      p_contact_email: input.contactEmail,
      p_contact_phone: input.contactPhone,
      p_timezone: input.timezone,
      p_complete_onboarding: input.completeOnboarding,
    });
    return { data: error ? null : true, error };
  },
};

// ---------------------------------------------------------------------------
// Configuración operacional
// ---------------------------------------------------------------------------

export type ChargeDistribution = 'by_value' | 'by_quantity';

export type OperationSettings = {
  finished_goods_tracking: boolean;
  charge_distribution_default: ChargeDistribution;
  updated_at: string;
};

export const settingsApi = {
  async get(): Promise<Result<OperationSettings>> {
    const { data, error } = await requireSupabase().from('account_settings').select('*').maybeSingle();
    return { data: data as OperationSettings | null, error };
  },

  async update(input: Omit<OperationSettings, 'updated_at'>): Promise<Result<OperationSettings>> {
    const { data, error } = await requireSupabase().rpc('update_operation_settings', {
      p_finished_goods_tracking: input.finished_goods_tracking,
      p_charge_distribution_default: input.charge_distribution_default,
    });
    return { data: data as OperationSettings | null, error };
  },
};

// ---------------------------------------------------------------------------
// Catálogo: unidades, ingredientes, presentaciones y equivalencias
// ---------------------------------------------------------------------------

export type Dimension = 'mass' | 'volume' | 'count';

export type Unit = { code: string; dimension: Dimension; to_base: number; label: string; sort_order: number };

export type Ingredient = {
  id: string;
  name: string;
  dimension: Dimension;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Brand = {
  id: string;
  ingredient_id: string;
  name: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

export type Presentation = {
  id: string;
  ingredient_id: string;
  brand_id: string;
  description: string | null;
  quantity: number;
  unit: string;
  reference_price_clp: number | null;
  reference_price_date: string | null;
  archived_at: string | null;
  created_at: string;
};

export type Equivalence = {
  id: string;
  ingredient_id: string;
  other_quantity: number;
  other_unit: string;
  ingredient_quantity: number;
  ingredient_unit: string;
  other_dimension: Dimension;
  note: string | null;
  created_at: string;
  superseded_at: string | null;
};

export type IngredientInput = {
  name: string;
  dimension: Dimension;
  notes: string | null;
};

export type PresentationInput = {
  quantity: number;
  unit: string;
  description: string | null;
  referencePriceClp: number | null;
  referencePriceDate: string | null;
};

export type BrandInput = { name: string; notes: string | null };

export type QuantityWithUnit = { quantity: number; unit: string };

export const catalogApi = {
  async listUnits(): Promise<Result<Unit[]>> {
    const { data, error } = await requireSupabase().from('units').select('*').order('sort_order');
    return { data: data as Unit[] | null, error };
  },

  async listIngredients(): Promise<Result<Ingredient[]>> {
    const { data, error } = await requireSupabase().from('ingredients').select('*').order('name');
    return { data: data as Ingredient[] | null, error };
  },

  async getIngredient(id: string): Promise<Result<Ingredient>> {
    const { data, error } = await requireSupabase().from('ingredients').select('*').eq('id', id).maybeSingle();
    return { data: data as Ingredient | null, error };
  },

  async createIngredient(idempotencyKey: string, input: IngredientInput): Promise<Result<Ingredient>> {
    const { data, error } = await requireSupabase().rpc('create_ingredient', {
      p_idempotency_key: idempotencyKey,
      ...ingredientParams(input),
    });
    return { data: data as Ingredient | null, error };
  },

  async updateIngredient(id: string, input: IngredientInput): Promise<Result<Ingredient>> {
    const { data, error } = await requireSupabase().rpc('update_ingredient', {
      p_ingredient_id: id,
      ...ingredientParams(input),
    });
    return { data: data as Ingredient | null, error };
  },

  async setIngredientArchived(id: string, archived: boolean): Promise<Result<Ingredient>> {
    const { data, error } = await requireSupabase().rpc('set_ingredient_archived', {
      p_ingredient_id: id,
      p_archived: archived,
    });
    return { data: data as Ingredient | null, error };
  },

  async listBrands(ingredientId?: string): Promise<Result<Brand[]>> {
    let query = requireSupabase().from('brands').select('*').order('name');
    if (ingredientId) query = query.eq('ingredient_id', ingredientId);
    const { data, error } = await query;
    return { data: data as Brand[] | null, error };
  },

  async createBrand(idempotencyKey: string, ingredientId: string, input: BrandInput): Promise<Result<Brand>> {
    const { data, error } = await requireSupabase().rpc('create_brand', {
      p_idempotency_key: idempotencyKey,
      p_ingredient_id: ingredientId,
      p_name: input.name,
      p_notes: input.notes,
    });
    return { data: data as Brand | null, error };
  },

  async updateBrand(id: string, input: BrandInput): Promise<Result<Brand>> {
    const { data, error } = await requireSupabase().rpc('update_brand', {
      p_brand_id: id,
      p_name: input.name,
      p_notes: input.notes,
    });
    return { data: data as Brand | null, error };
  },

  async setBrandArchived(id: string, archived: boolean): Promise<Result<Brand>> {
    const { data, error } = await requireSupabase().rpc('set_brand_archived', { p_brand_id: id, p_archived: archived });
    return { data: data as Brand | null, error };
  },

  async listPresentations(ingredientId?: string): Promise<Result<Presentation[]>> {
    let query = requireSupabase().from('presentations').select('*').order('created_at');
    if (ingredientId) query = query.eq('ingredient_id', ingredientId);
    const { data, error } = await query;
    return { data: data as Presentation[] | null, error };
  },

  async createPresentation(idempotencyKey: string, brandId: string, input: PresentationInput): Promise<Result<Presentation>> {
    const { data, error } = await requireSupabase().rpc('create_presentation', {
      p_idempotency_key: idempotencyKey,
      p_brand_id: brandId,
      ...presentationParams(input),
    });
    return { data: data as Presentation | null, error };
  },

  async updatePresentation(id: string, input: PresentationInput): Promise<Result<Presentation>> {
    const { data, error } = await requireSupabase().rpc('update_presentation', {
      p_presentation_id: id,
      ...presentationParams(input),
    });
    return { data: data as Presentation | null, error };
  },

  async setPresentationArchived(id: string, archived: boolean): Promise<Result<Presentation>> {
    const { data, error } = await requireSupabase().rpc('set_presentation_archived', {
      p_presentation_id: id,
      p_archived: archived,
    });
    return { data: data as Presentation | null, error };
  },

  async listEquivalences(ingredientId: string): Promise<Result<Equivalence[]>> {
    const { data, error } = await requireSupabase()
      .from('ingredient_equivalences')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .order('created_at', { ascending: false });
    return { data: data as Equivalence[] | null, error };
  },

  async setEquivalence(
    idempotencyKey: string,
    ingredientId: string,
    a: QuantityWithUnit,
    b: QuantityWithUnit,
    note: string | null,
  ): Promise<Result<Equivalence>> {
    const { data, error } = await requireSupabase().rpc('set_ingredient_equivalence', {
      p_idempotency_key: idempotencyKey,
      p_ingredient_id: ingredientId,
      p_quantity_a: a.quantity,
      p_unit_a: a.unit,
      p_quantity_b: b.quantity,
      p_unit_b: b.unit,
      p_note: note,
    });
    return { data: data as Equivalence | null, error };
  },

  async retireEquivalence(id: string): Promise<Result<Equivalence>> {
    const { data, error } = await requireSupabase().rpc('retire_ingredient_equivalence', { p_equivalence_id: id });
    return { data: data as Equivalence | null, error };
  },
};

function ingredientParams(input: IngredientInput) {
  return {
    p_name: input.name,
    p_dimension: input.dimension,
    p_notes: input.notes,
  };
}

function presentationParams(input: PresentationInput) {
  return {
    p_quantity: input.quantity,
    p_unit: input.unit,
    p_description: input.description,
    p_reference_price_clp: input.referencePriceClp,
    p_reference_price_date: input.referencePriceDate,
  };
}

// ---------------------------------------------------------------------------
// Compras e inventario (cantidades de inventario en unidad base: g, ml o unidad)
// ---------------------------------------------------------------------------

export type ChargeTreatment = 'separate_expense' | 'distributed';
export type PartialRule = 'proportional' | 'first_use';

export type PurchaseLineInput = {
  presentation_id: string;
  container_count: number;
  /** En la unidad de la presentación; si se omite, el contenido nominal. */
  content_per_container?: number;
  list_total_clp?: number | null;
  paid_total_clp: number;
};

export type PurchaseChargeInput = {
  description: string;
  amount_clp: number;
  treatment: ChargeTreatment;
  method?: ChargeDistribution | null;
  partial_rule?: PartialRule | null;
};

export type PurchasePreview = {
  lines: {
    line_no: number;
    ingredient_id: string;
    ingredient_name: string;
    brand_name: string;
    container_count: number;
    content_per_container: number;
    content_unit: string;
    incorporated_quantity: number;
    paid_total_clp: number;
    unit_cost: number;
    charge_unit_cost: number;
    charge_first_use_clp: number;
  }[];
  charges: {
    charge_no: number;
    description: string;
    amount_clp: number;
    treatment: ChargeTreatment;
    method: ChargeDistribution | null;
    partial_rule: PartialRule | null;
    allocations: number[] | null;
  }[];
  paid_total_clp: number;
  distributed_charges_clp: number;
  separate_charges_clp: number;
};

export type Purchase = {
  id: string;
  purchased_on: string;
  reference: string | null;
  notes: string | null;
  pending_verification: boolean;
  verified_at: string | null;
  created_at: string;
};

export type PurchaseLine = {
  id: string;
  purchase_id: string;
  line_no: number;
  ingredient_id: string;
  brand_id: string;
  presentation_id: string;
  container_count: number;
  content_per_container: number;
  content_unit: string;
  incorporated_quantity: number;
  list_total_clp: number | null;
  paid_total_clp: number;
};

export type PurchaseCharge = {
  id: string;
  charge_no: number;
  description: string;
  amount_clp: number;
  treatment: ChargeTreatment;
  method: ChargeDistribution | null;
  partial_rule: PartialRule | null;
};

export type ChargeAllocation = { charge_id: string; purchase_line_id: string; amount_clp: number };

export type PurchaseSummary = Purchase & {
  purchase_lines: { paid_total_clp: number }[];
  purchase_charges: { amount_clp: number }[];
};

export type CostStatus = 'known' | 'provisional' | 'unknown';

export type Container = {
  id: string;
  ingredient_id: string;
  brand_id: string;
  presentation_id: string;
  source: 'purchase' | 'manual_entry';
  purchase_line_id: string | null;
  received_on: string;
  initial_quantity: number;
  /** Cantidad realmente recibida (inicial ± correcciones de recepción); base del costo unitario. */
  received_quantity: number;
  balance: number;
  unit_cost: number | null;
  cost_status: CostStatus;
  charge_unit_cost: number;
  charge_first_use_clp: number;
  opened_at: string | null;
  created_at: string;
};

export type MovementKind =
  | 'purchase'
  | 'manual_entry'
  | 'adjustment'
  | 'waste'
  | 'supplier_return'
  | 'receipt_correction'
  | 'reversal'
  | 'production_consumption';

export type Movement = {
  id: string;
  container_id: string;
  ingredient_id: string;
  kind: MovementKind;
  quantity: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  reference: string | null;
  operation_type: string;
  reverses_movement_id: string | null;
  created_at: string;
};

export type IngredientStock = {
  ingredient_id: string;
  available: number;
  containers_with_stock: number;
  open_containers: number;
};

export type StockAlert = { id: string; ingredient_id: string; opened_at: string; resolved_at: string | null };

export type ManualEntryInput = {
  presentationId: string;
  containerCount: number;
  /** En la unidad de la presentación. */
  quantityPerContainer: number;
  receivedOn: string;
  totalCostClp: number | null;
  costIsProvisional: boolean;
  opened: boolean;
  reason: string | null;
};

export type ContainerMovementKind = 'adjustment' | 'waste' | 'supplier_return' | 'receipt_correction';

export type CountLineInput = { container_id: string; expected_balance: number; counted_quantity: number };

export const purchasesApi = {
  async list(): Promise<Result<PurchaseSummary[]>> {
    const { data, error } = await requireSupabase()
      .from('purchases')
      .select('*, purchase_lines(paid_total_clp), purchase_charges(amount_clp)')
      .order('purchased_on', { ascending: false })
      .order('created_at', { ascending: false });
    return { data: data as PurchaseSummary[] | null, error };
  },

  async get(
    id: string,
  ): Promise<Result<{ purchase: Purchase; lines: PurchaseLine[]; charges: PurchaseCharge[]; allocations: ChargeAllocation[] }>> {
    const sb = requireSupabase();
    const [p, l, c] = await Promise.all([
      sb.from('purchases').select('*').eq('id', id).maybeSingle(),
      sb.from('purchase_lines').select('*').eq('purchase_id', id).order('line_no'),
      sb.from('purchase_charges').select('*').eq('purchase_id', id).order('charge_no'),
    ]);
    const error = p.error ?? l.error ?? c.error;
    if (error || !p.data) return { data: null, error };
    const chargeIds = (c.data ?? []).map((x) => (x as PurchaseCharge).id);
    const a = chargeIds.length
      ? await sb.from('purchase_charge_allocations').select('*').in('charge_id', chargeIds)
      : { data: [], error: null };
    if (a.error) return { data: null, error: a.error };
    return {
      data: {
        purchase: p.data as Purchase,
        lines: (l.data ?? []) as PurchaseLine[],
        charges: (c.data ?? []) as PurchaseCharge[],
        allocations: (a.data ?? []) as ChargeAllocation[],
      },
      error: null,
    };
  },

  async preview(lines: PurchaseLineInput[], charges: PurchaseChargeInput[]): Promise<Result<PurchasePreview>> {
    const { data, error } = await requireSupabase().rpc('preview_purchase', { p_lines: lines, p_charges: charges });
    return { data: data as PurchasePreview | null, error };
  },

  async confirm(
    idempotencyKey: string,
    input: {
      purchasedOn: string;
      lines: PurchaseLineInput[];
      charges: PurchaseChargeInput[];
      reference: string | null;
      pendingVerification: boolean;
      notes: string | null;
    },
  ): Promise<Result<Purchase>> {
    const { data, error } = await requireSupabase().rpc('confirm_purchase', {
      p_idempotency_key: idempotencyKey,
      p_purchased_on: input.purchasedOn,
      p_lines: input.lines,
      p_charges: input.charges,
      p_reference: input.reference,
      p_pending_verification: input.pendingVerification,
      p_notes: input.notes,
    });
    return { data: data as Purchase | null, error };
  },

  async setVerified(id: string): Promise<Result<Purchase>> {
    const { data, error } = await requireSupabase().rpc('set_purchase_verified', { p_purchase_id: id });
    return { data: data as Purchase | null, error };
  },
};

export const inventoryApi = {
  async listStock(): Promise<Result<IngredientStock[]>> {
    const { data, error } = await requireSupabase().from('ingredient_stock').select('*');
    return { data: data as IngredientStock[] | null, error };
  },

  async listOpenAlerts(): Promise<Result<StockAlert[]>> {
    const { data, error } = await requireSupabase().from('stock_alerts').select('*').is('resolved_at', null).order('opened_at');
    return { data: data as StockAlert[] | null, error };
  },

  async listContainers(ingredientId: string): Promise<Result<Container[]>> {
    const { data, error } = await requireSupabase()
      .from('containers')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .order('received_on')
      .order('created_at');
    return { data: data as Container[] | null, error };
  },

  async listMovements(ingredientId: string, limit = 200): Promise<Result<Movement[]>> {
    const { data, error } = await requireSupabase()
      .from('inventory_movements')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data: data as Movement[] | null, error };
  },

  async registerManualEntry(idempotencyKey: string, input: ManualEntryInput): Promise<Result<true>> {
    const { error } = await requireSupabase().rpc('register_manual_entry', {
      p_idempotency_key: idempotencyKey,
      p_presentation_id: input.presentationId,
      p_container_count: input.containerCount,
      p_quantity_per_container: input.quantityPerContainer,
      p_received_on: input.receivedOn,
      p_total_cost_clp: input.totalCostClp,
      p_cost_is_provisional: input.costIsProvisional,
      p_opened: input.opened,
      p_reason: input.reason,
    });
    return { data: error ? null : true, error };
  },

  /** quantity: saldo correcto (ajuste), cantidad que sale (merma/devolución) o diferencia con signo (corrección). */
  async registerMovement(
    idempotencyKey: string,
    input: {
      containerId: string;
      kind: ContainerMovementKind;
      quantity: number;
      reason: string | null;
      reference: string | null;
      expectedBalance: number | null;
    },
  ): Promise<Result<Movement>> {
    const { data, error } = await requireSupabase().rpc('register_container_movement', {
      p_idempotency_key: idempotencyKey,
      p_container_id: input.containerId,
      p_kind: input.kind,
      p_quantity: input.quantity,
      p_reason: input.reason,
      p_reference: input.reference,
      p_expected_balance: input.expectedBalance,
    });
    return { data: data as Movement | null, error };
  },

  async reverseMovement(idempotencyKey: string, movementId: string, reason: string | null): Promise<Result<Movement>> {
    const { data, error } = await requireSupabase().rpc('reverse_movement', {
      p_idempotency_key: idempotencyKey,
      p_movement_id: movementId,
      p_reason: reason,
    });
    return { data: data as Movement | null, error };
  },

  async confirmCount(idempotencyKey: string, lines: CountLineInput[], notes: string | null): Promise<Result<{ adjusted: number }>> {
    const { data, error } = await requireSupabase().rpc('confirm_inventory_count', {
      p_idempotency_key: idempotencyKey,
      p_lines: lines,
      p_notes: notes,
    });
    return { data: data as { adjusted: number } | null, error };
  },
};
