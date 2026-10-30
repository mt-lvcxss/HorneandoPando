import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig } from './env';

export const configResult = readConfig(import.meta.env);

/** Cliente único. Es null si la configuración es inválida (la app muestra una pantalla de configuración). */
export const supabase: SupabaseClient | null = configResult.ok
  ? createClient(configResult.config.supabaseUrl, configResult.config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export const appUrl = configResult.ok ? configResult.config.appUrl : 'http://localhost:5173';

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}

/** Lee el claim `session_id` del JWT (solo para detectar cambios de sesión; el servidor lo valida). */
export function sessionIdFromAccessToken(accessToken: string | undefined): string | null {
  const payload = accessToken?.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return typeof json.session_id === 'string' ? json.session_id : null;
  } catch {
    return null;
  }
}
