import { installMobileBridge } from './installMobileBridge';
import '../styles/global';
import '../styles/mobile-parity.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';

// Install the Android platform layer before the shared App reads
// getDesktopBridge(). Without this call the import would be tree-shaken.
installMobileBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
