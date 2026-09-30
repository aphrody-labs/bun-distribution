'use client'

import i18n, { type Resource } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import LocalStorageBackend from 'i18next-localstorage-backend'
import { initReactI18next } from 'react-i18next'

import enUS from '@aphrody/koharu-ui/locales/en-US/translation.json'
import esES from '@aphrody/koharu-ui/locales/es-ES/translation.json'
import jaJP from '@aphrody/koharu-ui/locales/ja-JP/translation.json'
import koKR from '@aphrody/koharu-ui/locales/ko-KR/translation.json'
import ptBR from '@aphrody/koharu-ui/locales/pt-BR/translation.json'
import ruRU from '@aphrody/koharu-ui/locales/ru-RU/translation.json'
import trTR from '@aphrody/koharu-ui/locales/tr-TR/translation.json'
import zhCN from '@aphrody/koharu-ui/locales/zh-CN/translation.json'
import zhTW from '@aphrody/koharu-ui/locales/zh-TW/translation.json'

export const resources = {
  'en-US': { translation: enUS },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  'ja-JP': { translation: jaJP },
  'ru-RU': { translation: ruRU },
  'es-ES': { translation: esES },
  'tr-TR': { translation: trTR },
  'ko-KR': { translation: koKR },
  'pt-BR': { translation: ptBR },
} satisfies Resource

export type SupportedLanguage = keyof typeof resources

export const supportedLanguages = Object.keys(resources) as SupportedLanguage[]

i18n
  .use(LocalStorageBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: supportedLanguages,
    fallbackLng: 'en-US',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    react: {
      useSuspense: false,
    },
  })

export default i18n
