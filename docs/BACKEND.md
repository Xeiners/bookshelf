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
        ├── books/             contrat `Book` partagé avec le front ; romans EPUB du compte (§7 sexies)
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
  chaptersRead Int @default(0)         // lecteur intégré : ne fait que croître
  position  String?                    // JSON ReadingPosition (chapitre, page, décalage)
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

model CatalogWork {                    // catalogue MangaDex en cache, cf. §7 ter
  mangadexId String  @id               // UUID MangaDex
  country    String                    // JP | KR | CN (d'après la langue originale)
  rating     Float?                    // note bayésienne MangaDex (/10)
  popularity Int                       // suivis MangaDex
  genres     String                    // JSON string[] : tags « genre »
  tags       String                    // JSON { name, rank }[] : tags « theme »
  mangadex   String                    // JSON œuvre MangaDex brute
  status     String?                   // ongoing | completed | hiatus | cancelled (recherche, Oracle)
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

## 3 bis. Lecteur : chapitres et pages (MangaDex At-Home)

`modules/chapters/` sert le lecteur intégré du front.

**Chapitres.** `GET /api/manga/:id/chapters?lang=fr|en` lit `/manga/:id/feed`
(pages de 500, fr + en en une seule passe, équipes de traduction incluses) et
exclut côté MangaDex les chapitres **externes** (`includeExternalUrl=0`), vides
ou à paraître. Le flux brut est gardé 10 min, indépendant de la langue : basculer
FR ↔ EN ne coûte aucun appel. Tri numérique (`9` avant `10`, one-shots en tête),
puis volume, puis date (`chapters.normalize.ts`). Sans chapitre dans la langue
demandée, l'autre est servie (`language` dans la réponse, `available` compte les deux).

> ⚠️ Beaucoup de titres sous licence n'ont sur MangaDex **que des liens
> officiels externes** (MANGA Plus, Tappytoon, Webnovel…) sans aucune page
> hébergée : ils ressortent avec 0 chapitre et le lecteur l'annonce. Ex. :
> *Solo Leveling*. Ce n'est pas un bug.

**Pages.** `GET /api/chapters/:chapterId/pages?quality=data|data-saver` appelle
`/at-home/server/:chapterId` et renvoie des URL **vers notre relais**, avec pour
chaque page l'URL « Data Saver » de repli. Le nœud MD@Home est gardé 10 min (son
jeton vit ~15 min). Ce point est limité à **30 appels/min par IP** : MangaDex
plafonne `/at-home/server` à 40/min pour TOUT notre serveur.

**Images.** `GET /api/chapters/:chapterId/image/:quality/:file` relaie l'image
(même logique que les couvertures : même origine, donc cache du Service Worker et
lecture hors-ligne). Replis successifs : nœud en panne → oubli du nœud, nouveau
nœud, nouvel essai → sinon la même page en `data-saver` (en-tête
`X-Reader-Quality: data-saver`, cache 5 min seulement). Nom de fichier =
empreinte : réponse `immutable` 30 jours. Rien n'est gardé en mémoire (RAM du VPS
partagée) ; chaque téléchargement est **rapporté à MangaDex**
(`api.mangadex.network/report`), comme l'exigent ses conditions, sauf pour
`uploads.mangadex.org`.

**Progression.** `PATCH /api/library/progress` (déclarée AVANT `/:workId`) :
la position la plus récente gagne (un envoi en retard d'un autre appareil ne
recule pas le lecteur), `chaptersRead` ne fait que croître. La fusion invité →
compte applique les mêmes règles.

