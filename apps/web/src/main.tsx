import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, ThemeProvider, ToastProvider } from './lib/hooks';
import { ToastViewport } from './components/Toasts';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/tokens.css';
import './styles/light.css';
import './styles/base.css';
import './styles/components.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
              <ToastViewport />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
