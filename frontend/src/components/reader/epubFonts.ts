/*
 * Polices embarquées du mode texte (woff2 de @fontsource, servis par nos
 * assets : lisibles hors-ligne une fois en cache, jamais demandées à un tiers).
 * Seul l'alphabet latin, en regular / italique / gras : ce qu'utilise un roman.
 */
import dyslexicBold from '@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url'
import dyslexicRegular from '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url'
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2?url'
import interItalic from '@fontsource/inter/files/inter-latin-400-italic.woff2?url'
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url'
import merriweatherBold from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url'
import merriweatherItalic from '@fontsource/merriweather/files/merriweather-latin-400-italic.woff2?url'
import merriweatherRegular from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url'
import robotoBold from '@fontsource/roboto/files/roboto-latin-700-normal.woff2?url'
import robotoItalic from '@fontsource/roboto/files/roboto-latin-400-italic.woff2?url'
import robotoRegular from '@fontsource/roboto/files/roboto-latin-400-normal.woff2?url'
import type { EmbeddedFont } from '../../lib/reader/epubStyle'

const faces = (regular: string, italic: string | null, bold: string): EmbeddedFont['faces'] => [
  { weight: 400, style: 'normal', url: regular },
  ...(italic ? [{ weight: 400 as const, style: 'italic' as const, url: italic }] : []),
  { weight: 700, style: 'normal', url: bold },
]

// Noms de familles CSS, pas du texte d'interface.
export const EMBEDDED_FONTS: readonly EmbeddedFont[] = [
  { family: 'Merriweather', faces: faces(merriweatherRegular, merriweatherItalic, merriweatherBold) }, // i18n-ignore
  { family: 'Inter', faces: faces(interRegular, interItalic, interBold) }, // i18n-ignore
  { family: 'Roboto', faces: faces(robotoRegular, robotoItalic, robotoBold) }, // i18n-ignore
  { family: 'OpenDyslexic', faces: faces(dyslexicRegular, null, dyslexicBold) }, // i18n-ignore
]
