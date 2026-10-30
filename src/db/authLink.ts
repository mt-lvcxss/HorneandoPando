/**
 * Interpreta los enlaces de correo de autenticación (confirmación de registro y recuperación).
 *
 * Supabase puede generar tres formatos según la plantilla y la configuración:
 *   1. ?token_hash=...&type=...                 → plantillas propias (supabase/templates). Funciona en cualquier navegador.
 *   2. #access_token=...&refresh_token=...      → plantillas por defecto (flujo implícito): Supabase ya verificó el enlace.
 *   3. ?code=...                                → flujo PKCE: solo funciona en el navegador que pidió el correo.
 * Y en caso de error:  #error=...&error_code=otp_expired&error_description=...
 */
export type AuthLink =
  | { kind: 'token_hash'; tokenHash: string; type: string | null }
  | { kind: 'session'; accessToken: string; refreshToken: string; type: string | null }
  | { kind: 'pkce'; code: string }
  | { kind: 'error'; code: string; description: string | null }
  | { kind: 'missing' };

export function parseAuthLink(url: URL): AuthLink {
  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));

  const errorCode = fragment.get('error_code') ?? query.get('error_code') ?? fragment.get('error') ?? query.get('error');
  if (errorCode) {
    return {
      kind: 'error',
      code: errorCode,
      description: fragment.get('error_description') ?? query.get('error_description'),
    };
  }

  const tokenHash = query.get('token_hash');
  if (tokenHash) return { kind: 'token_hash', tokenHash, type: query.get('type') };

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken, type: fragment.get('type') };
  }

  const code = query.get('code');
  if (code) return { kind: 'pkce', code };

  return { kind: 'missing' };
}

/** Quita los tokens de la barra de direcciones y del historial del navegador. */
export function clearAuthParamsFromAddressBar(): void {
  window.history.replaceState(null, '', window.location.pathname);
}
