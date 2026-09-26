# Bookshelf — passation

Contexte destiné à la personne (ou à l'agent) qui reprend ce code. Le
[README](../README.md) présente le produit ; [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md),
[`docs/BACKEND.md`](../docs/BACKEND.md), [`docs/DOCKER.md`](../docs/DOCKER.md) et
[`docs/DEPLOY-VPS.md`](../docs/DEPLOY-VPS.md) expliquent **comment ça marche**. Ce
document-ci rassemble ce qui **ne se lit pas dans le code** : les décisions, les
pièges déjà payés, l'état de la production et ce qui a été vérifié ou non.

---

## 1. Le projet

Bibliothèque manga / manhwa mobile-first, en production sur
**https://bookshelf.findi.cc**. On découvre des œuvres en les swipant, on les range
dans une étagère, on cherche dans le catalogue, on tire un « Oracle » quotidien
(tirage de cartes façon tarot). Favoris et notes (demi-étoiles) sur les livres lus.
Dark mode, animations 100 % GSAP, installable en PWA. Compte facultatif (le mode
invité vit en localStorage et fusionne dans le compte à l'inscription). Interface
FR / EN.

**Monorepo npm workspaces** :

| Dossier | Contenu |
| --- | --- |
| `frontend/` | React 19 + Vite 8 + Tailwind 4 + GSAP + Zustand, service worker écrit à la main, Nginx en prod |
| `backend/` | Express 5 + Prisma 7 + zod 4, SQLite en local, PostgreSQL en Docker |
| `deploy/Caddyfile` | modèles de blocs Caddy (le Caddy de prod n'est pas dans ce dépôt, cf. §6) |
| `docs/` | documentation de référence |

## 2. Démarrer

```bash
npm install                  # à la racine : les deux workspaces (+ prisma generate)
npm run dev                  # API :5000 + front :5173 (proxy /api)
npm run typecheck            # tsgo (TypeScript 7), les deux workspaces
npm run lint                 # oxlint
npm test                     # API : node:test (101 tests) · front : audit i18n + tests unitaires du lecteur (50)
npm run build
npm run preview -w frontend  # seul moyen de tester le service worker (inactif en dev)
```

- Sans `.env`, l'API tourne avec des défauts de dev : SQLite `backend/prisma/dev.db`,
  secret JWT de dev, e-mails **affichés dans le terminal de l'API** (le code de
  vérification d'inscription s'y lit).
- Pile Docker complète en dev : `npm run docker:dev` (Postgres + HMR), cf. `docs/DOCKER.md`.
- Environnement de travail : Windows, Node 26 en local, `node:22-alpine` dans les
  images Docker (`engines: >=22`).

## 3. Stack et raisons

| Choix | Pourquoi |
| --- | --- |
| React 19 + React Compiler, Vite 8 (rolldown) | scaffold d'origine |
| GSAP + `@gsap/react` | exigence : **toutes** les animations passent par GSAP (`lib/gsap.ts`) |
| Tailwind 4 | CSS-first : tokens dans `@theme` de `src/index.css`, **aucun** `tailwind.config.js` |
| Zustand + `persist` | stores `bookshelf:{library,auth,oracle,settings}:v1` en localStorage |
| Express 5 | les erreurs async remontent seules au `errorHandler` (pas de try/catch par route) |
| Prisma 7 + driver adapters | `better-sqlite3` en local, `@prisma/adapter-pg` en Docker |
| zod 4 | validation des entrées API **et** de l'environnement (`src/config.ts`) |
| nodemailer | SMTP générique ; en prod : Gmail avec mot de passe d'application |

## 4. Carte du code

### Backend (`backend/src`)

```
config.ts          env validé par zod ; une variable VIDE vaut absente (cf. §5.10)
db.ts              choisit l'adaptateur Prisma selon DATABASE_URL (file: → SQLite, postgres → pg)
app.ts             montage des routeurs sous /api/*
lib/               cache TTL, erreurs HTTP, mailer, session JWT, mots de passe
middleware/        auth (cookie JWT), rate limit
modules/auth       inscription avec code e-mail, login, /me
modules/library    bibliothèque synchronisée, swipes, favoris / notes
modules/manga      recherche MangaDex, proxy des couvertures /api/covers
modules/chapters   lecteur : chapitres (/manga/:id/chapters), pages At-Home, relais des images
modules/discover   deck « Pour toi » et catalogue filtrable (/browse)
modules/oracle     tirage quotidien, série (streak)
services/          AniList, catalogue (AniList ⨝ MangaDex), moteur de recommandation
```

Modèles Prisma : `User`, `LibraryEntry`, `SkippedWork`, `UserPreference`,
`CatalogWork`, `CatalogSync`, `PendingRegistration`.

### Frontend (`frontend/src`)

```
App.tsx            coquille : rail / barre de nav, en-tête global, transitions de vue
lib/gsap.ts        enregistrement unique des plugins + vocabulaire EASE / DUR
services/api.ts    client fetch (cookie de session, ApiError avec details)
store/             library · auth · oracle · settings · search · ui
hooks/             useDiscoveryQueue (deck) · usePwaInstall · useCoverTone · useCatalog…
i18n/              fr.ts / en.ts, typés : une clé manquante casse le typecheck
components/        discover · library · search · tarot · profile · book · layout · ui · reader
lib/reader/        lecteur : progression, préchargement, navigation, formats (purs, testés), IndexedDB
workers/           prefetch.worker.ts (préchargement des pages hors du fil principal)
public/sw.js       service worker (cf. §7)
nginx.conf         SPA + relais /api en prod (cf. §5.11)
```

Conventions :

- aucun composant n'importe `gsap` directement : tout passe par `lib/gsap.ts` ;
- code et commentaires en français ; les commentaires expliquent le *pourquoi* ;
- tout texte d'interface passe par l'i18n (`npm test -w frontend` audite les deux langues).

---

## 5. Pièges déjà payés — à ne pas réintroduire

### 5.1 `vite.config.js` masque `vite.config.ts`

Vite résout le `.js` d'abord. Un fichier `.js` résiduel désactive le plugin Tailwind
sans erreur : le build « réussit » mais sort sans utilitaires. Vérifier ce point en premier.

### 5.2 `min-h-0` sur chaque maillon de la chaîne flex verticale

Sans `min-h-0`, un enfant flex garde `min-height: auto`, refuse de se comprimer et
le conteneur de défilement n'est jamais contraint : le bas de la page est coupé.
Contrat : `<main>` est une colonne flex, chaque vue est `flex-1 min-h-0`, jamais `h-full`.

### 5.3 `overflow: hidden` sur `html, body, #root`

La carte éjectée part hors écran ; sans découpe, elle crée un défilement horizontal
et un reflow. Le document ne défile jamais ; chaque vue gère son défilement.

### 5.4 Deck : la carte sortante vit dans `exiting`, `Draggable` est sur un proxy

`SwipeDeck` notifie la décision au `commit()` et garde la carte éjectée dans `exiting`
jusqu'à la fin de son animation. Une seule instance `Draggable`, sur un `<div>`
invisible couvrant la scène : les transforms des cartes restent la propriété des
timelines. Ne pas « simplifier » en attachant `Draggable` à la carte du dessus.
Swipe haut = « Lu » ; le bouton **Retour** annule la dernière décision.

### 5.5 Pas de filtre de flou sur les surfaces animées

Les `backdrop-filter` provoquaient des recompositions coûteuses pendant les gestes
(surtout mobile). Surfaces `glass*` = fonds sombres opaques + bordure ; halos =
dégradés radiaux dont seule la translation est animée.

### 5.6 `useGSAP` ne revert pas entre deux exécutions

Avec des dépendances et sans `revertOnUpdate`, il ne nettoie qu'au démontage.
Instance impérative → `dependencies: []` + cleanup ; animation qui repart de zéro →
`revertOnUpdate: true` ; animation de layout → dépendances sans revert. Animations
lancées depuis un gestionnaire d'événement → `contextSafe()`.

### 5.7 Un élément masqué par `autoAlpha` ne peut pas prendre le focus

`autoAlpha: 0` pose `visibility: hidden`. Le champ du code de vérification ne
recevait pas le focus pour cette raison : les étapes de l'`AuthSheet` animent
`opacity`, pas `autoAlpha`.

### 5.8 Sélecteurs Zustand qui créent un objet

Un sélecteur qui renvoie un nouveau `Set` / tableau à chaque appel (ex. `knownIds`)
provoque une boucle de rendu infinie en Zustand v5. Le calculer dans un `useMemo`.

### 5.9 Composant réutilisé pour un autre livre

`useState(book.cover)` ne se réinitialise pas quand la prop change : une fiche
réutilisée gardait l'image du livre précédent. `BookCover` remonte son contenu via
une `key` (`id:cover`). Même réflexe pour tout état dérivé d'une prop.

### 5.10 Variables d'environnement vides

Docker Compose transmet `VAR=` / `${VAR:-}` comme chaîne vide ; `z.enum` la rejetait
et l'API ne démarrait pas (`SMTP_SECURE=`, `COOKIE_SECURE=`). `config.ts` filtre les
valeurs vides avant validation. `TRUST_PROXY="true"` en texte ferait aussi planter
Express : `parseTrustProxy` convertit.

### 5.11 Nginx : une `location ~` regex passe avant un préfixe

La règle des images statiques (`location ~* \.(png|jpg…)$`) captait
`/api/covers/….jpg` et répondait **son propre 404** (mis en cache 24 h !) au lieu de
relayer vers l'API : toutes les couvertures MangaDex manquaient en prod. Correctif :
`location ^~ /api/` et `^~ /assets/`. Symptôme reconnaissable : un 404 en
`text/html` signé `Server: nginx` sur une URL `/api/...`.

### 5.12 Couvertures : chaîne de repli de `BookCover`

Originale → même URL avec `?retry=1` → `size=256` (ou `-M.jpg`) → couverture
typographique. Le délai « image bloquée » (12 s) ne démarre qu'à l'approche de
l'écran (IntersectionObserver) : sans ça, les images `lazy` plus bas dans une liste
basculaient en procédural avant même d'être demandées.

### 5.13 npm 11 et `overrides`

Des `overrides` pour des vulnérabilités transitives (mysql2, deepmerge-ts, via Prisma)
ont cassé l'arbre de dépendances. Retirés ; ne pas les remettre sans tester `npm ci`
dans l'image Docker.

### 5.14 Nginx : le worker de pdf.js est un `.mjs`

Le `mime.types` de Nginx 1.27 ne connaît pas `.mjs` : servi en
`application/octet-stream`, le navigateur refuse de lancer le worker et aucun PDF
ne s'ouvre. `frontend/nginx.conf` déclare `application/javascript` pour `.mjs`
dans `location ^~ /assets/`. Vérifié avec l'image `nginx:1.27-alpine`.

### 5.15 `PATCH /api/library/progress` avant `/:workId`

Sinon Express prend « progress » pour un identifiant d'œuvre. Un test le garde.

### 5.16 Service Worker : premier démarrage hors-ligne

À la première visite, la page charge ses JS / CSS AVANT que le Service Worker
n'en prenne le contrôle : ils n'étaient jamais mis en cache, et l'application ne
démarrait pas hors-ligne (le chapitre en cache devenait inaccessible). L'installation
lit maintenant `index.html` et précache les `/assets/` qu'il cite ; `cacheFirst`
compare avec `ignoreVary` (sinon `Vary: Origin` empêche une balise `crossorigin`
de trouver la copie précachée).

### 5.17 Titres sous licence : 0 chapitre lisible

Beaucoup de titres connus (*Solo Leveling*…) n'ont sur MangaDex que des liens
officiels externes, sans page hébergée : l'API les exclut et le lecteur affiche
« Aucun chapitre lisible ». Pour tester le lecteur : *Lecteur omniscient* (FR),
*Kaguya, you Should Reflect on your Actions* (EN).

---

## 6. Production

- **VPS OVH partagé** avec d'autres projets. Dépôt cloné dans `~/projects/bookshelf`.
- Le **Caddy n'est pas un service de l'hôte** : il tourne dans le conteneur d'une autre
  pile (`myplaylog`). Bookshelf rejoint son réseau Docker via `docker-compose.caddy.yml`
  (`COMPOSE_FILE` et `CADDY_NETWORK` dans `.env`) ; le bloc Caddy vise
  `bookshelf-frontend:80` et gère le HTTPS de `bookshelf.findi.cc`. Le Caddyfile de
  cette autre pile est monté en fichier unique : **ajouter** un bloc, ne jamais le remplacer.
- Ports de l'hôte déjà pris par les autres projets : vérifier avant d'en choisir un
  (`docker ps`, `ss -tlnp`). Le port publié n'écoute que sur `127.0.0.1`.
- L'alias réseau de l'API est **`bookshelf-api`** (et non `backend`) : sur le réseau
  partagé, un nom générique pourrait désigner le conteneur d'un autre projet.
- `.env` de prod : `TRUST_PROXY=2` (Caddy + Nginx), `COOKIE_SECURE=true`,
  `APP_URL=https://bookshelf.findi.cc`, SMTP Gmail. **Les secrets ne sont que sur le
  serveur** ; `.env` est ignoré par git, seul `.env.example` est versionné.
- Sans `SMTP_HOST` en production, l'inscription répond 503 `email_unavailable` (volontaire).

Mettre à jour :

```bash
cd ~/projects/bookshelf && git pull && docker compose up -d --build
docker compose ps && docker compose logs backend --tail=50
```

Diagnostiquer une couverture : `docker compose logs backend | grep covers` — chaque
échec amont y est journalisé avec le statut MangaDex ou l'erreur réseau.

## 7. PWA et service worker

- `public/sw.js`, écrit à la main. Documents : réseau d'abord ; `/assets/*` : cache
  d'abord, les JS / CSS d'entrée précachés à l'installation (lus dans `index.html`,
  cf. §5.16) ; couvertures (`/api/covers`, AniList, Open Library) :
  stale-while-revalidate, 200 images max, seules les vraies réponses image non
  opaques sont gardées ; pages de chapitre (`/api/chapters/…/image/…`) : cache
  d'abord, 400 max (sauf repli « Data Saver ») ; listes de chapitres et de pages :
  réseau d'abord, repli sur la dernière copie ; reste de `/api` : jamais en cache.
- **Pas de `skipWaiting`** : une nouvelle version prend la main au redémarrage suivant.
  Après un déploiement, fermer / rouvrir l'app (deux fois parfois).
- Changer de stratégie de cache → **incrémenter `VERSION`** (actuellement `v4`) pour
  purger les anciens caches.
- L'installation exige HTTPS : en HTTP, `usePwaInstall` renvoie `insecure` et
  `InstallCard` l'explique.

## 8. Données externes

- **AniList (GraphQL)** : métadonnées riches, couvertures `s4.anilist.co` (CORS ouvert,
  lu par `coverTone` pour la teinte des cartes).
- **MangaDex** : jointure via `links.al` ; les couvertures passent **obligatoirement par
  notre proxy** `/api/covers` (MangaDex refuse le hotlinking depuis un navigateur).
  Proxy : cache mémoire 300 entrées / 12 h, une nouvelle tentative sur erreur réseau ou 5xx.
- Le catalogue est alimenté en tâche de fond (`CATALOG_SYNC`, coupé en test) dans
  `CatalogWork`. Recommandation : affinité par genres/tags (`tanh`), favoris et notes
  pondèrent (`likeWeight`), 80 % proches des goûts / 20 % découverte, déduplication
  AniList ⨝ MangaDex. Couverte par `backend/test/recommendation.test.ts`.

## 9. Comptes et e-mails

Inscription en deux temps : `POST /api/auth/register` crée une `PendingRegistration`
et envoie un code à 6 chiffres (**aucun `User` créé**) ; `POST /register/verify` crée
le compte. Code : `crypto.randomInt`, stocké en HMAC-SHA256, 15 min, 5 essais, 60 s
entre deux envois, 5 envois / heure. Détails : `docs/BACKEND.md`. Tests :
`backend/test/verification.test.ts` (transport `memory`, helper `lastCodeFor`).

## 10. Vérifier une modification

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Visuel ou gestuel : piloter un vrai navigateur (Playwright, retiré des dépendances
   après usage). Plusieurs bugs du deck n'ont été trouvés qu'ainsi. Pour savoir
   quelle carte est au-dessus : `document.querySelector('[data-card]:not([data-exiting])')`.
3. Nginx : `docker run --rm -v "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t`.
4. Compose : `docker compose config`.
5. Captures du README : `npm run screenshots -w frontend` (serveur de dev lancé à part).

## 11. État et pistes

**Vérifié en prod** : HTTPS, installation PWA, inscription avec code reçu par Gmail,
couvertures MangaDex (`200 image/jpeg` via le proxy), affichage mobile.

**Lecteur universel — vérifié en local seulement** (pas encore déployé) : parcours
Playwright sur MangaDex réel (webtoon, pages, swipe, flèches, fin de chapitre et
compteur, tiroir, réglages, double page RTL sur écran large), fichiers importés
(CBZ dans l'ordre naturel, PDF, EPUB avec thème et police dyslexie, CBR refusé),
et lecture hors-ligne sur le build de production (Service Worker actif). Détails :
`docs/ARCHITECTURE.md` §4 nonies, `docs/BACKEND.md` §3 bis. À surveiller en prod :
la bande passante du VPS (chaque page de chapitre transite par l'API) et la limite
MangaDex de 40 appels `/at-home/server` par minute pour tout le serveur.

**Connu** : les navigateurs qui ont chargé le site avant le correctif Nginx (§5.11)
peuvent garder des 404 en cache jusqu'à 24 h — effacer les données du site.

**Pistes** : mot de passe oublié (réutiliser le module de code e-mail) ; suppression
de compte ; export / import JSON de la bibliothèque ; tests e2e Playwright versionnés ;
sauvegarde planifiée du volume PostgreSQL ; cache des couvertures sur disque plutôt
qu'en mémoire si le trafic augmente. Lecteur : vrais CBR (RAR, via un décodeur
WebAssembly type libarchive.js) ; positions d'EPUB mises en cache (le calcul des
« locations » refait à chaque ouverture coûte quelques secondes sur un gros roman) ;
position des fichiers importés non synchronisée entre appareils (volontaire : les
fichiers restent locaux).
