const STORAGE_KEY = 'hp:device-token';

/**
 * Identificador aleatorio de este navegador. El servidor solo guarda su hash.
 * Si el usuario borra los datos del navegador, se le pedirá verificar el dispositivo otra vez.
 */
export function getDeviceToken(storage: Storage = localStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  storage.setItem(STORAGE_KEY, token);
  return token;
}

/** Descripción legible del navegador para la lista de dispositivos de confianza. */
export function describeDevice(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Navegador';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'sistema desconocido';
  return `${browser} en ${os}`;
}
