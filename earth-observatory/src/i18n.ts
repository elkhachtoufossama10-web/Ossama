import { useSyncExternalStore } from 'react';

export type Lang = 'ar' | 'en';
let lang: Lang = (() => {
  try { return (localStorage.getItem('eo.lang') as Lang) || 'ar'; } catch { return 'ar'; }
})();
const subs = new Set<() => void>();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('eo.lang', l); } catch { /* storage unavailable */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  subs.forEach((f) => f());
}
export const getLang = () => lang;
export function useLang() {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => lang);
}
/** Inline bilingual string: L('عربي', 'English'). Components re-render on language change via useLang(). */
export const L = (ar: string, en: string) => (lang === 'ar' ? ar : en);
export const locale = () => (lang === 'ar' ? 'ar-MA-u-nu-latn' : 'en-GB');
