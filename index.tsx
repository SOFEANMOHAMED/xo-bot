
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import { registerServiceWorker } from './utils/webPush';

// Global error handler for unhandled errors (e.g. from external scripts)
window.addEventListener('error', (event) => {
  if (event.filename && event.filename.includes('page-events.js')) {
    event.preventDefault();
    return;
  }
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  // Log but don't break the app
  if (process.env.NODE_ENV === 'development') {
    console.error('Unhandled promise rejection:', event.reason);
  }
  event.preventDefault();
});

// Register PWA service worker early (push notifications)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  void registerServiceWorker();
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'XOBOT_NAVIGATE' && typeof data.url === 'string') {
      window.location.href = data.url;
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
