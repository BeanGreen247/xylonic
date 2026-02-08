import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App';

const container = document.getElementById('root');
const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Clear localStorage on development start (unless SKIP_DEV_CLEAR is set)
if (process.env.NODE_ENV === 'development' && !process.env.SKIP_DEV_CLEAR) {
  localStorage.clear();


}  console.log('Development mode: localStorage cleared for clean testing');// }