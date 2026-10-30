import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { accountApi, authApi, sessionApi, type Account, type AppSession } from '../db/api';
import { friendlyError } from '../shared/errors';
import { describeDevice, getDeviceToken } from './deviceToken';

export type { Account };

export type AuthPhase =
  | 'loading'
  | 'signed_out'
  | 'needs_device_verification'
  | 'ready'
  | 'admin'
  | 'account_unavailable'
  | 'error';

/** Motivo por el que se cerró la sesión; se muestra en la pantalla de ingreso. */
export type SignOutReason = 'logout' | 'idle_timeout' | 'session_ended';

type AuthContextValue = {
  phase: AuthPhase;
  session: AppSession | null;
  account: Account | null;
  errorMessage: string | null;
  signOutReason: SignOutReason | null;
  /** Vuelve a consultar el estado de la sesión en el servidor (p. ej. tras verificar el dispositivo). */
  recheck: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  signOut: (reason?: SignOutReason) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);

  useEffect(() => {
    void authApi.getSession().then((s) => {
      setSession(s);
      setSessionLoaded(true);
    });
    return authApi.onSessionChange((s) => {
      setSession(s);
      setSessionLoaded(true);
    });
  }, []);

  const sessionId = session?.sessionId ?? null;

  const loadAccount = useCallback(async () => {
    const { data, error } = await accountApi.getMine();
    if (error) throw error;
    setAccount(data);
  }, []);

  const signOut = useCallback(async (reason: SignOutReason = 'logout') => {
    // Primero se invalida la sesión en el servidor; luego se borra localmente.
    await sessionApi.end(reason === 'idle_timeout' ? 'idle_timeout' : 'logout').catch(() => undefined);
    await authApi.signOutLocal();
    setAccount(null);
    setSignOutReason(reason === 'logout' ? null : reason);
    setPhase('signed_out');
  }, []);

  const recheck = useCallback(async () => {
    if (!sessionId) {
      setAccount(null);
      setPhase('signed_out');
      return;
    }
    try {
      const { data: result, error } = await sessionApi.begin(getDeviceToken(), describeDevice());
      if (error || !result) throw error;

      if (result.status === 'session_ended') {
        await signOut('session_ended');
        return;
      }
      if (result.status === 'account_unavailable') {
        setPhase('account_unavailable');
        return;
      }
      if (result.status === 'verification_required') {
        setPhase('needs_device_verification');
        return;
      }
      if (result.kind === 'admin') {
        setPhase('admin');
        return;
      }
      await loadAccount();
      setSignOutReason(null);
      setPhase('ready');
    } catch (error) {
      setErrorMessage(friendlyError(error));
      setPhase('error');
    }
  }, [sessionId, loadAccount, signOut]);

  // Solo cuando cambia la sesión (no en cada renovación del token).
  useEffect(() => {
    if (sessionLoaded) void recheck();
  }, [sessionLoaded, recheck]);

  const value = useMemo(
    () => ({ phase, session, account, errorMessage, signOutReason, recheck, refreshAccount: loadAccount, signOut }),
    [phase, session, account, errorMessage, signOutReason, recheck, loadAccount, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
