/**
 * Identidad del producto. Se configura por variables de entorno para poder publicar la misma
 * aplicación con otro nombre (venta, marca blanca) sin modificar el código.
 */
export const brand = {
  name: import.meta.env.VITE_APP_NAME?.trim() || 'Horneando Pando',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL?.trim() || null,
};
