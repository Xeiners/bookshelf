import type { MdManga, MdTag } from '../src/modules/manga/mangadex.client.js'

/** Tags minimaux : un genre traduit, un thème traduit, un format (jamais affiché). */
const tag = (id: string, name: string, group: MdTag['attributes']['group']): MdTag => ({
  id,
  attributes: { name: { en: name }, group },
})

export const TAGS: MdTag[] = [
  tag('00000000-0000-4000-8000-000000000001', 'Action', 'genre'),
  tag('00000000-0000-4000-8000-000000000002', 'Slice of Life', 'genre'),
  tag('00000000-0000-4000-8000-000000000003', 'Martial Arts', 'theme'),
  tag('00000000-0000-4000-8000-000000000004', 'Long Strip', 'format'),
]

function manga(id: string, overrides: Partial<MdManga['attributes']>, originalLanguage = 'ja'): MdManga {
  return {
    id,
    attributes: {
      title: {},
      altTitles: [],
      description: {},
      originalLanguage,
      lastChapter: '120',
      status: 'ongoing',
      year: 2020,
      contentRating: 'safe',
      tags: [TAGS[0]!, TAGS[2]!, TAGS[3]!],
      availableTranslatedLanguages: ['fr', 'en'],
      ...overrides,
    },
    relationships: [
      { id: 'author-1', type: 'author', attributes: { name: 'Auteur Test (テスト)' } },
      { id: 'cover-1', type: 'cover_art', attributes: { fileName: 'cover.jpg' } },
    ],
  }
}

/** Traduit dans les deux langues : titre alternatif FR, titre principal EN. */
export const BILINGUAL = manga('11111111-1111-4111-8111-111111111111', {
  title: { en: 'The Blade Road' },
  altTitles: [{ 'ja-ro': 'Katana no Michi' }, { fr: 'La Voie du sabre' }],
  description: {
    en: 'A young swordsman walks the **blade road**.\n\n---\n[Official](https://example.com)',
    fr: 'Un jeune épéiste suit la **voie du sabre**.',
  },
})

/** Anglais seulement : en français, titre ET résumé doivent se replier sur l'anglais. */
export const ENGLISH_ONLY = manga(
  '22222222-2222-4222-8222-222222222222',
  {
    title: { 'ko-ro': 'Na Honjaman' },
    altTitles: [{ en: 'Only I Rise' }],
    description: { en: 'Hunters, gates and a strange system.' },
    tags: [TAGS[1]!],
    availableTranslatedLanguages: ['en'],
  },
  'ko',
)

/** Ni français ni anglais : titre romanisé, résumé vide — jamais d'erreur. */
export const NO_TRANSLATION = manga('33333333-3333-4333-8333-333333333333', {
  title: { 'ja-ro': 'Mushoku no Hoshi' },
  altTitles: [{ ja: '無職の星' }],
  description: {},
  lastChapter: null,
})

export const ALL_MANGAS = [BILINGUAL, ENGLISH_ONLY, NO_TRANSLATION]
