import React, { createContext, useContext, useState } from 'react';
import { resources, Lang, Translations } from './translations';

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: keyof Translations, params?: Record<string, any>) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('node_lang') as Lang;
    return resources[saved] ? saved : 'en';
  });

  const setLang = (newLang: Lang) => {
    localStorage.setItem('node_lang', newLang);
    setLangState(newLang);
  };

  const t = (key: keyof Translations, params?: Record<string, any>): string => {
    let str = resources[lang][key] || resources['en'][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
      });
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useTranslation must be used within LanguageProvider');
  return context;
}
