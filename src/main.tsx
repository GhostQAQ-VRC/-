import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global';
import App from './App';

// Surface CSP violations in the console during development and packaging checks.
window.addEventListener('securitypolicyviolation', (event) => {
  console.warn('[csp]', event.violatedDirective, event.blockedURI);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
