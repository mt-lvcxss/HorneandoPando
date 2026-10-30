export type AppConfig = { supabaseUrl: string; supabaseKey: string; appUrl: string };

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

/** Valida la configuración pública. Rechaza claves secretas por si se pegan por error. */
export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const appUrl = (env.VITE_APP_URL?.trim() || 'http://localhost:5173').replace(/\/$/, '');

  const isCloudUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl);
  const isLocalUrl = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(supabaseUrl);
  if (!isCloudUrl && !isLocalUrl) {
    problems.push('VITE_SUPABASE_URL falta o no tiene el formato https://<proyecto>.supabase.co');
  }
  if (!supabaseKey) {
    problems.push('Falta VITE_SUPABASE_PUBLISHABLE_KEY');
  } else if (supabaseKey.startsWith('sb_secret_') || looksLikeServiceRoleJwt(supabaseKey)) {
    problems.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY contiene una clave SECRETA. Usa la clave publicable y rota la secreta en Supabase.',
    );
  }

  return problems.length ? { ok: false, problems } : { ok: true, config: { supabaseUrl, supabaseKey, appUrl } };
}

function looksLikeServiceRoleJwt(key: string): boolean {
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}
