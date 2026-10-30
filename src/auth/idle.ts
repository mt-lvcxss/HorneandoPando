/** Minutos de inactividad antes de cerrar la sesión (el servidor aplica el mismo límite). */
export const IDLE_TIMEOUT_MINUTES = { owner: 60, admin: 30 } as const;

/** Minutos antes del cierre en que se avisa al usuario. */
export const IDLE_WARNING_MINUTES = 5;

/** Frecuencia máxima con que se informa actividad al servidor. */
export const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

export const LAST_ACTIVITY_KEY = 'hp:last-activity';

export type IdleState = 'active' | 'warning' | 'expired';

export function idleState(now: number, lastActivity: number, timeoutMinutes: number, warningMinutes = IDLE_WARNING_MINUTES): IdleState {
  const elapsed = now - lastActivity;
  const timeout = timeoutMinutes * 60_000;
  if (elapsed >= timeout) return 'expired';
  if (elapsed >= timeout - warningMinutes * 60_000) return 'warning';
  return 'active';
}

/** Milisegundos que quedan antes del cierre (nunca negativo). */
export function remainingMs(now: number, lastActivity: number, timeoutMinutes: number): number {
  return Math.max(0, lastActivity + timeoutMinutes * 60_000 - now);
}

export function shouldSendHeartbeat(now: number, lastHeartbeat: number, interval = HEARTBEAT_INTERVAL_MS): boolean {
  return now - lastHeartbeat >= interval;
}
