import { z } from 'zod';

/** Mismas reglas que supabase/config.toml: mínimo 8 caracteres, con letras y números. */
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra.')
  .regex(/[0-9]/, 'La contraseña debe incluir al menos un número.');

export const emailSchema = z.string().trim().email('Ingresa un correo válido.');

/** Devuelve el primer mensaje de error de una validación, o null si es válida. */
export function validationError<T>(schema: z.ZodType<T>, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Dato inválido.');
}
