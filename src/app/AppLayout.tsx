import { useCallback, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { IDLE_TIMEOUT_MINUTES } from '../auth/idle';
import { useIdleTimeout } from '../auth/useIdleTimeout';
import { brand } from '../shared/brand';
import { useOnlineStatus } from '../shared/useOnlineStatus';
import { Button, Dialog } from '../shared/ui';
import styles from './layout.module.css';

// Solo se listan módulos que ya funcionan. Los siguientes se agregan al completarse cada etapa.
const NAV_ITEMS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/ingredientes', label: 'Ingredientes', end: false },
  { to: '/compras', label: 'Compras', end: false },
  { to: '/inventario', label: 'Inventario', end: false },
  { to: '/recetas', label: 'Recetas', end: false },
  { to: '/simulaciones', label: 'Simulaciones', end: false },
  { to: '/configuracion/negocio', label: 'Datos del negocio', end: false },
  { to: '/configuracion/operacion', label: 'Configuración', end: false },
];

export function AppLayout() {
  const { account, signOut } = useAuth();
  const online = useOnlineStatus();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(location.pathname);

  // Cierra el menú móvil al navegar.
  if (openedAt !== location.pathname) {
    setOpenedAt(location.pathname);
    setMenuOpen(false);
  }

  const expire = useCallback(() => void signOut('idle_timeout'), [signOut]);
  const idle = useIdleTimeout(IDLE_TIMEOUT_MINUTES.owner, expire);
  const minutesLeft = Math.max(1, Math.ceil(idle.remainingMs / 60_000));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <img src="/icono.svg" alt="" />
          {brand.name}
        </span>
        <button className={styles.menuButton} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? 'Cerrar menú' : 'Menú'}
        </button>
      </header>

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <div>
          <span className={styles.brand}>
            <img src="/icono.svg" alt="" />
            {brand.name}
          </span>
          <span className={styles.businessName}>{account?.business_name ?? 'Negocio sin nombre'}</span>
        </div>
        <nav className={styles.nav} aria-label="Módulos">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={online ? styles.connection : styles.offline} role="status">
            {online ? 'Conectado' : 'Sin conexión: no se pueden registrar operaciones'}
          </span>
          <Button variant="secondary" onClick={() => void signOut('logout')}>
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>

      {idle.state === 'warning' && (
        <Dialog
          title="¿Sigues ahí?"
          actions={
            <>
              <Button variant="secondary" onClick={() => void signOut('logout')}>
                Cerrar sesión
              </Button>
              <Button onClick={idle.stayActive}>Seguir trabajando</Button>
            </>
          }
        >
          <p>
            Por seguridad cerraremos tu sesión en {minutesLeft} minuto(s) por inactividad. Los datos ya guardados no se
            pierden.
          </p>
        </Dialog>
      )}
    </div>
  );
}
