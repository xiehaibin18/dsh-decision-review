import { MESSAGES, type ResolveText, type Translate } from '../src/client/messages.js'
import type { PreviewLanguage } from './scenes.js'

export function previewLocale(language: PreviewLanguage): { t: Translate; resolveText: ResolveText } {
  return {
    t: (key, params = {}) =>
      MESSAGES[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)),
    resolveText: (text) => (typeof text === 'string' ? text : (text[language] ?? text.en ?? '')),
  }
}
