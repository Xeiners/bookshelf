# Backend & synchronisation

L'API Express qui sert le catalogue manga/manhwa, les comptes et la synchronisation
de la bibliothèque. Le front reste utilisable sans elle (mode hors-ligne), et sans
compte (mode invité).

```
backend/
├── prisma/
│   ├── schema.prisma          User · LibraryEntry · SkippedWork
│   └── migrations/            SQL versionné, appliqué au démarrage
├── prisma.config.ts           Prisma 7 : chemin du schéma et URL de la base
└── src/
    ├── index.ts               démarrage HTTP, arrêt propre
    ├── app.ts                 middlewares, routes, gestionnaire d'erreurs
    ├── config.ts              variables d'environnement validées (Zod)
    ├── db.ts                  client Prisma + adaptateur better-sqlite3
    ├── lib/                   cache TTL, erreurs HTTP, hachage, session JWT
    ├── middleware/            requireAuth, limiteur de débit
    └── modules/
        ├── books/             contrat `Book` partagé avec le front
        ├── manga/             proxy MangaDex : client, normalisation, étagères, tags
        ├── auth/              register · login · me · logout
        └── library/           swipe, patch, suppression, fusion invité → compte
```

---

## 1. Lancer

```bash
npm install   # à la racine : les deux workspaces + `prisma generate`
npm run dev   # `prisma migrate deploy`, puis API :5000 et front :5173 en parallèle
```

En dev, le front appelle `/api/...` en relatif et **Vite relaie vers
`http://localhost:5000`** (`frontend/vite.config.ts`). Pour le navigateur, l'API
est donc de même origine :

- le cookie de session HTTP-only passe sans configuration CORS ;
- un téléphone sur le LAN atteint l'API à travers le serveur Vite ;
- le Service Worker peut mettre les couvertures en cache.

Pour servir le front ailleurs, définir `VITE_API_URL` (front) ainsi que
`CORS_ORIGINS` et `PUBLIC_API_BASE` (API) : voir `backend/.env.example`.

> Le mode watch utilise `node --watch --import tsx`. `tsx watch` est écarté parce
> qu'il se bloque au démarrage quand son entrée standard est un pipe ouvert, ce qui
> est justement le cas sous `concurrently`.

---

## 2. Schéma de base

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique        // toujours en minuscules
  passwordHash String                  // scrypt$N$r$p$sel$hash
  displayName  String?
  entries      LibraryEntry[]
  skips        SkippedWork[]
}

model LibraryEntry {
  userId    String
  workId    String                     // UUID MangaDex (ou id Open Library historique)
  status    String                     // 'wishlist' | 'reading' | 'read'
  progress  Float    @default(0)
  favorite   Boolean @default(false)   // coup de cœur
  userRating Float?                    // note perso 0,5 → 5 (demi-étoiles)
  snapshot  String                     // JSON du `Book` affiché par le front
  title     String
  addedAt   DateTime
  updatedAt DateTime                   // horodatage client : arbitre les fusions
  @@id([userId, workId])               // un doublon est impossible par construction
}

model SkippedWork {
  userId String
  workId String
  @@id([userId, workId])
}

model UserPreference {                 // profil de goûts, cf. §7 ter
  userId String @id
  scores String                        // JSON { genres: {…}, tags: {…} }
  swipes Int
}

model CatalogWork {                    // catalogue agrégé AniList + MangaDex, cf. §7 ter
  anilistId  Int     @id               // clé de dédoublonnage
  mangadexId String? @unique           // jointure MangaDex (links.al)
  country    String                    // JP | KR | CN | TW
  meanScore  Int?
  popularity Int
  genres     String                    // JSON string[]
  tags       String                    // JSON { name, rank }[]
  anilist    String                    // JSON fiche AniList
  mangadex   String?                   // JSON œuvre MangaDex brute
  status     String?                   // FINISHED | RELEASING… (recherche, Oracle)
  chapters   Int?
  year       Int?
  searchText String                    // titres toutes langues + auteurs, normalisés
}
```

Choix notables :

- **Clés composites `(userId, workId)`.** La fusion peut faire des upserts
  aveuglément : aucune combinaison de requêtes ne peut créer de doublon.
- **Instantané par utilisateur, pas de table `Work` partagée.** L'instantané vient
  du client. Partagé entre utilisateurs, il laisserait n'importe qui réécrire la
  fiche que voient les autres. Le coût est quelques Ko dupliqués par entrée.
- **Pas d'`enum` Prisma.** SQLite ne les gère pas : les statuts sont validés par Zod
  à l'entrée de l'API.
- **SQLite en local, PostgreSQL en Docker / production.** Un seul schéma source
  (SQLite) ; le schéma PostgreSQL et ses migrations en sont dérivés, et
  `DATABASE_URL` choisit la base (`file:…` ou `postgresql://…`). Détails :
  [docs/DOCKER.md](DOCKER.md) §3. Aucun type spécifique à SQLite n'est utilisé.

