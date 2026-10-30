#!/usr/bin/env node
/**
 * HERRAMIENTA DE DESARROLLO — solo para el proyecto de PRUEBAS.
 *
 * Emite un código de verificación de dispositivo para la sesión pendiente más reciente de un
 * usuario y lo muestra en la terminal. Sirve para usar la app en localhost cuando el correo
 * (Resend) todavía no está configurado o no hay dominio verificado.
 *
 * Usa la clave secreta de .env.test.local, que ya da acceso total al proyecto de pruebas:
 * no debilita la seguridad de producción, donde esta clave nunca debe estar en el equipo.
 *
 *   npm run codigo-dispositivo -- correo@ejemplo.cl
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Uso: npm run codigo-dispositivo -- correo@ejemplo.cl');
  process.exit(1);
}

const env = loadEnv('test', process.cwd(), 'TEST_');
const url = env.TEST_SUPABASE_URL;
const secret = env.TEST_SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('Falta .env.test.local (TEST_SUPABASE_URL y TEST_SUPABASE_SECRET_KEY). Ejecuta: npm run configurar');
  process.exit(1);
}

const frontendEnv = loadEnv('development', process.cwd(), 'VITE_');
if (frontendEnv.VITE_SUPABASE_URL && frontendEnv.VITE_SUPABASE_URL !== url) {
  console.error('La app (.env.local) apunta a un proyecto distinto del de pruebas. Esta herramienta solo opera en pruebas.');
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

let userId = null;
for (let page = 1; !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error('No se pudo consultar usuarios:', error.message);
    process.exit(1);
  }
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  if (data.users.length < 200) break;
}
if (!userId) {
  console.error('No existe un usuario con ese correo en el proyecto de pruebas.');
  process.exit(1);
}

const { data, error } = await admin.rpc('issue_device_challenge', { p_user_id: userId, p_session_id: null });
if (error) {
  console.error('No se pudo emitir el código:', error.message);
  process.exit(1);
}

const messages = {
  no_session: 'No hay una sesión esperando verificación. Inicia sesión en la app primero.',
  not_required: 'La sesión ya está verificada.',
  rate_limited: 'Se alcanzó el límite de 5 códigos por hora para este usuario.',
};
if (data.status !== 'issued') {
  console.log(messages[data.status] ?? `Estado: ${data.status}`);
  process.exit(data.status === 'not_required' ? 0 : 1);
}

console.log(`\nCódigo de verificación: ${data.code}  (vence en 10 minutos, un solo uso)\n`);
