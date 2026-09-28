/**
 * Mise en page des romans (EPUB) : thèmes, polices, feuille injectée dans
 * chaque chapitre — pur, testé (`frontend/test/epubStyle.test.ts`). Les URL
 * des polices embarquées sont fournies par l'appelant (`epubFonts.ts`, propre
 * à Vite) : ce module reste exécutable hors navigateur.
 */
import type { TextFont, TextSettings, TextTheme } from '../../types/reader'

export interface ReaderTheme {
  background: string
  color: string
  link: string
  /** Fond sombre : commandes et barre d'état en clair. */
  dark: boolean
}

/** Couleurs des thèmes de lecture : fond, texte, liens. */
export const THEMES: Record<TextTheme, ReaderTheme> = {
  // Sombre : le fond de l'application, doux pour les écrans LCD.
  dark: { background: '#09090b', color: '#e4e4e7', link: '#c4b5fd', dark: true },
  // Noir pur : les pixels OLED s'éteignent, la batterie dure plus longtemps.
  black: { background: '#000000', color: '#e8e6e1', link: '#ffc46b', dark: true },
  sepia: { background: '#f4ecd8', color: '#5b4636', link: '#8a5a2b', dark: false },
  light: { background: '#fbfaf7', color: '#1b1b1f', link: '#5b3fd6', dark: false },
  // Nuit profonde : fond bleu nuit, texte ambré, lumière bleue réduite.
  night: { background: '#0a0e1a', color: '#c9b48f', link: '#e0a95c', dark: true },
}

/** Ordre de présentation dans les réglages. */
export const THEME_ORDER: readonly TextTheme[] = ['dark', 'black', 'sepia', 'light', 'night']
export const FONT_ORDER: readonly TextFont[] = ['serif', 'merriweather', 'sans', 'inter', 'roboto', 'dyslexic']

export const FONT_STACKS: Record<TextFont, string> = {
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif", // i18n-ignore
  merriweather: "'Merriweather', Georgia, 'Times New Roman', serif", // i18n-ignore
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", // i18n-ignore
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", // i18n-ignore
  roboto: "'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif", // i18n-ignore
  dyslexic: "'OpenDyslexic', system-ui, sans-serif", // i18n-ignore
}

/** Une police embarquée : famille CSS et fichiers woff2 par graisse / style. */
export interface EmbeddedFont {
  family: string
  faces: { weight: 400 | 700; style: 'normal' | 'italic'; url: string }[]
}

/**
 * Règles `@font-face` en URL absolues : la feuille est injectée dans l'iframe
 * du chapitre (document `about:srcdoc`), où une URL relative ne résoudrait pas.
 */
export function fontFaceRules(fonts: readonly EmbeddedFont[], baseUrl: string): string {
  return fonts
    .flatMap((font) =>
      font.faces.map(
        (face) =>
          `@font-face { font-family: '${font.family}'; font-style: ${face.style}; font-weight: ${face.weight}; font-display: swap; src: url('${new URL(face.url, baseUrl).href}') format('woff2'); }`,
      ),
    )
    .join('\n')
}

/** Feuille injectée dans chaque chapitre : nos réglages priment sur ceux du livre. */
export function readerCss(settings: TextSettings, fontFaces: string): string {
  const theme = THEMES[settings.theme] ?? THEMES.dark
  const family = FONT_STACKS[settings.font] ?? FONT_STACKS.serif
  return `
${fontFaces}
html, body {
  background: ${theme.background} !important;
  color: ${theme.color} !important;
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}
body { font-size: ${settings.fontSize}% !important; line-height: ${settings.lineHeight} !important; font-family: ${family} !important; }
p, li, blockquote, dd, dt, span, div, em, strong, i, b, small, h1, h2, h3, h4, h5, h6 { font-family: inherit !important; line-height: inherit !important; color: inherit !important; background-color: transparent !important; }
a, a * { color: ${theme.link} !important; }
img, svg, video { max-width: 100% !important; height: auto !important; }
::selection { background: transparent !important; }
`
}
