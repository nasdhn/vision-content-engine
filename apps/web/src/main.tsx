import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Vision Content Engine</h1>
      <p>Phase 0 — environnement local initialisé.</p>
    </main>
  </StrictMode>,
);
