/** Mensajes en español para los códigos de error de negocio que lanza la base de datos. */
const MESSAGES: Record<string, string> = {
  SESSION_NOT_VALID: 'Tu sesión no está verificada o expiró. Vuelve a iniciar sesión.',
  NOT_AUTHENTICATED: 'Debes iniciar sesión.',
  EMAIL_NOT_CONFIRMED: 'Debes confirmar tu correo antes de continuar. Revisa tu bandeja de entrada.',
  INVALID_DEVICE_TOKEN: 'No se pudo identificar este navegador. Recarga la página.',
  DEVICE_MISMATCH: 'Esta sesión se inició en otro navegador. Vuelve a iniciar sesión.',
  SESSION_MISMATCH: 'La sesión no es válida. Vuelve a iniciar sesión.',
  BUSINESS_NAME_REQUIRED: 'Ingresa el nombre de tu negocio.',
  BUSINESS_NAME_TOO_LONG: 'El nombre del negocio puede tener hasta 120 caracteres.',
  INVALID_CONTACT_EMAIL: 'El correo de contacto no tiene un formato válido.',
  INVALID_CONTACT_PHONE: 'El teléfono puede tener hasta 40 caracteres.',
  INVALID_TIMEZONE: 'La zona horaria no es válida.',
  IDEMPOTENCY_KEY_REUSED: 'Esta operación ya se registró con datos distintos. Recarga el formulario.',
  IDEMPOTENCY_IN_PROGRESS: 'La operación todavía se está procesando. Espera unos segundos y revisa el resultado.',
};

type ErrorLike = { message?: string; details?: string | null; code?: string; status?: number } | null | undefined;

/** Convierte un error de Supabase/PostgREST en un mensaje entendible. */
export function friendlyError(error: unknown): string {
  const e = error as ErrorLike;
  const message = e?.message ?? '';
  const known = MESSAGES[message];
  if (known) return known;
  if (e?.code === 'P0001' && e.details) return e.details;
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return 'No hay conexión con el servidor. Revisa tu conexión a Internet e inténtalo de nuevo.';
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo; si persiste, repórtalo indicando qué estabas haciendo.';
}

/** Errores de Supabase Auth. Nunca revelan si existe una cuenta con ese correo. */
export function friendlyAuthError(error: unknown): string {
  const e = error as ErrorLike;
  switch (e?.code) {
    case 'email_not_confirmed':
      return 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada (y la carpeta de spam).';
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.';
    case 'weak_password':
      return 'La contraseña es demasiado débil. Usa al menos 8 caracteres con letras y números.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
    case 'otp_expired':
      return 'El enlace venció o ya fue utilizado. Solicita uno nuevo.';
    case 'same_password':
      return 'La nueva contraseña debe ser distinta de la anterior.';
  }
  if (e?.status === 429) return 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
  return friendlyError(error);
}
