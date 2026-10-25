import './cesiumBase';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-kufi-arabic';
import './styles.css';
import App from './App';
import { getLang, setLang } from './i18n';

setLang(getLang());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
