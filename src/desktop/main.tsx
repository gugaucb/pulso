import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { DesktopPanel } from './DesktopPanel';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopPanel />
  </StrictMode>,
);
