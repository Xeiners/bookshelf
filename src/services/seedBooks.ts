import type { Book } from '../types/book'

/**
 * Jeu de secours 100 % hors-ligne.
 *
 * Utilisé uniquement si l'API est injoignable (avion, coupure, DNS). Les
 * couvertures sont volontairement `null` : le composant `BookCover` génère
 * alors une couverture typographique procédurale, garantie sans réseau.
 */
export const SEED_BOOKS: Book[] = [
  {
    id: 'seed-petit-prince',
    title: 'Le Petit Prince',
    subtitle: null,
    authors: ['Antoine de Saint-Exupéry'],
    cover: null,
    synopsis:
      "Un aviateur en panne dans le désert du Sahara rencontre un jeune prince venu d'une autre planète. De leurs conversations naît une méditation sur l'amitié, la perte et le regard des adultes sur le monde.",
    categories: ['Conte', 'Philosophie', 'Jeunesse'],
    rating: 4.4,
    ratingsCount: 0,
    pages: 96,
    year: 1943,
    publisher: 'Gallimard',
    previewLink: null,
  },
  {
    id: 'seed-1984',
    title: '1984',
    subtitle: null,
    authors: ['George Orwell'],
    cover: null,
    synopsis:
      "Dans une Océania sous surveillance totale, Winston Smith réécrit le passé pour le Parti. Sa tentative de penser librement devient un acte de résistance dans un monde où le langage lui-même est mutilé.",
    categories: ['Dystopie', 'Science-fiction', 'Politique'],
    rating: 4.3,
    ratingsCount: 0,
    pages: 328,
    year: 1949,
    publisher: 'Secker & Warburg',
    previewLink: null,
  },
  {
    id: 'seed-etranger',
    title: "L'Étranger",
    subtitle: null,
    authors: ['Albert Camus'],
    cover: null,
    synopsis:
      "Meursault enterre sa mère sans verser une larme, puis tue un homme sur une plage d'Alger. Son procès juge moins son crime que son indifférence : le roman fondateur de l'absurde.",
    categories: ['Roman', 'Philosophie', 'Classique'],
    rating: 4.1,
    ratingsCount: 0,
    pages: 159,
    year: 1942,
    publisher: 'Gallimard',
    previewLink: null,
  },
  {
    id: 'seed-dune',
    title: 'Dune',
    subtitle: null,
    authors: ['Frank Herbert'],
    cover: null,
    synopsis:
      "Sur Arrakis, planète désertique et seule source de l'Épice, la maison Atréides tombe dans un piège impérial. Paul Atréides devient l'espoir des Fremen et le pivot d'une prophétie qu'il redoute.",
    categories: ['Science-fiction', 'Politique', 'Écologie'],
    rating: 4.5,
    ratingsCount: 0,
    pages: 688,
    year: 1965,
    publisher: 'Chilton Books',
    previewLink: null,
  },
  {
    id: 'seed-orgueil',
    title: 'Orgueil et Préjugés',
    subtitle: null,
    authors: ['Jane Austen'],
    cover: null,
    synopsis:
      "Elizabeth Bennet, vive et sans fortune, croise l'orgueilleux Mr Darcy dans l'Angleterre georgienne. Une comédie de mœurs où chaque malentendu démonte les certitudes de classe.",
    categories: ['Romance', 'Classique', 'Satire'],
    rating: 4.4,
    ratingsCount: 0,
    pages: 432,
    year: 1813,
    publisher: 'T. Egerton',
    previewLink: null,
  },
  {
    id: 'seed-fahrenheit',
    title: 'Fahrenheit 451',
    subtitle: null,
    authors: ['Ray Bradbury'],
    cover: null,
    synopsis:
      "Montag est pompier : son métier est de brûler les livres. Une rencontre fissure ses certitudes et le pousse à sauver ce que sa société a décidé d'oublier.",
    categories: ['Dystopie', 'Science-fiction', 'Classique'],
    rating: 4.2,
    ratingsCount: 0,
    pages: 194,
    year: 1953,
    publisher: 'Ballantine Books',
    previewLink: null,
  },
  {
    id: 'seed-monte-cristo',
    title: 'Le Comte de Monte-Cristo',
    subtitle: null,
    authors: ['Alexandre Dumas'],
    cover: null,
    synopsis:
      "Edmond Dantès est emprisonné au château d'If sur une dénonciation. Évadé et immensément riche, il revient sous un nouveau nom orchestrer une vengeance méthodique.",
    categories: ['Aventure', 'Classique', 'Vengeance'],
    rating: 4.6,
    ratingsCount: 0,
    pages: 1276,
    year: 1844,
    publisher: 'Pétion',
    previewLink: null,
  },
  {
    id: 'seed-frankenstein',
    title: 'Frankenstein',
    subtitle: 'ou le Prométhée moderne',
    authors: ['Mary Shelley'],
    cover: null,
    synopsis:
      "Victor Frankenstein donne vie à une créature qu'il abandonne aussitôt. Rejetée de tous, celle-ci réclame des comptes à son créateur : le premier grand roman sur la responsabilité scientifique.",
    categories: ['Gothique', 'Science-fiction', 'Classique'],
    rating: 4.0,
    ratingsCount: 0,
    pages: 280,
    year: 1818,
    publisher: 'Lackington, Hughes',
    previewLink: null,
  },
]
