import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { brand } from './shared/brand';
import './shared/styles/global.css';

document.title = brand.name;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