---

## 3. Proxy MangaDex

`modules/manga/` interroge `https://api.mangadex.org` et renvoie le format `Book` du
front. Tous les filtres restent côté serveur.

| Filtre | Valeur |
| --- | --- |
| Langues de lecture | `availableTranslatedLanguage[]=fr,en` + `hasAvailableChapters=true` |
| Origine | `ja` → manga, `ko` → manhwa (étagères `manga` / `manhwa`, paramètre `origin` de la recherche) |
| Contenu | `contentRating[]=safe,suggestive` |
| Tri des étagères | `order[followedCount]=desc` |

**Normalisation** (`normalize.ts`) :

- titre en français, sinon en anglais (titre principal puis alternatifs), sinon la
  romanisation ; le titre original devient le sous-titre ;
- résumé en français sinon en anglais, markdown retiré, bloc de liens final coupé ;
- genres et thèmes traduits via une liste blanche (`tags.ts`), qui écarte les tags
  de format et les tags sensibles ;
- note bayésienne /10 ramenée sur 5, en un seul appel `/statistics/manga` par page ;
- `kind`, `publicationStatus` et `chapters` pour les badges du front.

**Couvertures.** `GET /api/covers/:mangaId/:fileName?size=512|256` relaie
`uploads.mangadex.org`. MangaDex n'autorise pas le hotlinking, et passer par l'API
donne des couvertures de même origine, que le Service Worker peut mettre en cache.
`BookCover` retente en `size=256`, puis bascule sur la couverture procédurale.

**Débit et cache.** Les appels sortants sont espacés de 220 ms (MangaDex tolère
environ 5 requêtes/s par IP). Le `TtlCache` en mémoire déduplique aussi les
requêtes simultanées :

| Donnée | Durée | Entrées max |
| --- | --- | --- |
| Page d'étagère | 15 min | 400 |
| Recherche | 5 min | 300 |
| Fiche | 60 min | 1 000 |
| Note | 6 h | 5 000 |
| Couverture (binaire) | 12 h | 300 |
| Index des tags | 24 h | 1 |

**Pagination.** `page × limit` est borné à 10 000, la fenêtre maximale de MangaDex ; `hasMore` passe à `false` avant de l'atteindre. Le catalogue du front s'en sert pour son défilement infini (`useCatalog` + sentinelle `IntersectionObserver` dans `SearchView`).

Une étagère étroite dont la page tirée au hasard dépasse le total reboucle sur une
page existante : le deck n'affiche jamais « étagère épuisée » à tort.

---

## 4. Référence de l'API

Les erreurs sont toujours renvoyées au format `{ "error": { "code", "message" } }`.
Les messages de validation sont en français (locale Zod `fr`).

### Catalogue (public)

