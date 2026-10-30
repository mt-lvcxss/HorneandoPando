#!/usr/bin/env node
/**
 * Diagnóstico de la conexión con Supabase. No muestra claves ni modifica datos.
 *
 *   npm run verificar
 */
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), 'VITE_');
const url = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, hint) => {
  failures++;
  console.log(`  ✗ ${msg}`);
  if (hint) console.log(`      → ${hint}`);
};
const warn = (msg, hint) => {
  console.log(`  ! ${msg}`);
  if (hint) console.log(`      → ${hint}`);
};

async function request(path, init = {}) {
  try {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* respuesta sin JSON */
    }
    return { status: res.status, body };
  } catch (error) {
    return { status: 0, body: null, error };
  }
}

console.log('\nDiagnóstico de conexión\n');

if (!url || !key) {
  fail('Falta .env.local o está incompleto', 'Ejecuta: npm run configurar');
  process.exit(1);
}
ok(`Proyecto configurado: ${url}`);

const health = await request('/auth/v1/health');
if (health.status === 200) ok('Supabase responde (Auth disponible)');
else if (health.status === 0) {
  fail('No hay conexión con Supabase', 'Revisa tu conexión a Internet y la URL. Si el proyecto estuvo inactivo, reactívalo en el panel.');
  process.exit(1);
} else if (health.status === 401) {
  fail('La clave publicable fue rechazada', 'Copia nuevamente la clave publicable desde el panel.');
  process.exit(1);
} else fail(`Auth respondió con estado ${health.status}`);

const settings = await request('/auth/v1/settings');
if (settings.body && typeof settings.body.mailer_autoconfirm === 'boolean') {
  if (settings.body.mailer_autoconfirm) {
    fail('La confirmación de correo está DESACTIVADA', 'Authentication → Providers → Email → activar "Confirm email".');
  } else ok('Confirmación de correo obligatoria activada');
}

// Si las migraciones están aplicadas, la función existe pero el rol anónimo no puede ejecutarla.
const rpc = await request('/rest/v1/rpc/begin_session', { method: 'POST', body: JSON.stringify({}) });
if (rpc.body?.code === 'PGRST202' || rpc.status === 404) {
  fail('Las migraciones no están aplicadas', 'Ejecuta: npx supabase link --project-ref <ref>  y luego  npx supabase db push');
} else if (rpc.status === 401 || rpc.status === 403 || rpc.body?.code === '42501') {
  ok('Migraciones aplicadas y funciones protegidas contra acceso anónimo');
} else {
  fail(`Respuesta inesperada al comprobar las migraciones (estado ${rpc.status})`, 'Revisa que la clave sea la publicable.');
}

const accounts = await request('/rest/v1/accounts?select=id&limit=1');
if (accounts.status === 200 && Array.isArray(accounts.body) && accounts.body.length > 0) {
  fail('¡El acceso anónimo puede leer cuentas!', 'Detén el uso y revisa las políticas RLS: esto es un fallo crítico.');
} else if (accounts.status === 404) {
  // Ya informado por la comprobación de migraciones.
} else ok('El acceso anónimo no puede leer datos de negocio');

const fn = await request('/functions/v1/send-device-code', { method: 'POST', body: '{}' });
if (fn.status === 401) ok('Función de envío de códigos desplegada');
else if (fn.status === 404) {
  warn(
    'La función send-device-code no está desplegada',
    'Sin ella, usa "npm run codigo-dispositivo -- <correo>" en desarrollo. Despliegue: npm run functions:deploy',
  );
} else warn(`La función send-device-code respondió con estado ${fn.status}`);

console.log(failures ? `\n${failures} problema(s) por resolver.\n` : '\nTodo listo. Inicia la aplicación con: npm run dev\n');
process.exit(failures ? 1 : 0);
