/**
 * Formato y lectura de números en convención chilena (punto de miles, coma decimal).
 * Las cantidades se guardan sin redondeo (D-008); aquí solo se limita lo que se muestra.
 */

const quantityFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 6 });
const clpFormat = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

export function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return quantityFormat.format(Number(value));
}

export function formatCLP(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Sin dato';
  return clpFormat.format(Number(value));
}

/**
 * Lee un número escrito por el usuario: "2,5", "2.5", "1.000,5" o "1.000".
 * Con coma, los puntos son separadores de miles. Sin coma, "1.000" (grupos de 3) también es mil;
 * cualquier otro punto es decimal. Devuelve null si el texto está vacío o no es un número.
 */
export function parseDecimal(text: string): number | null {
  let s = text.trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Importe en pesos enteros: acepta "$18.990" o "18990". Rechaza decimales. */
export function parseCLP(text: string): number | null {
  const s = text.trim().replace(/[$\s.]/g, '');
  if (!s || !/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Muestra una cantidad para un campo editable (coma decimal, sin separador de miles). */
export function quantityToInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace('.', ',');
}

/** Fecha de calendario (YYYY-MM-DD) tal como se guardó, sin conversiones de zona horaria. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** Fecha y hora de un instante (timestamptz) en la zona horaria del negocio (D-013). */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