| Méthode | Route | Réponse |
| --- | --- | --- |
Toutes les routes du catalogue acceptent `?lang=fr|en` (titres, résumés, genres,
libellés). Absent, vide ou inconnu → `fr`, jamais d'erreur : les anciens clients
continuent de fonctionner. Voir §7.

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/api/manga/shelves?lang=` | `{ shelves: { id, label }[] }` |
| GET | `/api/manga/shelves/:id?page=1&limit=24&lang=` | `{ books, total, page, hasMore }` |
| GET | `/api/manga/search?q=&page=1&limit=24&origin=all\|manga\|manhwa&lang=` | `{ books, total, page, hasMore }` |
| GET | `/api/manga/batch?ids=a,b,c&lang=` | `{ books }` — 100 ids max, inconnus ignorés |
| GET | `/api/manga/:id?lang=` | `{ book }` — `:id` = UUID MangaDex ou `al-<id>` (catalogue AniList) |
| POST | `/api/discover/deck` | deck recommandé, voir §7 ter |
| POST | `/api/discover/browse` | recherche et filtres du catalogue, voir §7 quater |
| GET | `/api/discover/genres?lang=` | `{ genres: { id, label, count }[] }` — filtres de genre |
| GET | `/api/covers/:mangaId/:fileName?size=512\|256` | image |
| GET | `/api/health` | `{ status: 'ok' }` |

### Authentification

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `{ email, password, displayName?, preferredLanguage? }` | 202 `{ email, expiresAt, resendAt }` — code envoyé, **aucun compte créé** |
| POST | `/api/auth/register/verify` | `{ email, code, initialData? }` | 201 `{ user, library }` + cookie — le compte naît ici |
| POST | `/api/auth/register/resend` | `{ email }` | `{ email, expiresAt, resendAt }` — nouveau code |
| POST | `/api/auth/login` | `{ email, password, initialData? }` | `{ user, library }` + cookie |
| GET | `/api/auth/me` | — | `{ user }` ou 401 |
| PATCH | `/api/auth/me` | `{ displayName?, preferredLanguage? }` | `{ user }` |
| POST | `/api/auth/logout` | — | 204, cookie effacé |

- **Vérification de l'e-mail** (`modules/auth/verification.ts`, testée) : l'inscription
  est mise en attente (`PendingRegistration`) et un code à 6 chiffres part par e-mail ;
  le `User` n'est créé qu'avec le bon code (`emailVerifiedAt` renseigné). Code tiré par
  `crypto.randomInt`, stocké en HMAC-SHA256 (clé JWT_SECRET, lié à l'e-mail), comparé à
  temps constant. 15 min de validité, 5 essais par code (`code_invalid` renvoie
  `remainingAttempts`, puis `code_locked`), 60 s entre deux envois (`resend_too_soon` +
  `retryAfter`), 5 envois / heure / adresse. E-mail HTML + texte, FR/EN, code en cases 3 + 3.
- **Transport des e-mails** (`lib/mailer.ts`) : SMTP dès que `SMTP_HOST` est défini ;
  sinon la console en développement (le code s'affiche dans le terminal de l'API), une
  boîte en mémoire en test, et rien en production : `register` répond 503
  `email_unavailable` plutôt que de créer des comptes invérifiables.
- **Session** : JWT HS256 valable 30 jours, dans le cookie `bookshelf_session`
  (`HttpOnly`, `SameSite=Lax`, `Secure` en production). Le JavaScript de la page
  ne peut pas le lire (XSS), et il n'est pas envoyé sur un POST inter-sites (CSRF).
- **Mots de passe** : scrypt de `node:crypto`, sel aléatoire, paramètres stockés
  dans le hash. Aucune dépendance native.
- **Login** : même message et même durée de réponse, que l'e-mail existe ou non
  (vérification sur un hash factice).
- **Limiteur** : 20 tentatives par tranche de 15 minutes et par IP sur register et
  login, en mémoire. À passer sur Redis si l'API tourne sur plusieurs instances.
- **Logout** : le jeton est sans état, donc supprimer le cookie suffit côté
  appareil. Pour révoquer toutes les sessions d'un compte, il faudrait une
  colonne `tokenVersion`.

### Bibliothèque (authentifiée)

| Méthode | Route | Corps | Effet |
| --- | --- | --- | --- |
| GET | `/api/library` | — | `{ entries, skipped }` |
| POST | `/api/library/swipe` | `{ mangaId, action, book?, at? }` | action `wishlist` · `reading` · `read` · `skipped` |
| PATCH | `/api/library/:workId` | `{ status?, progress?, favorite?, userRating?, at? }` | statut, progression, favori, note (0,5 → 5 par demi-étoiles, `null` l'efface) |
| DELETE | `/api/library/:workId` | — | retire une œuvre (idempotent) |
| DELETE | `/api/library` | — | réinitialise tout |
| POST | `/api/library/sync` | `{ entries, skipped }` | fusion d'un état complet |

`book` est obligatoire sauf pour `skipped`, et `book.id` doit valoir `mangaId`.
Toutes ces opérations sont idempotentes : la file du front peut les rejouer sans
risque.

---

## 5. Stratégie « invité d'abord »

```
                 invité                                   connecté
