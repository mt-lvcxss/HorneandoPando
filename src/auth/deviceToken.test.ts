// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { describeDevice, getDeviceToken } from './deviceToken';

describe('getDeviceToken', () => {
  beforeEach(() => localStorage.clear());

  it('genera un token con el formato que exige el servidor y lo reutiliza', () => {
    const first = getDeviceToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(getDeviceToken()).toBe(first);
  });

  it('reemplaza un valor manipulado', () => {
    localStorage.setItem('hp:device-token', 'malo');
    expect(getDeviceToken()).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  });
});

describe('describeDevice', () => {
  it('describe navegadores comunes', () => {
    expect(
      describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'),
    ).toBe('Chrome en Windows');
    expect(
      describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'),
    ).toBe('Chrome en Android');
  });
});
