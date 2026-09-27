import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/mail.css';
import './styles/calendar.css';
import './styles/contacts.css';
import './styles/tasks.css';
import './styles/notes.css';
import './styles/settings.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