Tests : `backend/test/reader.test.ts` (MangaDex et nœuds MD@Home simulés via
`extraMocks` du banc d'essai).

## 3 ter. Sources de chapitres multiples (`src/extensions/`)

Le lecteur ne parle plus directement à MangaDex : il passe par un **agrégateur**
de sources (patron Strategy). Chaque source implémente `SourceProvider`
(`extensions/types.ts`) : `fetchChapterList(mangaId, titleAliases)` et
`fetchPageUrls(chapterId, { quality })`. Ajouter une source = un fichier dans
`extensions/providers/` + une ligne dans `extensions/index.ts` ; ni les routes ni
le front ne changent.

| Source | Activée par | Priorité | Retrouve l'œuvre par |
| --- | --- | --- | --- |
| `mangadex` | toujours | 100 | UUID MangaDex |
| `opencomic` (« OpenComicStream ») | `OPEN_COMIC_API_URL` | 50 | UUID MangaDex + titres |
| `komga` / `kavita` (bibliothèque perso) | `OPEN_COMIC_API_URL` + `OPEN_COMIC_KIND` | 60 | titre (rapprochement flou) |
| `consumet` | `CONSUMET_API_URL` | 30 | titre (rapprochement flou, cf. ci-dessous) |
| `tachiyomi:<site>` (extensions Tachiyomi, pont Suwayomi) | `TACHIYOMI_BRIDGE_ENABLED` | 20 | titre, site par site (cf. ci-dessous) |

**Identifiants publics** (`chapterKey.ts`). MangaDex garde son UUID nu : positions
enregistrées, caches hors-ligne et URL existantes restent valables. Les autres :
`<source>~<id brut en base64url>`, sans caractère à échapper.

**Liste.** Toutes les sources sont interrogées en parallèle (`Promise.allSettled`),
chacune derrière un **délai** et un **disjoncteur** (3 échecs consécutifs → source
laissée tranquille 60 s, puis un seul essai ; un 404 n'est pas une panne). Une
source qui plante, expire ou change de format (réponses validées par zod) est
journalisée et marquée dans `sources[]` : `timeout` (délai dépassé) ou `failed`
(HTTP, format…), avec `error` et `durationMs` ; le reste du catalogue est servi.
Une ligne de synthèse par chargement (`[sources] <id> : mangadex 124 ch. (820 ms) ·
consumet timeout (25000 ms)`) et des lignes par étape (`[Provider: Consumet/…]
Search query: "…" -> 3 résultat(s)…`, `HTTP 403 Forbidden sur search`) disent
quelle source, et quelle route, renvoie vide ou échoue. Si **toutes** échouent : l'erreur de la plus prioritaire
(même comportement qu'avant quand MangaDex est seul). Résultat partiel gardé 1 min
au lieu de 10.

**Titres** (`titleMatch.ts`, pur). Les sources par titre reçoivent tous les noms
connus sur MangaDex (titre principal et alternatifs, toutes langues). On en
tire 4 requêtes au plus : titres latins
d'abord, chacun suivi de sa variante sans ponctuation, dédoublonnés, sans les
sigles (« SnK »). Un résultat est retenu si sa similarité (Levenshtein
normalisée) avec un des noms atteint **80 %** — et jamais si les nombres
diffèrent (« Blade Road 2 », « Season 3 ») : une suite n'est pas l'œuvre. Une
absence de correspondance n'est gardée que 30 min.

**Fusion** (`merge.ts`, pure). Groupes par langue + numéro canonique (`012` =
`12.0` = `12`). Dans un groupe, la meilleure version (priorité de la source, puis
complétude : pages connues, équipe, titre, volume) désigne la source gagnante,
qui garde **toutes** ses versions (équipes MangaDex) ; chaque autre source n'y
apporte que sa meilleure version, en `alternates`. Les one-shots ne sont jamais
fusionnés. Tri déterministe : l'ordre d'arrivée des réponses ne change rien.

**Pages et repli.** `GET /api/chapters/:id/pages?alt=k1,k2` : si la source du
chapitre échoue (panne, circuit ouvert, chapitre vide), les versions `alt` sont
essayées dans l'ordre ; la réponse dit laquelle a servi (`servedBy`, `source`,
`fallback`). Le front envoie les `alternates` du chapitre ; 4 replis au plus.

**Relais d'images** (`modules/proxy/`). `GET /api/proxy/page/:key/:index?n=&alt=`
sert les pages des sources autres que MangaDex (qui garde son relais MD@Home).
Le client ne fournit **jamais d'URL** : un chapitre et un numéro de page, résolus
par l'agrégateur. Le relais ajoute les en-têtes de provenance fournis par la
source (**seulement** `Referer`, `Origin`, `User-Agent`). Garde-fous SSRF : http(s)
uniquement, pas d'identifiants dans l'URL, pas de nom sans point (conteneurs
voisins du réseau Docker), résolution DNS vérifiée (aucune adresse privée,
locale ou réservée), redirections suivies à la main et revérifiées, type
`image/*` obligatoire, 20 Mo max. Replis : nouvel essai (réseau, 5xx, 429), URL
redemandée à la source (URL signée expirée), puis la même page chez une autre
source **si** sa version a le même nombre de pages (`n`) — servie avec
`X-Reader-Fallback: <source>` et 5 min de cache, jamais gardée par le Service Worker.

> Limite connue : la vérification DNS précède la connexion (fenêtre de *DNS
> rebinding* théorique). La fermer demanderait un agent `undici` avec `lookup`
> vérifié à la connexion.

**Contrat OpenComicStream** (pour brancher une API JSON maison) :

```
GET {OPEN_COMIC_API_URL}/chapters?mangadexId=<uuid>&title=<titre>&title=…
  → { "chapters": [{ "id", "number"?, "volume"?, "title"?, "language": "fr"|"en",
                     "pages"?, "groups"?: (string | { id?, name })[], "publishedAt"? }] }
GET {OPEN_COMIC_API_URL}/chapters/{id}/pages
  → { "headers"?: { "Referer": … }, "pages": [url | { "url", "headers"? }] }
```

**Bibliothèques personnelles (Komga, Kavita).** `OPEN_COMIC_KIND=komga|kavita`
choisit l'adaptateur (`providers/komga.provider.ts`, `kavita.provider.ts`),
écrits d'après le code source des deux projets.

- *Komga* : `X-API-Key` (clé d'API, Komga ≥ 1.16) ou Basic (`OPEN_COMIC_USER` /
  `OPEN_COMIC_PASSWORD`) ; série cherchée par titre (`/api/v1/series?search=`,
  titres alternatifs compris), livres triés par `metadata.numberSort`. Un livre
  nommé « Tome 2 », « T02 », « Vol. 2 » devient un **tome** (`volume`), sinon un chapitre.
- *Kavita* : la clé d'API est échangée contre un jeton (`POST
  /api/Plugin/authenticate`), renouvelé seul sur un 401 ; une clé refusée n'est
  pas réessayée en boucle. Volumes : numéros réservés gérés (`-100000` = hors
  volume / tome entier, `100000` = hors-séries).
- Dates sans fuseau (les deux logiciels) lues comme UTC ; `0001-01-01` = inconnue.
- Images : la source les télécharge elle-même (`SourceProvider.fetchImage`),
  **seulement depuis l'origine configurée**, sans suivre de redirection. C'est ce
  qui permet une adresse privée (`http://komga:25600`) que les garde-fous SSRF du
  relais générique refuseraient ; clés et URL internes ne quittent jamais le serveur.

**Consumet** : client d'une instance **auto-hébergée** de l'API Consumet, pour un
catalogue (`CONSUMET_PROVIDER`, `mangadex` par défaut) et une langue
(`CONSUMET_LANGUAGE`). Les schémas acceptent les variantes connues des catalogues
(numéro dans `chapterNumber`, `chapter` ou le titre) ; les routes `info` / `read`
prennent l'identifiant dans le chemin pour `mangadex`, en paramètre sinon.
Écrit d'après la forme documentée de l'API, **non vérifié contre une instance
réelle** : à valider avant activation en production.

### Extensions Tachiyomi / Mihon (pont Suwayomi)

Les extensions communautaires (dépôt Keiyoushi : ~450 sites fr / en — Asura
Scans, Flame Comics, MangaKakalot, Scantrad, Sushi-Scan…) sont des APK Kotlin.
L'API ne les exécute pas : un conteneur **Suwayomi-Server** (service `suwayomi`,
profil Compose `tachiyomi`) les charge dans sa JVM et expose une API GraphQL,
sur le réseau interne seulement (aucun port publié en production).

```
extensions/providers/
  suwayomi.client.ts          client GraphQL (zod) : sources, recherche, chapitres, pages, extensions
  tachiyomiBridge.provider.ts  SourceProvider `tachiyomi` : un fournisseur, N sites
  tachiyomiExtensions.ts       installation au démarrage (TACHIYOMI_EXTENSIONS), avec nouveaux essais
extensions/tachiyomi.cli.ts    CLI : extensions [fr|en] · install <paquet…> · sources
```

**Un fournisseur, plusieurs sources.** Chaque chapitre porte son site d'origine
(`NormalizedChapter.origin`) ; l'agrégateur le publie sous
`tachiyomi:<id du site>` avec le nom du site. Badge, fusion (un site = une
source : une version par site en `alternates`) et sélecteur du lecteur le
traitent comme une source à part entière ; le site hérite de la priorité du
fournisseur (20). Origine invalide → provenance `tachiyomi` ; toujours préfixée,
elle ne peut pas se faire passer pour `mangadex` ni pour une autre source.

**Liste.** Sites actifs = sources des extensions installées, dans
`TACHIYOMI_BRIDGE_LANGUAGES`, sans les sites « adultes » (sauf
`TACHIYOMI_BRIDGE_NSFW=true`), filtrés par `TACHIYOMI_SOURCES`, plafonnés à
`TACHIYOMI_BRIDGE_MAX_SOURCES` (liste gardée 10 min, 1 min si vide). Pour chaque
site, **en parallèle** : 2 recherches (titres MangaDex, cf.
*Titres*), meilleur résultat ≥ 80 % (suites refusées), puis ses chapitres.
Correspondance gardée 6 h, absence 30 min ; un échec (délai, panne) n'est
jamais retenu comme une absence. Chapitres : `chapterNumber` (Float Kotlin,
arrondi au centième ; `-1` → déduit du nom), titre débarrassé de la numérotation
(« Ch. 12 - Le retour » → « Le retour »), `scanlator` crédité, `pageCount = -1` → 0.

**Tenue dans le temps.** Chaque appel au pont est borné par
`TACHIYOMI_BRIDGE_TIMEOUT_MS` (**3 s**) : un site plus lent est abandonné pour
cette requête, les autres sont servis. Trois étapes au plus (sites, recherche,
chapitres) : le fournisseur entier est borné à 3 × 3 s + 1 s. Il n'échoue que si
**tous** ses sites échouent ; le disjoncteur de l'agrégateur cesse alors de
l'interroger (3 échecs → 60 s de pause). Pont éteint : refus de connexion
immédiat, `sources[]` le marque `failed`, le reste du catalogue est servi.

**Pages et images.** `fetchChapterPages` renvoie des chemins de Suwayomi
(`/api/v1/manga/<id>/chapter/<n>/page/<i>`), qui télécharge l'image chez le site
**avec les en-têtes exigés par l'extension** (Referer, User-Agent, cookies
Cloudflare) : pas de 403. Le relais `/api/proxy` passe par `fetchImage`
(`originImageFetcher`) : origine du pont **seulement**, aucune redirection suivie,
`TACHIYOMI_BRIDGE_IMAGE_TIMEOUT_MS` (15 s : c'est le contenu, pas une
métadonnée). Ni l'adresse interne ni le site d'origine n'atteignent le navigateur.

