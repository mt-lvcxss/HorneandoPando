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
