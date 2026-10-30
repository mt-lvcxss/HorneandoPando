// Edge Function: envía el código de verificación de nuevo dispositivo.
//
// Flujo:
//   1. Verifica el JWT del usuario (sesión de Supabase válida).
//   2. Llama a public.issue_device_challenge (solo service_role), que genera el código,
//      guarda únicamente su hash y aplica el límite de 5 códigos por hora.
//   3. Envía el código por correo mediante Resend.
//
// Nunca devuelve el código al navegador ni lo registra en logs.
//
// Secretos requeridos (supabase secrets set ...):
//   RESEND_API_KEY, EMAIL_FROM, ALLOWED_ORIGINS
// Opcional: APP_NAME (nombre visible del producto; por defecto "Horneando Pando").
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.
import { createClient } from 'npm:@supabase/supabase-js@2';

const appName = Deno.env.get('APP_NAME')?.trim() || 'Horneando Pando';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowedOrigins.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
}

function emailHtml(code: string) {
  return `<!doctype html>
<html lang="es"><body style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
  <h2>Código para verificar este dispositivo</h2>
  <p>Alguien inició sesión en tu cuenta de ${appName} desde un navegador o dispositivo nuevo.</p>
  <p style="font-size: 28px; letter-spacing: 6px; font-weight: bold;">${code}</p>
  <p>El código vence en 10 minutos y solo se puede usar una vez.</p>
  <p>Si no fuiste tú, no compartas este código y cambia tu contraseña.</p>
</body></html>`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ status: 'method_not_allowed' }, 405, origin);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ status: 'unauthorized' }, 401, origin);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // getUser valida la firma y vigencia del token contra Supabase Auth.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ status: 'unauthorized' }, 401, origin);

  const sessionId = decodeJwtPayload(token).session_id;
  if (typeof sessionId !== 'string') return json({ status: 'unauthorized' }, 401, origin);

  const { data, error } = await admin.rpc('issue_device_challenge', {
    p_user_id: userData.user.id,
    p_session_id: sessionId,
  });
  if (error) {
    console.error('issue_device_challenge falló', error.code);
    return json({ status: 'error' }, 500, origin);
  }

  const result = data as { status: string; code?: string; email?: string };
  if (result.status !== 'issued') return json({ status: result.status }, 200, origin);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!resendKey || !from) {
    console.error('Faltan RESEND_API_KEY o EMAIL_FROM');
    return json({ status: 'email_not_configured' }, 500, origin);
  }

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [result.email],
      subject: `Tu código de verificación de ${appName}`,
      html: emailHtml(result.code!),
    }),
  });

  if (!send.ok) {
    // No se registra el cuerpo (podría incluir datos del destinatario).
    console.error('Resend rechazó el envío', send.status);
    return json({ status: 'email_failed' }, 502, origin);
  }

  return json({ status: 'sent' }, 200, origin);
});
