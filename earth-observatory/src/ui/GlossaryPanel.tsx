import { L, useLang } from '../i18n';
import { GLOSSARY } from './glossary';

export default function GlossaryPanel() {
  const lang = useLang();
  return (
    <div className="panel-body">
      <h2>{L('المصطلحات', 'Glossary')}</h2>
      <dl className="glossary">
        {Object.entries(GLOSSARY).map(([k, g]) => {
          const [t, d] = lang === 'ar' ? g.ar : g.en;
          return <div key={k}><dt>{t}</dt><dd>{d}</dd></div>;
        })}
      </dl>
    </div>
  );
}
