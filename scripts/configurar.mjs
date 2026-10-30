#!/usr/bin/env node
/**
 * Asistente de configuración: crea .env.local (frontend) y, opcionalmente, .env.test.local
 * (pruebas de integración).
 *
 * Ejecútalo en tu propia terminal (PowerShell, terminal de VS Code): así las claves no quedan
 * registradas en ningún historial compartido.
 *
 *   npm run configurar
 */
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });

// Cola de líneas: funciona igual escribiendo a mano o con respuestas en tubería.
const pending = [];
const waiting = [];
let closed = false;
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : pending.push(line)));
rl.on('close', () => {
  closed = true;
  while (waiting.length) waiting.shift()(null);
});
function nextLine() {
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

async function ask(question, { defaultValue = '', validate } = {}) {
  for (;;) {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    stdout.write(`${question}${suffix}: `);
    const line = await nextLine();
    if (line === null) {
      console.log('\nConfiguración cancelada.');
      process.exit(1);
    }
    if (!stdin.isTTY) stdout.write('\n');
    const answer = line.trim() || defaultValue;
    const problem = validate?.(answer);
    if (!problem) return answer;
    console.log(`  ✗ ${problem}`);
  }
}

const isSupabaseUrl = (v) =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v)
    ? null
    : 'Debe tener la forma https://<proyecto>.supabase.co (sin "/" al final).';

function isServiceRoleJwt(key) {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role === 'service_role';
  } catch {
    return false;
  }
}

const isPublishableKey = (v) => {
  if (!v) return 'La clave es obligatoria.';
  if (v.startsWith('sb_secret_') || isServiceRoleJwt(v)) {
    return 'Esa es una clave SECRETA. Aquí va la clave publicable (sb_publishable_... o anon).';
  }
  return null;
};

const isSecretKey = (v) =>
  v.startsWith('sb_secret_') || isServiceRoleJwt(v) ? null : 'Debe ser la clave secreta (sb_secret_... o service_role).';

const isOptionalEmail = (v) => (!v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Correo inválido.');

async function confirmOverwrite(file) {
  if (!existsSync(file)) return true;
  const answer = await ask(`${file} ya existe. ¿Reemplazarlo? (s/N)`, { defaultValue: 'N' });
  return /^s/i.test(answer);
}

console.log('\nConfiguración de la conexión con Supabase');
console.log('Datos en: panel de Supabase → Project Settings → Data API / API Keys.\n');
console.log('Recomendación: usa el proyecto de PRUEBAS para desarrollar en localhost.\n');

if (await confirmOverwrite('.env.local')) {
  const url = await ask('URL del proyecto', { validate: isSupabaseUrl });
  const key = await ask('Clave publicable', { validate: isPublishableKey });
  const name = await ask('Nombre de la aplicación', { defaultValue: 'Horneando Pando' });
  const appUrl = await ask('URL de la aplicación', { defaultValue: 'http://localhost:5173' });
  const support = await ask('Correo de soporte (opcional)', { validate: isOptionalEmail });

  writeFileSync(
    '.env.local',
    [
      '# Generado por npm run configurar. No se sube al repositorio.',
      `VITE_SUPABASE_URL=${url}`,
      `VITE_SUPABASE_PUBLISHABLE_KEY=${key}`,
      `VITE_APP_URL=${appUrl.replace(/\/$/, '')}`,
      `VITE_APP_NAME=${name}`,
      `VITE_SUPPORT_EMAIL=${support}`,
      '',
    ].join('\n'),
  );
  console.log('  ✓ .env.local creado.\n');
}

const wantsTests = await ask('¿Configurar también las pruebas de integración y la herramienta de códigos? (s/N)', {
  defaultValue: 'N',
});
if (/^s/i.test(wantsTests) && (await confirmOverwrite('.env.test.local'))) {
  console.log('\nSolo el proyecto de PRUEBAS. Nunca uses aquí la clave secreta de producción.');
  const url = await ask('URL del proyecto de pruebas', { validate: isSupabaseUrl });
  const key = await ask('Clave publicable del proyecto de pruebas', { validate: isPublishableKey });
  const secret = await ask('Clave secreta del proyecto de pruebas', { validate: isSecretKey });
  writeFileSync(
    '.env.test.local',
    [
      '# Generado por npm run configurar. SOLO proyecto de pruebas. No se sube al repositorio.',
      `TEST_SUPABASE_URL=${url}`,
      `TEST_SUPABASE_PUBLISHABLE_KEY=${key}`,
      `TEST_SUPABASE_SECRET_KEY=${secret}`,
      '',
    ].join('\n'),
  );
  console.log('  ✓ .env.test.local creado.');
}

rl.close();
console.log('\nSiguiente paso: npm run verificar\n');
