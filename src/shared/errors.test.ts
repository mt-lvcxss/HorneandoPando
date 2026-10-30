import { describe, expect, it } from 'vitest';
import { friendlyAuthError, friendlyError } from './errors';

describe('friendlyError', () => {
  it('traduce los códigos de negocio conocidos', () => {
    expect(friendlyError({ message: 'SESSION_NOT_VALID', code: 'P0001' })).toMatch(/Vuelve a iniciar sesión/);
  });

  it('usa el detalle en español de la base de datos para códigos nuevos', () => {
    expect(friendlyError({ message: 'NUEVO_CODIGO', code: 'P0001', details: 'Explicación en español.' })).toBe(
      'Explicación en español.',
    );
  });

  it('explica los problemas de conexión', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/conexión/);
  });

  it('nunca expone mensajes técnicos desconocidos', () => {
    expect(friendlyError({ message: 'relation "x" does not exist' })).not.toMatch(/relation/);
  });
});

describe('friendlyAuthError', () => {
  it('no revela si una cuenta existe', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Correo o contraseña incorrectos.');
  });

  it('informa límites de intentos', () => {
    expect(friendlyAuthError({ status: 429, message: 'x' })).toMatch(/Demasiados intentos/);
  });
});