**Extensions.** Pas de route HTTP (aucun rôle administrateur, et installer un
APK exécute du code tiers) :

- `TACHIYOMI_EXTENSIONS=en.asurascans,fr.mangascantrad` (forme courte ou nom de
  paquet complet) : installées — ou mises à jour — au démarrage, en tâche de
  fond, une à une ; nouvel essai toutes les 30 s (10 fois) tant que la JVM démarre ;
- CLI : `npm run tachiyomi -w backend -- extensions fr en` (catalogue, `OK` /
  `MAJ` = installée / mise à jour disponible), `install <paquet…>`, `sources` ;
  en production `docker compose exec backend node dist/extensions/tachiyomi.cli.js …`.

**Dépôt.** `EXTENSION_STORES` du conteneur (`TACHIYOMI_EXTENSION_STORES`, Keiyoushi
par défaut). Désormais le dépôt Keiyoushi (et ses miroirs, dont
`everfio/tachiyomi-extensions`) ne publie plus qu'un `index.min.json` factice
(« Outdated App ») : le vrai catalogue est `index.pb` (format « Extension Store »
de Mihon), annoncé par `repo.json`. Suwayomi le suit seul **à partir de v2.3**
— d'où l'image épinglée `v2.3.2243` (`stable`). Catalogue vide après
`extensions` : vérifier la version de l'image et `TACHIYOMI_EXTENSION_STORES`.

