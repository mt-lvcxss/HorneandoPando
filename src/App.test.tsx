// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('App sin configuración', () => {
  it('muestra la pantalla de configuración en vez de datos simulados', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.resetModules();
    const { App } = await import('./App');
    render(<App />);
    expect(screen.getByText('Falta configurar la conexión')).toBeInTheDocument();
    expect(screen.getByText(/VITE_SUPABASE_URL falta/)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