┌───────────────────────────────┐        ┌──────────────────────────────────────┐
│ action ─► store Zustand ─► LS │  login │ action ─► store Zustand ─► LS        │
│                               │ ─────► │              └─► outbox ─► API       │
└───────────────────────────────┘ fusion └──────────────────────────────────────┘
```

**Invité (par défaut).** Rien ne change : `useLibraryStore` persiste dans le
localStorage. `outbox.push()` est sans effet tant qu'aucune session n'est active.

**Inscription / connexion.** Le front envoie son état local complet dans
`initialData`. `mergeLibrary()` le fusionne dans une seule transaction :

1. doublons dans la charge utile : la version la plus récente est gardée ;
2. œuvre absente du compte : elle est créée ;
3. œuvre déjà présente : **la modification la plus récente gagne** (`updatedAt`,
   sinon `addedAt`), et `addedAt` garde la date la plus ancienne ;
4. un skip ne rétrograde jamais une œuvre enregistrée ; enregistrer une œuvre la
   retire des skips (même règle que le store) ;
5. un horodatage client situé dans le futur est ramené à l'heure du serveur, pour
   qu'il ne gagne pas toutes les fusions.

La fusion est tolérante élément par élément : une entrée locale corrompue ou d'un
ancien format est ignorée seule, sans faire échouer la connexion. La réponse
contient la bibliothèque fusionnée, qui remplace l'état local.

**Connecté : mode « API Sync »** (`frontend/src/lib/syncOutbox.ts`).

- Le store local reste la source de l'UI : un swipe s'affiche instantanément,
  même hors-ligne.
- Chaque action est poussée dans une **file persistée** (`bookshelf:outbox:v1`),
  envoyée dans l'ordre 350 ms plus tard.
- Réseau coupé ou erreur 5xx : on retente avec un délai qui double (de 2 s à 60 s),
  et tout de suite à l'événement `online`. La file survit à la fermeture de l'app.
- 401 : la session a expiré. Les données locales redeviennent des données invité
  et seront refusionnées à la prochaine connexion. Rien n'est perdu.
- Autre 4xx : l'opération ne passera jamais, elle est abandonnée et journalisée.
- Coalescence : une rafale de `patch` sur une même œuvre n'envoie que le dernier ;
  un `remove` annule les opérations en attente sur cette œuvre ; un `reset` vide
  la file.

**Au démarrage** (`useAuthStore.bootstrap`) :

- `GET /auth/me` ;
- envoi de la file en attente ;
- `GET /library`, qui remplace l'état local et récupère ce qui a été fait sur un
  autre appareil ;
- si un swipe a eu lieu entre-temps, l'état local est gardé.

**Déconnexion.** On tente d'envoyer la file, puis l'appareil repart vide : la
bibliothèque reste sur le compte. Si des actions sont encore en attente,
l'interface demande une confirmation.

---

## 6. Vérifications faites

> `npm test` à la racine lance les tests d'intégration de l'API (29, MangaDex
> simulé, base SQLite temporaire — dont 11 pour l'Oracle) et l'audit i18n du front.

- **curl** : validation (messages en français), e-mail déjà pris, mauvais mot de
  passe, doublons internes à `initialData`, skip d'une œuvre enregistrée, état
  invité plus ancien qui ne doit pas écraser le compte, suppression, reset,
  logout, 401.
- **Navigateur (Playwright, deux contextes)** :
  - swipes en invité ;
  - inscription avec fusion : l'état local correspond à la base ;
  - swipe connecté envoyé à l'API ;
  - appareil B invité puis connexion : fusion des deux côtés ;
  - rechargement de A : récupère l'ajout de B ;
  - déconnexion de B : appareil vidé, `/me` renvoie 401.

---

## 7. Langues (FR / EN)

Deux dimensions, pilotées par une seule préférence `fr | en`.

### Interface

- `frontend/src/i18n/fr.ts` est le dictionnaire de référence ; `en.ts` est typé
  `Dictionary` (dérivé de `fr`) : **une clé manquante ou en trop ne compile pas**.
- Textes variables = fonctions typées (`t.deck.addedToWishlist(title)`,
  `t.search.end(count)`) : interpolation et pluriels sans moteur de gabarits.
- `useT()` dans un composant, `getT()` hors React (stores, callbacks).
- Langue initiale : celle du navigateur si servie, sinon `fr`. Persistée dans
  `bookshelf:settings:v1`. `<html lang>` et la meta description suivent.
- Erreurs d'API traduites depuis leur **code** stable (`invalid_credentials`,
  `email_taken`, `rate_limited`, `validation_error`) — jamais depuis le
  `message` serveur, qui reste une aide au debug.
- Formulaire de connexion en `noValidate` : la bulle native parlerait la langue
  du navigateur, pas celle de l'app.

**Ajouter un texte** : une clé dans `fr.ts`, la même dans `en.ts` (le compilateur
l'exige), puis `t.section.cle`. **Vérifier** : `npm run i18n:audit -w frontend`
analyse l'AST de `src/` et échoue sur tout texte en dur (nœud JSX, `aria-label`,
`title`, `placeholder`, `alt`, phrase ou libellé en littéral). Exception
assumée : `// i18n-ignore` avec une justification (noms propres, troncature…).