**Cloudflare.** Certains sites (Manga-Scantrad, Mangakakalot…) exigent un défi
Cloudflare : sans aide, Suwayomi répond `Cloudflare bypass currently disabled`
(journalisé tel quel, avec la piste ci-dessous). Service `flaresolverr` (Chromium
sans écran, profil `flaresolverr`) : `COMPOSE_PROFILES=tachiyomi,flaresolverr` et
`TACHIYOMI_FLARESOLVERR_ENABLED=true`. Le premier passage d'un site résout le défi
(5 à 20 s : au-delà du délai de 3 s, ce site manque à cette requête-là) ; le
cookie `cf_clearance` obtenu sert ensuite aux requêtes suivantes. Si un site
reste en échec, relever `TACHIYOMI_BRIDGE_TIMEOUT_MS` (ex. 20000) le temps d'un
premier chargement, puis revenir à 3000.

**Déploiement.** `.env` : `COMPOSE_PROFILES=tachiyomi`, `TACHIYOMI_BRIDGE_ENABLED=true`,
`TACHIYOMI_EXTENSIONS=…`, puis `docker compose up -d`. RAM : tas Java borné
(`SUWAYOMI_MAX_HEAP=512m`, conteneur `SUWAYOMI_MEM_LIMIT=1g`). Compte facultatif :
`TACHIYOMI_BRIDGE_AUTH_MODE=basic_auth` + `TACHIYOMI_BRIDGE_USER` / `_PASSWORD`
(les deux conteneurs les reçoivent).

Écrit d'après le code de Suwayomi-Server v2.3 (`graphql/mutations`, `graphql/types`)
et testé contre un Suwayomi simulé (`test/tachiyomi.test.ts`) : **à valider contre
une instance réelle** avant d'ouvrir le pont en production.

### Plateformes officielles (titres sous licence)

Un titre sous licence (*Solo Leveling*, *L'Attaque des Titans*…) n'a aucun chapitre
hébergé. `modules/chapters/official.*` rassemble où le lire **officiellement** :

- les liens officiels de la fiche MangaDex : `links.raw` (éditeur d'origine :
  KakaoPage, Pocket Magazine…) et `links.engtl` (édition anglaise : Tappytoon,
  VIZ…), en https, nommés d'après la plateforme ; les autres liens (boutiques,
  bases de données) sont ignorés ;
- Tri : langue de l'interface, puis l'autre (fr / en), puis la langue
  d'origine ; 8 au plus. Liens bruts gardés 24 h (10 min si MangaDex a manqué).

