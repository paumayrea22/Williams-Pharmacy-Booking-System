import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// Import Vercel Analytics for traffic monitoring
import { Analytics } from '@vercel/analytics/react';
// Import Vercel Speed Insights for Core Web Vitals performance tracking
import { SpeedInsights } from '@vercel/speed-insights/react';
// Import the Authentication Provider to enable global RBAC and session state
import { AuthProvider } from './context/AuthContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
    {/* Mount both telemetry components at the application root */}
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);