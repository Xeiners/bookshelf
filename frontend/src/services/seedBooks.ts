// i18n-ignore-file — données de contenu déjà bilingues (champs `fr` / `en` côte à côte).
import type { Language } from '../i18n/languages'
import type { Book, BookKind, PublicationStatus } from '../types/book'

/**
 * Jeu de secours 100 % hors-ligne, dans les deux langues.
 *
 * Utilisé uniquement si l'API est injoignable (avion, coupure, serveur arrêté).
 * Les ids sont les vrais UUID MangaDex : une œuvre enregistrée hors-ligne
 * retrouve sa fiche complète une fois la connexion revenue. Les couvertures
 * sont `null` : `BookCover` génère une couverture typographique, sans réseau.
 */
type Localized<T> = Record<Language, T>

interface Seed {
  id: string
  title: Localized<string>
  subtitle: string | null
  authors: string[]
  synopsis: Localized<string>
  categories: Localized<string[]>
  rating: number
  year: number
  kind: BookKind
  publicationStatus: PublicationStatus
  chapters: number | null
}

const SEEDS: Seed[] = [
  {
    id: 'b0b721ff-c388-4486-aa0f-c2b0bb321512',
    title: { fr: 'Frieren', en: 'Frieren: Beyond Journey’s End' },
    subtitle: 'Sousou no Frieren',
    authors: ['Yamada Kanehito', 'Abe Tsukasa'],
    synopsis: {
      fr: "Le héros et ses compagnons ont vaincu le Roi démon. Pour Frieren, une elfe qui vit des siècles, l'aventure n'a duré qu'un instant. Des années plus tard, elle reprend la route pour comprendre ceux qu'elle a côtoyés sans vraiment les connaître.",
      en: 'The hero and his companions have defeated the Demon King. For Frieren, an elf who lives for centuries, the adventure lasted only a moment. Years later, she sets out again to understand the people she travelled with without ever truly knowing them.',
    },
    categories: {
      fr: ['Aventure', 'Drame', 'Fantasy', 'Tranche de vie'],
      en: ['Adventure', 'Drama', 'Fantasy', 'Slice of Life'],
    },
    rating: 4.8,
    year: 2020,
    kind: 'manga',
    publicationStatus: 'hiatus',
    chapters: null,
  },
  {
    id: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
    title: { fr: 'Solo Leveling', en: 'Solo Leveling' },
    subtitle: 'Na Honjaman Level-Up',
    authors: ['Chugong', 'Gi So-Ryeong'],
    synopsis: {
      fr: 'Des portails relient notre monde à des donjons peuplés de monstres. Sung Jin-Woo, chasseur de rang E réputé le plus faible, survit de justesse à un donjon caché et se découvre un étrange système qui lui permet de monter en niveau.',
      en: 'Gates link our world to monster-filled dungeons. Sung Jin-Woo, an E-rank hunter known as the weakest of all, barely survives a hidden dungeon and discovers a strange system that lets him level up.',
    },
    categories: { fr: ['Action', 'Aventure', 'Fantasy'], en: ['Action', 'Adventure', 'Fantasy'] },
    rating: 4.7,
    year: 2018,
    kind: 'manhwa',
    publicationStatus: 'completed',
    chapters: 200,
  },
  {
    id: 'a77742b1-befd-49a4-bff5-1ad4e6b0ef7b',
    title: { fr: 'Chainsaw Man', en: 'Chainsaw Man' },
    subtitle: null,
    authors: ['Fujimoto Tatsuki'],
    synopsis: {
      fr: 'Criblé de dettes, Denji chasse les démons avec Pochita, un chien-tronçonneuse. Trahi et laissé pour mort, il fusionne avec lui et devient un hybride capable de faire jaillir des tronçonneuses de son corps.',
      en: 'Buried in debt, Denji hunts devils with Pochita, a chainsaw dog. Betrayed and left for dead, he merges with him and becomes a hybrid able to rip chainsaws out of his own body.',
    },
    categories: { fr: ['Action', 'Comédie', 'Horreur'], en: ['Action', 'Comedy', 'Horror'] },
    rating: 4.6,
    year: 2018,
    kind: 'manga',
    publicationStatus: 'completed',
    chapters: 232,
  },
  {
    id: '9a414441-bbad-43f1-a3a7-dc262ca790a3',
    title: { fr: 'Lecteur omniscient', en: 'Omniscient Reader' },
    subtitle: 'Jeonjijeok Dokja Sijeom',
    authors: ['sing N song', 'UMI', 'Sleepy-C'],
    synopsis: {
      fr: "Kim Dokja est le seul lecteur à avoir terminé un interminable roman en ligne. Le jour où l'histoire devient réalité, il est aussi le seul à savoir comment elle se termine, et comment y survivre.",
      en: 'Kim Dokja is the only reader who ever finished an endless web novel. The day the story becomes reality, he is also the only one who knows how it ends — and how to survive it.',
    },
    categories: { fr: ['Action', 'Aventure', 'Fantasy'], en: ['Action', 'Adventure', 'Fantasy'] },
    rating: 4.7,
    year: 2020,
    kind: 'manhwa',
    publicationStatus: 'ongoing',
    chapters: null,
  },
  {
    id: 'd8a959f7-648e-4c8d-8f23-f1f3f8e129f3',
    title: { fr: 'One-Punch Man', en: 'One-Punch Man' },
    subtitle: null,
    authors: ['ONE', 'Murata Yuusuke'],
    synopsis: {
      fr: "Saitama est devenu si fort qu'il terrasse n'importe quel adversaire d'un seul coup de poing. Le problème : plus aucun combat ne lui procure le moindre frisson.",
      en: 'Saitama has become so strong that he defeats any opponent with a single punch. The problem: no fight gives him the slightest thrill anymore.',
    },
    categories: { fr: ['Action', 'Comédie', 'Super-héros'], en: ['Action', 'Comedy', 'Superhero'] },
    rating: 4.7,
    year: 2012,
    kind: 'manga',
    publicationStatus: 'ongoing',
    chapters: null,
  },
  {
    id: '85b51b37-0ce6-4144-a19b-6b064bc2c2ae',
    title: { fr: 'Gare à la vilaine !', en: 'Beware the Villainess!' },
    subtitle: 'Geu Angnyeo reul Josimhaseyo!',
    authors: ['Berry', 'Soda Ice', 'Blue Canna'],
    synopsis: {
      fr: "Réincarnée dans le rôle de la méchante d'un roman, une jeune femme décide de ne plus subir le scénario écrit pour elle et de le retourner à son avantage.",
      en: 'Reborn as the villainess of a novel, a young woman refuses to follow the script written for her and decides to turn it to her advantage.',
    },
    categories: { fr: ['Romance', 'Comédie', 'Isekai'], en: ['Romance', 'Comedy', 'Isekai'] },
    rating: 4.6,
    year: 2020,
    kind: 'manhwa',
    publicationStatus: 'completed',
    chapters: 128,
  },
  {
    id: 'e78a489b-6632-4d61-b00b-5206f5b8b22b',
    title: { fr: 'Moi, quand je me réincarne en Slime', en: 'That Time I Got Reincarnated as a Slime' },
    subtitle: 'Tensei Shitara Slime datta Ken',
    authors: ['Fuse', 'Kawakami Taiki'],
    synopsis: {
      fr: "Un employé de bureau poignardé se réveille dans un autre monde… sous la forme d'un slime. Doté de pouvoirs singuliers, il se lie d'amitié avec un dragon et commence à bâtir une nation de monstres.",
      en: 'An office worker who was stabbed wakes up in another world… as a slime. Gifted with unusual powers, he befriends a dragon and starts building a nation of monsters.',
    },
    categories: {
      fr: ['Action', 'Comédie', 'Isekai', 'Fantasy'],
      en: ['Action', 'Comedy', 'Isekai', 'Fantasy'],
    },
    rating: 4.6,
    year: 2015,
    kind: 'manga',
    publicationStatus: 'ongoing',
    chapters: null,
  },
  {
    id: '4a973243-952e-44d7-a50f-883b4b7c9cc2',
    title: { fr: 'SSS-Class Revival Hunter', en: 'SSS-Class Revival Hunter' },
    subtitle: 'SSS-geup Jugeoya Saneun Hunter',
    authors: ['Neida', 'Shin Noah'],
    synopsis: {
      fr: 'Kim Gong-ja obtient enfin une compétence de rang SSS : à chaque mort, il revient dans le passé en copiant le pouvoir de son meurtrier. Pour devenir plus fort, il va devoir mourir encore et encore.',
      en: 'Kim Gong-ja finally gets an SSS-rank skill: every time he dies, he returns to the past with his killer’s power. To grow stronger, he will have to die again and again.',
    },
    categories: {
      fr: ['Action', 'Psychologique', 'Fantasy'],
      en: ['Action', 'Psychological', 'Fantasy'],
    },
    rating: 4.6,
    year: 2020,
    kind: 'manhwa',
    publicationStatus: 'ongoing',
    chapters: null,
  },
]

/** Le jeu de secours dans la langue demandée, au format `Book` du catalogue. */
export function seedBooks(language: Language): Book[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    title: seed.title[language],
    subtitle: seed.subtitle,
    authors: seed.authors,
    cover: null,
    synopsis: seed.synopsis[language],
    categories: seed.categories[language],
    rating: seed.rating,
    ratingsCount: 0,
    pages: null,
    year: seed.year,
    publisher: null,
    previewLink: `https://mangadex.org/title/${seed.id}`,
    kind: seed.kind,
    publicationStatus: seed.publicationStatus,
    chapters: seed.chapters,
    languages: ['fr', 'en'],
    lang: language,
    synopsisLanguage: language,
  }))
}