Exposés par `GET /api/manga/:id/platforms?lang=` (UUID MangaDex, pour la fiche
livre) et dans `officialPlatforms` de la liste des chapitres (écran « aucun
chapitre » du lecteur ; 4 s au plus, jamais d'erreur).

Tests : `backend/test/official.test.ts`, `backend/test/library.test.ts`
(Komga de bout en bout sur une adresse privée, adaptateur Kavita),
`backend/test/extensions.test.ts` (fusion, disjoncteur, agrégateur avec
fausses sources, identifiants, garde-fous) et `backend/test/sources.test.ts`
(bout en bout, MangaDex + OpenComicStream + Consumet simulés via `mockedHosts`).

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
| GET | `/api/manga/:id?lang=` | `{ book }` — `:id` = UUID MangaDex |
| POST | `/api/discover/deck` | deck recommandé, voir §7 ter — `origins: ['manga','manhwa']` pour plusieurs origines à la fois |
| POST | `/api/discover/browse` | recherche et filtres du catalogue, voir §7 quater |
| GET | `/api/discover/genres?lang=` | `{ genres: { id, label, count }[] }` — filtres de genre |
| GET | `/api/covers/:mangaId/:fileName?size=512\|256` | image |
| GET | `/api/health` | `{ status: 'ok' }` |

### Lecteur (public)

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/api/manga/:id/chapters?lang=fr|en` | `{ mangaId, language, available: { fr, en }, sources: [{ id, name, status, chapters }], chapters: [{ …, source, alternates[] }] }` |
| GET | `/api/chapters/:chapterId/pages?quality=data|data-saver&alt=k1,k2` | `{ chapterId, servedBy, source, fallback, quality, pages: [{ index, url, fallbackUrl }] }` |
| GET | `/api/chapters/:chapterId/image/:quality/:file` | l'image (relais MD@Home) |
| GET | `/api/proxy/page/:chapterKey/:index?n=&alt=` | l'image (relais des autres sources, cf. §3 ter) |
| GET | `/api/manga/:id/platforms?lang=` | `{ platforms: [{ name, url, language }] }` — `:id` = UUID MangaDex |

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

| PATCH | `/api/library/progress` | `{ workId, position, chaptersRead?, progress?, status?, at? }` | position du lecteur ; compteur de chapitres (ne recule jamais) |

`book` est obligatoire sauf pour `skipped`, et `book.id` doit valoir `mangaId`.
Toutes ces opérations sont idempotentes : la file du front peut les rejouer sans
risque.

### Romans (cf. §7 sexies)

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/api/books/search?q=&lang=fr\|en` | — | `{ results: Book[] }` (`kind: 'book'`) — **public**, 40 / min / IP |
| POST | `/api/books/discover` | `{ shelf, lang, limit?, round?, seen?, skipped?, liked? }` | `{ books, hasMore, personalized }` — deck « Romans », **public** |
| GET | `/api/books/summary/:id` | — | `{ synopsis }` — résumé d'un roman du deck (`ol:OL…W`), **public** |
| POST | `/api/books/upload?lang=` | le fichier EPUB **brut** (`Content-Type: application/epub+zip`, nom dans `X-File-Name`, encodé URI) | 201 `{ book, duplicate: false }` · 200 `{ book, duplicate: true }` si déjà importé · 413 `file_too_large` / `quota_exceeded` · 415 · 422 `invalid_epub` |
| GET | `/api/books` | — | `{ books }` — derniers lus d'abord |
| GET | `/api/books/:id` | — | `{ book }` |
| GET | `/api/books/:id/file` | — | le fichier, en flux ; `Range` → 206, plage impossible → 416 |
| GET | `/api/books/:id/cover` | — | la couverture extraite du fichier (404 s'il n'en a pas) |
| PATCH | `/api/books/:id/progress` | `{ cfi, percent (0-100), at }` | `{ applied, book }` — `applied: false` si une position plus récente existe |
| PATCH | `/api/books/:id` | `{ title?, author?, synopsis?, coverUrl?, publisher?, year?, pages? }` | `{ book }` — `coverUrl` : Open Library / Google Books en HTTPS, `null` = celle du fichier |
| DELETE | `/api/books/:id` | — | 204, fichiers effacés du disque |

Toutes authentifiées sauf `search`. Le livre d'un autre compte répond **404**
(jamais 403 : son existence ne fuit pas).

---

### Marché d'échange (cf. §7 septies)

| Méthode | Route | Corps / requête | Réponse |
| --- | --- | --- | --- |
| GET | `/api/trades` | `?rarity=EPIC&series=1\|2&fillable=1` | `{ offers }` — offres ouvertes des AUTRES comptes, 100 au plus, les plus récentes d'abord |
| GET | `/api/trades/mine` | — | `{ offers }` — mes offres ouvertes, puis l'historique (échangées, annulées, et celles que j'ai acceptées) |
| POST | `/api/trades` | `{ offeredCardId, requestedCardId }` | 201 `{ offer }` · 409 `not_duplicate` / `offer_exists` / `offer_limit` · 400 `rarity_mismatch` / `same_card` · 404 |
| POST | `/api/trades/:id/accept` | — | `{ offer, received, given }` · 409 `offer_closed` / `card_not_available` / `offer_unavailable` · 400 `own_offer` |
| DELETE | `/api/trades/:id` | — | `{ offer }` (annulée) · 404 (offre d'un autre) · 409 `offer_closed` |

Toutes authentifiées. Une offre porte `mine`, `canAccept` (exemplaire libre de la carte demandée) et
`ownsOffered` ; le créateur n'est exposé que par son id et son pseudo, jamais son e-mail.

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

- **Paquets** (`modules/oracle/decks.ts`) : 15 ambiances (genres MangaDex exigés,
  ou un marqueur parmi les genres et thèmes : « isekai » = Isekai / Reincarnation)
  et 4 rythmes (courte ≤ 60 ch. terminée, épique, terminée, en cours). MangaDex
  ne donne souvent le dernier chapitre que des séries terminées :
  « épique » = ≥ 150 ch. connus OU en cours depuis au moins 6 ans. Les ids sont
  le contrat avec le front, qui porte libellés, icônes et couleurs.
- **Déterministe** : la graine `<id>:<jour>` fixe ambiance, rythme et ordre des
  titres (FNV-1a + Mulberry32, `lib/seeded.ts`). Connecté, la graine est l'id du
  compte : même tirage sur tous les appareils ; on ne « relance » pas en
  rechargeant. Le client applique le même algorithme pour son tirage hors-ligne.
- **Sélection** (catalogue MangaDex, §7 ter) : œuvres de l'ambiance notées ≥ 72,
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
recommandation sur un **catalogue MangaDex**, en cache local. MangaDex est la
seule source de métadonnées (AniList a été retiré).

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/api/discover/deck` (session facultative) | `{ shelf, origin, lang, limit, seen[], liked[{ id, categories, rating, favorite, userRating }], skipped[] }` | `{ books: (Book & { matchPercentage, discovery })[], hasMore, source, personalized }` |

**Catalogue** (`src/services/catalog.service.ts`)

- Une ligne `CatalogWork` par œuvre MangaDex (clé : son UUID). Caractéristiques
  tirées de la fiche : tags du groupe `genre` → genres, du groupe `theme` →
  thèmes (MangaDex ne pondère pas ses tags : chacun compte à 100 %), tags de
  format et de contenu ignorés. Note = note bayésienne MangaDex (/10, ramenée
  sur 100 pour le moteur), popularité = nombre de suivis (`/statistics/manga`),
  pays = langue originale (`ja` → JP, `ko` → KR, `zh` / `zh-hk` → CN).
  Contenu adulte (`erotica`, `pornographic`) jamais indexé.
- **Indexeur** (au démarrage si la dernière indexation complète a plus de 24 h,
  puis chaque jour ; `CATALOG_SYNC=off` le coupe, toujours coupé en test) :
  les œuvres les plus suivies par langue d'origine (japonais 16 pages, coréen 9,
  chinois 5, 100 œuvres par page) puis 3 pages « mieux notées », avec leurs
  statistiques par lots de 100. ≈ 3 000 œuvres, une soixantaine de requêtes
  espacées par le limiteur MangaDex : environ une minute, en arrière-plan.
  Une première vague (une page par origine) sert le deck après quelques secondes.
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
  envoyé et cartes déjà en file (`seen`) sont exclus.
- **80/20** : une carte sur cinq (`discovery: true`) vient d'un genre peu
  exploré (aucun de ses genres à |score| ≥ 3) et très bien noté (> 80 %).
- **Étagères** : « Pour toi » (tout le catalogue), « Tendances » (popularité
  d'abord), genres MangaDex (Action, Romance…) ; `origin` filtre JP / KR / CN.

## 7 quater. Recherche dans le catalogue

`POST /api/discover/browse` (session facultative, même historique que le deck) :
`{ q, origin, genres[], status: any|ongoing|completed, minScore (0-95, sur 100),
sort: relevance|match|popularity|score|recent, page, limit, lang, source }` →
`{ books (avec matchPercentage), total, page, hasMore, supplement, personalized }`.

- **En mémoire** sur le pool (champs `status`, `chapters`, `year`,
  `searchText` ajoutés au pool et à `CatalogWork`, calculés à l'indexation et
  une fois pour un catalogue existant) : 3-5 ms mesurés.
- **Texte** : `searchText` = titres MangaDex de toutes les langues,
  titres alternatifs et auteurs, en minuscules sans accents ni ponctuation.
  Chaque mot doit apparaître ; un titre qui commence par la requête passe devant.
- **Genres** (MangaDex) combinés en ET ; note, statut et tri comparent la note
  bayésienne MangaDex, celle que les cartes affichent.
- **Complément MangaDex** : si une recherche textuelle a moins de 8 résultats,
  `supplement: true` ; le front demande alors `source: 'mangadex'` APRÈS avoir
  affiché le catalogue (la réponse principale ne dépend jamais du réseau).
  Doujinshi exclus ; une œuvre déjà au catalogue n'est pas proposée deux fois.

## 7 quinquies. Boosters et collection de cartes (`src/modules/cards/`)

Le stock d'un compte vit côté serveur, dont l'horloge est la seule qui compte
(un invité ne pourrait tricher que sur la sienne). Sans compte : 2 boosters
d'essai, puis l'inscription (voir « Invités » plus bas).

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/api/boosters/status` (auth) | — | `{ available, max, secondsUntilNext, nextBoosterAt, intervalSeconds, serverTime }` |
| POST | `/api/boosters/open` (auth) | — | `{ cards: [{ card, isNew, count }], status }` — 409 `no_booster` (+ `secondsUntilNext`), 503 `collection_not_ready` |
| GET | `/api/cards/collection` (auth) | — | `{ total, owned, byRarity, cards: [{ …carte, owned, count, isFavorite, obtainedAt }] }` |
| PATCH | `/api/cards/:cardId/favorite` (auth) | `{ isFavorite }` | 204 ; 404 si la carte n'est pas possédée |
| POST | `/api/boosters/guest/open` | `{ receipts }` | `{ cards, receipt, remaining }` — 409 `guest_limit` après 2 essais ; 12/h par IP |
| POST | `/api/cards/guest/collection` | `{ receipts }` | album au format de `/cards/collection`, reconstitué depuis les reçus |

**Base** (migration `cards_and_boosters`) : `UserBooster` (userId, availableBoosters,
lastClaimedAt, nextBoosterAt), `Card` (id, number, title, characterName, imageUrl,
rarity, mangaId), `UserCard` (userId, cardId, obtainedAt, isFavorite, count).

**Stock** (`boosters.logic.ts`, pur, testé) : 2 au plus, 1 toutes les 3 h. Aucune
tâche de fond : le stock est recalculé à la lecture depuis `nextBoosterAt`.
Chaque échéance passée ajoute un booster, la suivante part de l'échéance (le
retard n'est pas perdu) ; stock plein → plus de minuteur ; ouvrir depuis un
stock plein lance le minuteur, ouvrir ensuite ne le remet pas à zéro.

**Tirage** : une rareté par carte — Commune 60 %, Rare 25 %, Épique 10 %,
Légendaire 4 %, Mythique 1 % — la 3ᵉ carte garantie Rare ou mieux (mêmes
proportions sans les Communes). Puis une carte au hasard dans la rareté, sans
doublon dans un même booster tant que le set le permet ; rareté absente → la
voisine. Doublons entre boosters : `count` augmente.

**Ouverture atomique** : dépense et cartes dans une même transaction ; la
dépense n'aboutit que si `(availableBoosters, nextBoosterAt)` n'a pas changé
depuis la lecture (verrou optimiste : ce couple change à chaque consommation).
Quatre ouvertures simultanées avec 2 boosters → 2 réussites, 2 × 409.

**Set de cartes** : une carte = une œuvre du catalogue MangaDex (couverture,
titre anglais ; `characterName` vide). 300 cartes générées au premier besoin
(une fois le catalogue indexé) : les plus suivies de chaque origine (60 %
manga, 30 % manhwa, 10 % manhua), classées par prestige (note bayésienne +
notoriété) → 10 Mythiques, 20 Légendaires, 50 Épiques, 80 Rares, 140 Communes,
numérotées des plus rares aux plus communes. Catalogue pas prêt → 503, et aucun
booster n'est dépensé (ni jamais un booster sans cartes à tirer).

**Agrandir le set** : augmenter `SET_LAYOUT` (`boosters.logic.ts`) suffit.
Au premier besoin, `growCardSet` complète le set sans rien retirer ni changer :
les cartes existantes (et donc les collections) gardent identité et rareté ;
les nouvelles œuvres comblent les quotas manquants de chaque rareté, par
prestige, en respectant la répartition des origines sur le set entier ; puis
l'album entier est renuméroté. Un agrandissement incomplet (catalogue trop
maigre) n'empêche jamais d'ouvrir un booster, et n'est retenté qu'après 10 min.

