/**
 * SonicSwarm React Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SonicSwarmProvider } from './SonicSwarmContext';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <SonicSwarmProvider>
      <App />
    </SonicSwarmProvider>
  </React.StrictMode>
);