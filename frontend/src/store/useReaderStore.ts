import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BookKind } from '../types/book'
import type {
  ChapterLanguage,
  ImageQuality,
  ReaderLayout,
  ReadingDirection,
  SpreadMode,
  TextSettings,
} from '../types/reader'

/** Réglages par œuvre gardés au plus : au-delà, les plus anciens sont oubliés. */
const MAX_PER_WORK = 300

export const TEXT_LIMITS = {
  fontSize: { min: 70, max: 220, step: 10 },
  lineHeight: { min: 1.2, max: 2.2, step: 0.1 },
  margin: { min: 0, max: 64, step: 8 },
} as const

export const DEFAULT_TEXT: TextSettings = {
  fontSize: 100,
  font: 'serif',
  lineHeight: 1.6,
  margin: 16,
  theme: 'black',
}

/** Mode par défaut : webtoon pour les œuvres coréennes et chinoises (bandes verticales), pages sinon. */
export const defaultLayout = (kind: BookKind | undefined): ReaderLayout =>
  kind === 'manhwa' || kind === 'manhua' ? 'webtoon' : 'paged'

/** Sens par défaut : japonais (droite → gauche) pour le manga, occidental sinon. */
export const defaultDirection = (kind: BookKind | undefined): ReadingDirection => (kind === 'manga' ? 'rtl' : 'ltr')

interface ReaderPrefs {
  /** Mode choisi pour une œuvre précise (sinon : défaut selon son type). */
  layoutByWork: Record<string, ReaderLayout>
  directionByWork: Record<string, ReadingDirection>
  spread: SpreadMode
  quality: ImageQuality
  /** Langue des chapitres ; `null` = celle de l'interface. */
  chapterLanguage: ChapterLanguage | null
  text: TextSettings
  /** Heure et batterie discrètes en haut de l'écran pendant la lecture. */
  showStatus: boolean
}

interface ReaderState extends ReaderPrefs {
  setLayout: (workId: string, layout: ReaderLayout) => void
  setDirection: (workId: string, direction: ReadingDirection) => void
  setSpread: (spread: SpreadMode) => void
  setQuality: (quality: ImageQuality) => void
  setChapterLanguage: (language: ChapterLanguage) => void
  setText: (change: Partial<TextSettings>) => void
  toggleStatus: () => void
}

/** Ajoute une clé en fin d'objet (ordre d'insertion = ancienneté) et borne la taille. */
function remember<V>(record: Record<string, V>, key: string, value: V): Record<string, V> {
  const next = { ...record }
  delete next[key]
  next[key] = value
  const keys = Object.keys(next)
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PER_WORK))) delete next[old]
  return next
}

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value))

/**
 * Préférences du lecteur, propres à l'appareil (un téléphone et un écran large
 * ne se lisent pas pareil) : jamais synchronisées avec le compte. La position
 * de lecture, elle, vit dans la bibliothèque et suit le compte.
 */
export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      layoutByWork: {},
      directionByWork: {},
      spread: 'auto',
      quality: 'auto',
      chapterLanguage: null,
      text: DEFAULT_TEXT,
      showStatus: true,

      setLayout: (workId, layout) => set((state) => ({ layoutByWork: remember(state.layoutByWork, workId, layout) })),
      setDirection: (workId, direction) =>
        set((state) => ({ directionByWork: remember(state.directionByWork, workId, direction) })),
      setSpread: (spread) => set({ spread }),
      setQuality: (quality) => set({ quality }),
      setChapterLanguage: (chapterLanguage) => set({ chapterLanguage }),
      setText: (change) =>
        set((state) => {
          const text = { ...state.text, ...change }
          return {
            text: {
              ...text,
              fontSize: clamp(text.fontSize, TEXT_LIMITS.fontSize),
              lineHeight: Math.round(clamp(text.lineHeight, TEXT_LIMITS.lineHeight) * 10) / 10,
              margin: clamp(text.margin, TEXT_LIMITS.margin),
            },
          }
        }),
      toggleStatus: () => set((state) => ({ showStatus: !state.showStatus })),
    }),
    {
      name: 'bookshelf:reader:v1',
      version: 1,
      partialize: (state): ReaderPrefs => ({
        layoutByWork: state.layoutByWork,
        directionByWork: state.directionByWork,
        spread: state.spread,
        quality: state.quality,
        chapterLanguage: state.chapterLanguage,
        text: state.text,
        showStatus: state.showStatus,
      }),
      // Réglages d'une ancienne version ou corrompus : on complète avec les défauts.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ReaderPrefs>
        return {
          ...current,
          ...saved,
          text: { ...DEFAULT_TEXT, ...(saved.text ?? {}) },
          layoutByWork: saved.layoutByWork ?? {},
          directionByWork: saved.directionByWork ?? {},
        }
      },
    },
  ),
)
