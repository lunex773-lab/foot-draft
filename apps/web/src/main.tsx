import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setCardAssetBase } from '@fd/ui';
import App from './App';
import './lib/noZoom';
import './styles.css';

setCardAssetBase(import.meta.env.VITE_CARD_BASE_URL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
