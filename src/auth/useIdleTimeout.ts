import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionApi } from '../db/api';
import { HEARTBEAT_INTERVAL_MS, LAST_ACTIVITY_KEY, idleState, remainingMs, shouldSendHeartbeat, type IdleState } from './idle';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

function readLastActivity(): number {
  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : Date.now();
}

/**
 * Controla el cierre por inactividad. Solo la interacción real del usuario cuenta como actividad
 * (un temporizador o una pestaña abierta no la renuevan). La última actividad se comparte entre
 * pestañas mediante localStorage, y se informa al servidor como máximo cada 2 minutos.
 */
export function useIdleTimeout(timeoutMinutes: number, onExpire: () => void) {
  const [state, setState] = useState<IdleState>('active');
  const [remaining, setRemaining] = useState(timeoutMinutes * 60_000);
  const lastHeartbeat = useRef(0);
  const expired = useRef(false);

  const registerActivity = useCallback(() => {
    if (expired.current) return;
    const now = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    if (shouldSendHeartbeat(now, lastHeartbeat.current, HEARTBEAT_INTERVAL_MS)) {
      lastHeartbeat.current = now;
      void sessionApi.touch().then((status) => {
        if (status === 'ended' && !expired.current) {
          expired.current = true;
          onExpire();
        }
      });
    }
  }, [onExpire]);

  useEffect(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    expired.current = false;
    lastHeartbeat.current = 0;
    registerActivity();

    let throttle = 0;
    const handler = () => {
      const now = Date.now();
      if (now - throttle < 5_000) return;
      throttle = now;
      // Durante el aviso no se renueva automáticamente: el usuario debe confirmar.
      if (idleState(now, readLastActivity(), timeoutMinutes) === 'warning') return;
      registerActivity();
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    const tick = () => {
      const now = Date.now();
      const last = readLastActivity();
      const next = idleState(now, last, timeoutMinutes);
      setState(next);
      setRemaining(remainingMs(now, last, timeoutMinutes));
      if (next === 'expired' && !expired.current) {
        expired.current = true;
        onExpire();
      }
    };
    const interval = window.setInterval(tick, 1_000);
    tick();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
      window.clearInterval(interval);
    };
  }, [timeoutMinutes, onExpire, registerActivity]);

  /** El usuario confirma que sigue trabajando desde el aviso. */
  const stayActive = useCallback(() => {
    lastHeartbeat.current = 0;
    registerActivity();
    setState('active');
  }, [registerActivity]);

  return { state, remainingMs: remaining, stayActive };
}
