import { useState, useEffect } from "react";
import {
  getLocale,
  setLocale,
  locales,
  overwriteGetLocale,
  extractLocaleFromCookie,
} from "@/paraglide/runtime";
import * as m from "@/paraglide/messages";

type AvailableLanguageTag = (typeof locales)[number];

function isAvailableLanguageTag(value: string | null | undefined): value is AvailableLanguageTag {
  return Boolean(value && locales.includes(value as AvailableLanguageTag));
}

function resolvePreferredLocale(): AvailableLanguageTag {
  if (typeof window !== "undefined") {
    const pathLang = window.location.pathname.replace(/^\//, "").split("/")[0];
    if (isAvailableLanguageTag(pathLang)) return pathLang;

    const savedLang = localStorage.getItem("lang");
    if (isAvailableLanguageTag(savedLang)) return savedLang;

    const browserLang = navigator.language;
    const matchedLang = locales.find((tag) => browserLang.startsWith(tag));
    if (matchedLang) return matchedLang;
  }

  const cookieLang = extractLocaleFromCookie();
  if (isAvailableLanguageTag(cookieLang)) return cookieLang;

  return "en";
}

function applyLocale(lang: AvailableLanguageTag) {
  setLocale(lang, { reload: false });
  cachedLocale = lang;

  if (typeof window !== "undefined") {
    localStorage.setItem("lang", lang);
    document.title = `${m.app_title()} - ${m.app_subtitle()}`;
  }
}

// Locale 缓存：避免每次 i18n 调用都读取 cookie
let cachedLocale: AvailableLanguageTag | null = null;
overwriteGetLocale(() => {
  if (cachedLocale === null) {
    cachedLocale = resolvePreferredLocale();
  }
  return cachedLocale;
});

export function useLanguage() {
  const [activeLang, setActiveLang] = useState<AvailableLanguageTag>(() => getLocale());

  // Initialize language on mount
  useEffect(() => {
    const lang = resolvePreferredLocale();
    applyLocale(lang);
    setActiveLang(lang);
  }, []);

  const handleLanguageChange = (newLang: AvailableLanguageTag) => {
    applyLocale(newLang);
    setActiveLang(newLang);
  };

  return { activeLang, handleLanguageChange };
}

export type { AvailableLanguageTag };
