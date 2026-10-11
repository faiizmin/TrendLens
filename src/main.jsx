import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ClerkProvider } from '@clerk/react';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const application = publishableKey ?
  <ClerkProvider publishableKey={publishableKey}><App authEnabled /></ClerkProvider> :
  <App authEnabled={false} />;

createRoot(document.getElementById('root')).render(<React.StrictMode>{application}</React.StrictMode>);
