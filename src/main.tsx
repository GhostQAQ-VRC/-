import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/hero.css';
import './styles/timeline.css';
import './styles/dialog.css';
import './styles/footer.css';
import './styles/responsive.css';
import './styles/themes.css';
import './styles/layouts.css';
import './styles/appearance-panel.css';
import './styles/effects.css';
import './styles/light-theme.css';
import './styles/desktop.css';
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