**Mode recette** (`BOOSTER_UNLIMITED_MODE=true`) : ni stock ni minuteur — le
statut répond `unlimited: true` et une réserve pleine, l'ouverture ne touche pas
au stock enregistré, le limiteur de débit passe de 20 à 600 ouvertures/min. Les
cartes tirées sont **bien enregistrées** (on éprouve les vrais taux sur un vrai
album). Côté serveur uniquement : un interrupteur côté client serait une porte
de triche. Avertissement dans les journaux au démarrage ; à couper en production.

**Invités** (`guestPacks.ts`) : 2 boosters d'essai (`GUEST_BOOSTERS`), tirés
comme ceux d'un compte mais **rien n'est enregistré** : chaque tirage revient
avec un reçu signé HMAC (clé dérivée de `JWT_SECRET`) qui liste ses cartes.
L'appareil garde ses reçus (`bookshelf:guest-cards:v1`) ; ils sont l'album de
l'invité. À l'inscription (`POST /auth/register/verify`, champ `guestPacks`), les
reçus valides et distincts (2 au plus) deviennent des cartes du compte, qui
démarre avec sa réserve pleine (2 boosters) : 4 boosters en tout. La réponse
donne `guestCards` (cartes ajoutées). Seule l'inscription réclame les reçus :
à la connexion, un compte existant pourrait sinon gagner 2 boosters à chaque
reçu effacé. Limites assumées : effacer ses reçus redonne 2 essais (bornés par
IP), et un même reçu peut servir à plusieurs NOUVEAUX comptes (e-mail vérifié
à chaque fois) — sans enjeu tant que les cartes ne s'échangent pas.

