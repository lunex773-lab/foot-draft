import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CardsPreview from './pages/CardsPreview';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardsPreview />
  </StrictMode>,
);