### Catalogue

- Les caches du proxy gardent la réponse MangaDex **brute** ; la normalisation
  est refaite par requête dans la langue demandée. Basculer FR ↔ EN ne coûte aucun
  appel MangaDex (vérifié par un test d'intégration).
- Repli : titre dans la langue demandée (titre principal puis alternatifs), sinon
  dans l'autre, sinon la romanisation. Résumé idem ; `synopsisLanguage` indique
  la langue réellement servie et la fiche l'annonce (« Résumé disponible en
  anglais uniquement »). Genres toujours traduits (liste blanche).
- `availableTranslatedLanguage[]` reste `fr` + `en` quelle que soit la langue :
  une œuvre lisible seulement en anglais reste proposée à un francophone, au lieu
  d'amputer le catalogue de moitié.
- Bibliothèque enregistrée : les fiches sont des instantanés. Quand la langue
  change, `useLibraryLocalization` retraduit les entrées MangaDex par lots de 100
  (`/manga/batch`), sans toucher statut, progression, dates ni synchronisation.

### Préférence du compte

- Invité : localStorage uniquement, aucune requête.
- Inscription : la langue courante devient `User.preferredLanguage` (défaut `fr`
  pour les comptes existants, migration `add_preferred_language`).
- Connecté : chaque changement part dans l'outbox (`{ type: 'prefs' }`, seul le
  dernier compte, survit à un reset de bibliothèque) → `PATCH /api/auth/me`.
- Connexion / démarrage : l'appareil **adopte la langue du compte**, sauf si un
  changement local n'est pas encore envoyé (hors-ligne) — il est alors plus récent.

## 7 bis. Oracle — « Le Tirage de l'Ombre »

Rituel quotidien en trois cartes : **Ambiance** (genre), **Rythme** (longueur /
statut), **Pépite** (titre très bien noté répondant aux deux).

| Méthode | Route | Corps / requête | Réponse |
| --- | --- | --- | --- |
| GET | `/api/oracle/draw` | `?seed=<compte ou appareil>:<AAAA-MM-JJ>&lang=` | `{ mood, pace, relaxed, picks }` |
| POST | `/api/oracle/checkin` (auth) | `{ day, streak? }` | `{ oracle: { lastDay, streak, best } }` |

- **Paquets** (`modules/oracle/decks.ts`) : 15 ambiances (genres AniList exigés,
  ou un tag pertinent ≥ 50 % : « isekai » = Isekai / Reincarnation /
  Transmigration) et 4 rythmes (courte ≤ 60 ch. terminée, épique, terminée, en
  cours). AniList ne connaît le nombre de chapitres que des séries terminées :
  « épique » = ≥ 150 ch. connus OU en cours depuis au moins 6 ans. Les ids sont
  le contrat avec le front, qui porte libellés, icônes et couleurs.
- **Déterministe** : la graine `<id>:<jour>` fixe ambiance, rythme et ordre des
  titres (FNV-1a + Mulberry32, `lib/seeded.ts`). Connecté, la graine est l'id du
  compte : même tirage sur tous les appareils ; on ne « relance » pas en
  rechargeant. Le client applique le même algorithme pour son tirage hors-ligne.
