import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MINUTES, idleState, remainingMs, shouldSendHeartbeat } from './idle';

const MIN = 60_000;

describe('idleState', () => {
  const start = 1_000_000;

  it('emprendedor: activo hasta los 55 min, aviso entre 55 y 60, expira a los 60', () => {
    const t = IDLE_TIMEOUT_MINUTES.owner;
    expect(idleState(start + 54 * MIN, start, t)).toBe('active');
    expect(idleState(start + 55 * MIN, start, t)).toBe('warning');
    expect(idleState(start + 59 * MIN + 59_000, start, t)).toBe('warning');
    expect(idleState(start + 60 * MIN, start, t)).toBe('expired');
  });

  it('administrador: expira a los 30 minutos', () => {
    expect(idleState(start + 29 * MIN, start, IDLE_TIMEOUT_MINUTES.admin)).toBe('warning');
    expect(idleState(start + 30 * MIN, start, IDLE_TIMEOUT_MINUTES.admin)).toBe('expired');
  });

  it('el tiempo restante nunca es negativo', () => {
    expect(remainingMs(start + 10 * MIN, start, 60)).toBe(50 * MIN);
    expect(remainingMs(start + 90 * MIN, start, 60)).toBe(0);
  });
});

describe('shouldSendHeartbeat', () => {
  it('informa actividad al servidor como máximo cada 2 minutos', () => {
    expect(shouldSendHeartbeat(10 * MIN, 0)).toBe(true);
    expect(shouldSendHeartbeat(10 * MIN, 9 * MIN)).toBe(false);
    expect(shouldSendHeartbeat(10 * MIN, 8 * MIN)).toBe(true);
  });
});