Tests : `backend/test/cards.test.ts` (régénération, probabilités sur 200 000
tirages, garantie, set, API de bout en bout, concurrence, horloge serveur, recette, invités et reçus falsifiés, réclamation à l'inscription).

## 7 sexies. Romans EPUB (`src/modules/books/`)

Un compte importe ses romans (EPUB) ; le fichier est stocké par l'API et la
position de lecture suit le compte : commencé sur le téléphone, le livre reprend
sur l'ordinateur **à la même phrase** (CFI EPUB).

```
books/
  epub.parser.ts        métadonnées embarquées (fflate + lecture tolérante de l'OPF) — pur, testé
  metadata.normalize.ts fiches Open Library / Google Books → forme commune, fusion, rapprochement — pur, testé
  metadata.service.ts   appels sortants : cache, disjoncteur par source, délais
  books.service.ts      réception en flux, import, quota, position, fiche, suppression
  books.routes.ts       /api/books/*
```

**Modèle `UserBook`** : `title`, `author`, `coverUrl` (couverture choisie en
ligne), `filePath` / `coverPath` (relatifs à `BOOKS_DIR`), `fileSize`, `sha256`,
`format` (`EPUB`), `synopsis`, `language`, `publisher`, `year`, `pages`,
`progressPercent` (0 → 100), `lastCfi`, `progressAt` (horodatage client),
`updatedAt`. Unicité `(userId, sha256)` : le même fichier importé deux fois (deux
appareils) donne la fiche existante (`duplicate: true`), rien n'est stocké en double.

**Import** (`POST /api/books/upload`) :

1. refus immédiat, avant de lire le corps : type, `Content-Length` > `BOOKS_MAX_UPLOAD_MB`
   (50 Mo), quota du compte (`BOOKS_QUOTA_MB`, 2 Go). Le corps refusé est tout de même
   lu et jeté : un navigateur encore en train d'envoyer ne verrait sinon qu'une
   connexion coupée, jamais le 413 (au-delà de 4 × la limite, la connexion est fermée) ;
2. corps écrit en flux dans `BOOKS_DIR/.tmp`, empreinte SHA-256 calculée au passage,
   coupé net au-delà de la limite (client qui ment sur sa taille) ;
3. `parseEpub` : `META-INF/container.xml` → OPF → titre, auteurs (rôle `aut`, EPUB 2
   et 3), langue, résumé (HTML retiré), éditeur, date de publication, ISBN,
   couverture (`cover-image`, `<meta name="cover">`, page de couverture du guide,
   image nommée « cover »), reconnue à ses octets. Seules ces entrées sont
   décompressées, plafonnées (2 Mo de texte, 10 Mo d'image) : pas de bombe ZIP ;
4. fiche en ligne (`lookupNovel`, 5 s au plus) : même ISBN, sinon même titre ET même
   auteur — mieux vaut aucune fiche que le résumé d'un autre livre. Elle complète le
   résumé, la pagination, la parution, et la couverture si le fichier n'en a pas ;
5. déplacement atomique vers `BOOKS_DIR/<userId>/<sha256>.epub` (+ `.cover.<ext>`).
   Les chemins ne viennent jamais d'une saisie.

Corps **brut** plutôt que multipart : un seul flux vers le disque, sans tampon
mémoire ni dépendance (multer, busboy).

**Fichier** (`GET /:id/file`) : `res.sendFile` (module `send`) gère `Range`,
`If-Range`, `ETag`, 206 / 304 / 416 ; `Cache-Control: private, no-store` — le
front garde sa copie dans IndexedDB, inutile d'en garder une seconde en cache HTTP.

**Position** (`PATCH /:id/progress`) : mise à jour **conditionnelle** en une requête
(`progressAt` nul ou plus ancien) : la plus récente gagne, deux envois simultanés
ne peuvent pas s'écraser dans le mauvais ordre, et un téléphone resté hors-ligne
qui se reconnecte ne fait pas reculer l'ordinateur (`applied: false`, la réponse
porte la position qui fait foi). Un `at` dans le futur (horloge en avance) est
ramené à maintenant, sans quoi il figerait la position pour tous les appareils.

**Fiches en ligne** (`searchNovels`) : Open Library (`search.json`, `lang=`) et
Google Books (`volumes`, **une requête par langue** : `langRestrict` n'en accepte
qu'une) en parallèle. Fusion par titre + nom du premier auteur ; la fiche dans la
langue voulue sert de base, l'autre la complète (résumé Google, pagination Open
Library, première parution). Classement : rang dans la source, proximité avec la
requête, langue, complétude. Résumés Open Library hydratés (`/works/<id>.json`) pour
les 6 premières fiches, dans un budget de 2,5 s. Couvertures : `-L.jpg` d'Open
Library ; Google en HTTPS, sans `edge=curl`, agrandie par `fife=w800-h1200`.
Cache 6 h (5 min si une source a manqué), résumés 24 h. Disjoncteur par source :
Google Books sans clé (`GOOGLE_BOOKS_API_KEY`) renvoie vite 429, il est alors laissé
tranquille 10 min et Open Library répond seule ; les deux en panne → 502.

**Deck « Romans »** (`novels.discover.ts`, pur, testé) : le deck de Découverte propose
aussi des romans (case « Romans » du filtre, seule ou avec les mangas), avec leurs étagères — Pour toi, Tendances,
Romance, Fantasy, Thriller, Science-fiction, Mystère, Horreur, Historique, Young
adult, Classiques. Chaque étagère est un sujet Open Library, restreint aux œuvres
ayant une édition dans la langue voulue (`language:fre|eng`), triées par
popularité (`readinglog`). « Pour toi » : les trois genres les plus fréquents
parmi les romans gardés (catégories Open Library / Google Books), triés par note ;
sans historique, les romans les mieux notés. `lang=` fait choisir à Open Library
l'édition de la langue : titre et couverture français (« Le Nom de la Rose » plutôt
que « Il nome della rosa »), ce qui profite aussi à la recherche. Déjà vus, passés
ou gardés : exclus ; « Nouvelle sélection » (`round`) repart plus loin dans le
classement. Résumés (souvent en anglais sur Open Library) chargés à l'approche de
la carte, Markdown retiré.