- **Sélection** (catalogue agrégé, §7 ter) : œuvres de l'ambiance notées ≥ 72,
  filtrées par le rythme (relâché sous 6 candidats, `relaxed: true`). La Pépite :
  une origine tirée (JP 50 %, KR 30 %, CN 20 %, parmi celles disponibles), puis
  un titre par tirage pondéré sans remise (Efraimidis-Spirakis), poids =
  qualité² × (0,55 + 0,45 × (1 − notoriété)) : de la qualité, sans toujours
  les mêmes classiques. La 1ʳᵉ lecture « dans la même veine » vient d'une autre
  origine. Mesuré sur 60 jours : 15 ambiances, 31 manga / 14 manhwa / 15 manhua,
  59 pépites distinctes, 6 ms. Catalogue pas prêt → repli historique MangaDex
  (les 100 mieux notés de l'ambiance).
- **Série** (`modules/oracle/streak.ts`, testée) : jour local `AAAA-MM-JJ` de
  l'utilisateur ; lendemain → +1, trou → 1, même jour → inchangé, jour antérieur
  → ignoré. `streak` revendiqué par le client (tirages invité / hors-ligne) ne
  peut que relever la série. Jour refusé s'il a plus d'un jour d'avance sur l'UTC.
- **Base** : `User.oracleLastDay`, `oracleStreak`, `oracleBest` (migration
  `add_oracle_streak`), exposés dans `user.oracle` par `/auth/me`, login et register.
- **Synchronisation** : invité → localStorage (`bookshelf:oracle:v1`). Connecté →
  `checkin` direct, ou via l'outbox (`{ type: 'oracle' }`) si le réseau manque.
  Au démarrage et à la connexion, la série la plus récente l'emporte
  (`useOracleStore.reconcile`) ; une série faite en invité rejoint le compte.

## 7 ter. Moteur de recommandation (deck « Swipe & Match »)

Le deck ne lit plus les étagères MangaDex : il est composé par un moteur de
recommandation sur un **catalogue agrégé AniList + MangaDex**, en cache local.

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/api/discover/deck` (session facultative) | `{ shelf, origin, lang, limit, seen[], liked[{ id, categories, rating, favorite, userRating }], skipped[] }` | `{ books: (Book & { matchPercentage, discovery })[], hasMore, source, personalized }` |
| GET | `/api/manga/al-<id>` | `?lang=` | `{ book }` — œuvre connue d'AniList seulement |

**Sources** (`src/services/`)

- `anilist.service.ts` : client GraphQL (genres, tags avec pertinence %,
  `meanScore`, `popularity`, `format`, `countryOfOrigin` JP / KR / CN). Appels
  espacés de 2,1 s, 429 réessayé après `Retry-After`. Jamais appelé pendant un swipe.
- `catalog.service.ts` : agrégateur. Une ligne `CatalogWork` par œuvre AniList
  (clé de dédoublonnage) ; jointure MangaDex par `links.al`, `mangadexId` unique :
  deux fiches MangaDex d'une même œuvre ne donnent jamais deux cartes (la plus
  suivie gagne). Œuvre liée → textes FR/EN, couverture et id MangaDex (la
  bibliothèque, la traduction et la lecture marchent comme avant). Sinon → fiche
  AniList, id `al-<id>`, textes anglais (`synopsisLanguage: 'en'`).
- **Indexeur** (au démarrage si le cache a plus de 24 h ou moins de 1 000
  œuvres, puis chaque jour ; `CATALOG_SYNC=off` le coupe, toujours coupé en test) :
  ~44 pages AniList par popularité (JP 24, KR 14, CN 6) + 6 pages « mieux notées »,
  19 pages MangaDex par suivis pour la jointure, puis rattrapage des fiches
  AniList manquantes. ≈ 2 500-3 000 œuvres en quelques minutes, en arrière-plan ;
  une première vague (une page par pays) sert le deck après quelques secondes.
  Tant que le catalogue a moins de 40 œuvres, le deck se replie sur l'étagère
  MangaDex équivalente, notée par le même moteur.
- **Performance** : le pool (genres, tags, notes, ids — sans les fiches JSON)
  vit en mémoire ; rechargé en arrière-plan (60 s, ou 15 s pendant l'indexation).
  Composer un deck = filtrer + noter + trier en mémoire, puis lire en base les
  fiches des ~20 cartes servies. Mesuré : 7-10 ms (en-tête `Server-Timing`).

**Algorithme** (`services/recommendation/scoring.ts`, logique pure, testée)

- **Profil** `UserPreference.scores` = `{ genres: { Action: 12 }, tags: { Revenge: 8 } }`.
  Wishlist / lu / en cours → +3 par genre, +3 × pertinence par tag ; passer → -2.
  Un titre en bibliothèque pèse `likeWeight` = 3, +2 en favori, ±2 par étoile
  d'écart à 3★ (5★ favori → 9 ; 1★ → -1 : un titre lu et détesté éloigne ses
  genres). Changer un favori ou une note n'applique que l'écart de poids.
  Tags < 40 % ignorés, scores bornés à ±60. Mis à jour dans `applySwipe`,
  annulé par `DELETE /library/:id` (bouton « Retour »), recalculé après une
  fusion invité, effacé par la réinitialisation. Rejouer un swipe (outbox) ne
  compte pas deux fois. Invité : pas de profil en base, il est recalculé à
  chaque requête depuis l'historique envoyé (même algorithme).
- **Match %** = 55 + 38 × tanh(affinité / 4,5) + 7 × qualité, borné 0-100.
  Affinité = 0,6 × moyenne des scores de genres + 0,4 × moyenne des scores de
  tags pondérée par leur pertinence. Qualité = (meanScore − 70) / 20, bornée ±1.
  Sans profil : 45-65 %, selon la note seule.
- **Anti-répétition** : bibliothèque + swipes « Passer » du compte, historique
  envoyé et cartes déjà en file (`seen`) sont exclus. Une œuvre vue sous un de
  ses ids (UUID MangaDex ou `al-<id>`) est exclue sous tous.
- **80/20** : une carte sur cinq (`discovery: true`) vient d'un genre peu
  exploré (aucun de ses genres à |score| ≥ 3) et très bien noté (> 80 %).
- **Étagères** : « Pour toi » (tout le catalogue), « Tendances » (popularité
  d'abord), genres AniList (Action, Romance…) ; `origin` filtre JP / KR / CN.

## 7 quater. Recherche dans le catalogue

`POST /api/discover/browse` (session facultative, même historique que le deck) :
`{ q, origin, genres[], status: any|ongoing|completed, minScore (0-95, sur 100),
sort: relevance|match|popularity|score|recent, page, limit, lang, source }` →
`{ books (avec matchPercentage), total, page, hasMore, supplement, personalized }`.

- **En mémoire** sur le pool (champs `status`, `chapters`, `year`,
  `searchText` ajoutés au pool et à `CatalogWork`, calculés à l'indexation et
  une fois pour un catalogue existant) : 3-5 ms mesurés.
- **Texte** : `searchText` = titres AniList et MangaDex de toutes les langues,
  titres alternatifs et auteurs, en minuscules sans accents ni ponctuation.
  Chaque mot doit apparaître ; un titre qui commence par la requête passe devant.
- **Genres** combinés en ET ; note, statut et tri comparent la note AniList —
  celle que les cartes affichent (une œuvre liée ne montre plus la note MangaDex).
- **Complément MangaDex** : si une recherche textuelle a moins de 8 résultats,
  `supplement: true` ; le front demande alors `source: 'mangadex'` APRÈS avoir
  affiché le catalogue (la réponse principale ne dépend jamais du réseau).
  Doujinshi exclus ; une fiche dont l'œuvre (`links.al`) est déjà au catalogue
  n'est pas proposée deux fois.

## 8. Limites connues et suites possibles

- Une œuvre servie d'abord sous `al-<id>` puis liée à MangaDex par une
  indexation ultérieure change d'id. L'anti-répétition la reconnaît sous ses
  deux ids, mais une entrée de bibliothèque déjà créée garde l'id `al-`.
- AniList n'a de résumés qu'en anglais : les œuvres absentes de MangaDex restent
  en anglais en mode français (signalé par `synopsisLanguage`).

- Le cache, le limiteur de débit et la file de requêtes MangaDex sont en mémoire,
  donc propres à une instance. En multi-instance, passer sur Redis (même
  interface que `TtlCache`).
- Pas de réinitialisation de mot de passe ni de vérification d'e-mail.
- MangaDex ne fournit pas de nombre de pages : les statistiques « pages » et
  « temps de lecture » du Profil restent à 0 pour les mangas. Une version dédiée
  pourrait compter en chapitres (`book.chapters`).
- Le manifeste PWA (`frontend/public/manifest.webmanifest`) est statique et en
  français : il est lu une fois, à l'installation, et ne gère qu'une langue.
- Les toasts sont rédigés à l'émission : un toast visible au moment d'un
  changement de langue est retiré plutôt que laissé dans l'ancienne langue.
- Le contrat `Book` est dupliqué (`frontend/src/types/book.ts` et
  `backend/src/modules/books/book.schema.ts`). Un troisième workspace `shared`
  s'imposera si le contrat continue d'évoluer.
