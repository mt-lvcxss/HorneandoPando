import type { ReactNode } from 'react';
import { brand } from '../../shared/brand';
import { Card } from '../../shared/ui';
import styles from './auth.module.css';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <img src="/icono.svg" alt="" />
          {brand.name}
        </div>
        <Card>
          <h1>{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}