Tests : `backend/test/books.test.ts` (38) — analyseur (EPUB 2 et 3, CDATA,
entités, guide, couverture démesurée, refus), normalisation et fusion, puis l'API
(recherche et pannes de sources, 401 / 413 / 415 / 422, import enrichi,
doublon, `Range` / 416, position entre deux appareils, position périmée, horloge
en avance, fiche corrigée, isolement entre comptes, quota, suppression).

## 7 septies. Marché d'échange de doublons (`src/modules/trades/`)

Un compte propose un doublon contre une carte **de même rareté** ; un autre accepte, et les deux cartes
changent de main dans une seule transaction. Invités exclus (leurs cartes d'essai ne sont que des reçus).

**Modèle `TradeOffer`** (migration `trade_offers`) : `userId` (créateur), `offeredCardId`,
`requestedCardId`, `status` (`OPEN` · `COMPLETED` · `CANCELLED`, validé par l'API), `acceptedById`,
`createdAt`, `updatedAt`.

**Réservation** (sans colonne dédiée : déduite des offres ouvertes). On ne propose une carte que s'il en
reste au moins deux exemplaires LIBRES : un pour l'offre, un que l'on garde toujours. Pour accepter, on
cède un exemplaire libre de la carte demandée — le dernier est permis (« en double ou simple »), mais pas
un exemplaire réservé par ses propres offres ouvertes. 20 offres ouvertes au plus, jamais deux identiques.

**Aucune carte créée ni perdue.** Chaque écriture décisive est conditionnelle (`updateMany … where`) et
son résultat vérifié ; une condition qui ne tient plus fait échouer toute la transaction, rien n'est
écrit :

1. l'offre passe de `OPEN` à `COMPLETED` (`where status = 'OPEN'`) — un seul acceptant y parvient ;
2. le créateur cède son doublon (`where count >= 2`) ;
3. celui qui accepte cède la carte demandée (`where count >= requis`, réservations comprises) ;
4. chacun reçoit la carte de l'autre (`upsert`).

Sous PostgreSQL, la première écriture verrouille la ligne ; une transaction concurrente attend, relit la
condition et ne passe plus (409). SQLite sérialise les écritures. La création verrouille aussi la ligne
« carte possédée » (écriture neutre) : deux offres simultanées sur le même doublon passent l'une après
l'autre, et la seconde voit la réservation de la première.

**Profil.** Une carte cédée jusqu'au dernier exemplaire quitte l'album (ligne supprimée), et avec lui
l'avatar et la vitrine du profil, qui ne montrent jamais une carte non possédée.

Tests : `backend/test/trades.test.ts` — doublon exigé, réservation, rareté, filtres du marché, échange
et conservation des cartes, refus sans effet, acceptations et créations **simultanées**, deux offres du
même doublon acceptées en même temps, avatar nettoyé, annulation, historique.

## 8. Limites connues et suites possibles

- Les entrées de bibliothèque créées du temps d'AniList depuis une carte
  « AniList seule » gardent leur id `al-<id>` et leur instantané : elles
  s'affichent toujours, sans fiche détaillée, lecture ni plateformes officielles.
- Sans AniList, les plateformes officielles se limitent aux liens de la fiche
  MangaDex (éditeur d'origine, édition anglaise) : moins de plateformes
  françaises (Delitoon, ONO…) qu'avant.

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
  `backend/src/modules/books/book.schema.ts`), de même que `CloudBook`
  (`frontend/src/types/novel.ts` et `toDto`). Un troisième workspace `shared`
  s'imposera si les contrats continuent d'évoluer.
- Romans : les fichiers sont sur le disque de l'API (volume `books_data`), donc
  propres à une instance ; en multi-instance, passer sur un stockage objet (S3…).
  La suppression d'un compte n'efface pas encore ses fichiers (la base, si : cascade).
  Un envoi en `Transfer-Encoding: chunked` qui dépasse la limite est coupé net :
  le client voit une erreur réseau, pas le 413 (les navigateurs annoncent toujours
  la taille d'un `File`).
