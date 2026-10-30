import { useCallback, useState } from 'react';

/**
 * Clave de idempotencia de un formulario (D-006). Se genera al abrirlo y se conserva entre
 * reintentos; solo se renueva después de una operación exitosa, para registrar otra nueva.
 */
export function useIdempotencyKey(): [key: string, renew: () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return [key, renew];
}
