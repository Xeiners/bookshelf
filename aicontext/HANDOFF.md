# Bookshelf — passation

Contexte destiné à la personne (ou à l'agent) qui reprend ce code. Le
[README](../README.md) présente le produit, [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
explique **comment ça marche** ; ce document-ci rassemble ce qui **ne se lit pas dans
le code** : les décisions, les pièges déjà payés, et ce qui a été vérifié ou non.

---

## 1. Le projet en trois lignes

Bibliothèque personnelle mobile-first : on découvre des livres en les swipant à la
Tinder, on les range dans une étagère qui les affiche comme de vrais dos de livres,
on cherche dans le catalogue Open Library. Dark mode, animations 100 % GSAP,
installable en PWA. Interface entièrement en français.

## 2. Démarrer

```bash
npm install
npm run dev        # http://localhost:5173 + une URL réseau pour tester sur mobile
npm run build      # tsc --noEmit && vite build
npm run preview    # obligatoire pour tester le service worker (inactif en dev)
npm run typecheck
npm run lint
npm run icons      # régénère les icônes PWA
```

Environnement de référence : Node 26, npm 11, Windows. Aucun test automatisé
n'existe — la vérification passe par `typecheck` + `build` + `lint`, et par un
navigateur piloté pour tout ce qui est visuel (cf. §7).

## 3. Stack et raisons

| Choix | Version | Pourquoi ce choix |
| --- | --- | --- |
| React + Vite (rolldown) | 19.2 / 8.2 | scaffold existant, React Compiler activé |
| GSAP + `@gsap/react` | 3.15 / 2.1 | exigence du projet : **toutes** les animations passent par GSAP |
| Tailwind CSS | 4.3 | configuration CSS-first, **aucun `tailwind.config.js`** |
| Zustand + `persist` | 5.0 | état minimal, persistance localStorage sans effort |
| TypeScript | 7.0 | `strict`, `verbatimModuleSyntax`, `noUnusedLocals` |
| lucide-react | 1.31 | icônes, tree-shakées à l'import |

Depuis GSAP 3.13, **tous les plugins sont gratuits** et livrés dans le paquet npm
public. `Draggable` et `InertiaPlugin` sont utilisés ; `Flip`, `SplitText`,
`Observer`, `ScrollTrigger` et `CustomEase` sont disponibles sans rien installer.

## 4. Carte du code

```
src/
├── App.tsx                    coquille : rail/barre de nav, en-tête fixe, transitions de vue
├── lib/
│   ├── gsap.ts                registration unique + vocabulaire EASE / DUR
│   ├── ambient.ts             met le décor en pause pendant les gestes (perf)
│   ├── shelf.ts               métriques de tranche + rangement en rayons (pur, sans DOM)
│   ├── format.ts, stats.ts, haptics.ts, pwa.ts
├── services/openLibrary.ts    seul point de contact réseau
├── services/seedBooks.ts      jeu de secours hors-ligne
├── store/useLibraryStore.ts   entries + skipped, persistés
├── store/useUiStore.ts        vue active, fiche ouverte, toasts
├── hooks/                     useDiscoveryQueue · useCatalog · useCountUp · usePwaInstall
└── components/
    ├── layout/    AppHeader · AmbientBackdrop · BottomNav · NavRail · SplashIntro
    ├── discover/  SwipeDeck · SwipeCard · DeckActions · ShelfPicker · DiscoverView
    ├── search/    SearchView · SearchResultRow
    ├── library/   LibraryView · SegmentedTabs · ShelfWall · BookSpine · FlatStack · BookTile
    ├── profile/   ProfileView · InstallCard
    ├── book/      BookSheet
    └── ui/        Pill · Pressable · BookCover · ToastHost
```

Conventions en vigueur :

- **aucun composant n'importe `gsap` directement** — tout passe par `lib/gsap.ts` ;
- les composants de vue ne portent **pas** d'en-tête : l'en-tête est global (`AppHeader`) ;
- l'UI est en français, le code et les commentaires aussi ;
- les commentaires expliquent le *pourquoi*, jamais le *quoi*.

---

## 5. Pièges déjà payés — à ne pas réintroduire

### 5.1 `vite.config.js` masque `vite.config.ts`

Vite résout `vite.config.js` **avant** `.ts`. Le scaffold en contenait un : le
plugin Tailwind n'était donc jamais chargé, le build « réussissait », mais `@apply`
fuyait dans le CSS final et aucun token n'était généré. Le `.js` a été supprimé.
Si le CSS se met à sortir sans utilitaires, vérifier d'abord ce point.

### 5.2 `min-h-0` sur **chaque** maillon de la chaîne flex verticale

Le piège le plus coûteux du projet. Un élément flex sans `min-h-0` garde
`min-height: auto` = la hauteur minimale de son contenu : il refuse de se
comprimer, dépasse son parent, et le conteneur de défilement plus bas n'est jamais
contraint. `overflow-y: auto` ne se déclenche alors pas, et l'`overflow-hidden` de
`<main>` **coupe le bas de la page**. Mesuré avant correctif sur le Profil :

```
div.mx-auto…flex-1   clientH=985  minH=auto    ← 985 px dans un parent de 828
scroller Profil      clientH=827  scrollH=827  ← rien à défiler
```

Après ajout de `min-h-0` sur les deux ancêtres : `clientH=670`, `scrollH=827`.
**Un seul maillon oublié suffit à casser toute la chaîne.** Le contrat : `<main>`
est une colonne flex, chaque vue est un enfant `flex-1 min-h-0`, jamais `h-full`.

### 5.3 `overflow: hidden` sur `html, body, #root`

La carte éjectée par le swipe part à ±1,25 × la largeur de l'écran. Sans découpe,
elle élargit la zone défilable : barre horizontale, reflow de toute la page, et un
scintillement très visible. Le document ne défile jamais ; chaque vue gère son
propre défilement interne.

### 5.4 Le geste ne se ré-arme pas à la fin de l'animation

`SwipeDeck` mémorise `pendingId` et n'autorise un nouveau geste qu'une fois la pile
React à jour. Déverrouiller dans le `onComplete` de l'éjection semble naturel mais
est faux : React n'a pas encore re-rendu, `live.cards[0]` désigne encore la carte
partie (invisible mais montée). Un appui dans cette fenêtre pilote la carte fantôme
pendant que la carte visible reçoit l'animation « suivante » — l'utilisateur a
l'impression de swiper celle du dessous.

### 5.5 `Draggable` est sur un proxy, pas sur les cartes

Une seule instance, créée pour toute la vie du deck, attachée à un `<div>` invisible
qui couvre la scène. Les transforms des cartes restent la propriété exclusive des
timelines : le geste ne peut pas entrer en conflit avec l'animation de la pile.
Ne pas « simplifier » en attachant `Draggable` à la carte du dessus.

### 5.6 `backdrop-filter` et performance

Un élément en `backdrop-filter` est recomposé **dès que quelque chose bouge derrière
lui**. Trois règles qui en découlent :

- tout élément qui **se déplace** utilise `glass-flat` (même allure, sans filtre) —
  c'est le cas des badges portés par la carte de swipe ;
- le décor animé se met en pause pendant les gestes (`lib/ambient.ts`) ;
- pas de `mix-blend-mode`, et jamais d'animation de `scale` sur un élément flouté
  (cela force la re-rastérisation du flou à chaque frame ; une translation, non).

### 5.7 `useGSAP` ne nettoie pas comme on croit

Avec des **dépendances non vides** et sans `revertOnUpdate`, `useGSAP` ne *revert*
pas entre deux exécutions (`deferCleanup` dans la source de `@gsap/react`) : il ne
nettoie qu'au démontage. Trois usages dans le projet :

| Cas | Réglage | Raison |
| --- | --- | --- |
| Instance impérative (`Draggable`) | `dependencies: []` + cleanup retourné | le contexte exécute la fonction retournée au démontage |
| Animation qui doit repartir de zéro (toast, anneau, compteurs) | `revertOnUpdate: true` | sinon la timeline précédente survit et son `onComplete` casse la suivante |
| Animation de layout (pile de cartes) | dépendances, **sans** revert | un revert restaurerait les styles d'avant le geste → les cartes sauteraient |

Les animations créées dans un **gestionnaire d'événement** passent par `contextSafe()`.

### 5.8 `knownIds` n'est surtout pas un sélecteur Zustand

La fonction crée un nouveau `Set` à chaque appel. En sélecteur Zustand v5
(comparaison par `Object.is`), elle provoque une boucle de rendu infinie. À utiliser
exclusivement dans un `useMemo`.

### 5.9 Tailwind v4 : deux surprises

- `rotate-180` compile en propriété CSS autonome `rotate: 180deg`, **distincte de
  `transform`**. Sans conséquence ici, mais à savoir avant de mélanger une classe de
  rotation Tailwind et une rotation GSAP sur le même élément.
- Les tokens et utilitaires maison vivent dans `@theme` / `@utility` au sein de
  [`src/index.css`](../src/index.css). Il n'y a pas de fichier de config JS à chercher.

---

## 6. Contraintes de l'API Open Library

- **Google Books est inutilisable** sans clé : son endpoint renvoie un 429 permanent
  (quota du projet anonyme partagé). Ne pas y revenir sans clé API.
- Open Library est gratuite, sans clé, sans quota, et renvoie
  `Access-Control-Allow-Origin: *`.
- `fetchShelf` utilise `sort=rating`. `searchBooks` **ne doit pas** : sur une requête
  libre, trier par note écrase la pertinence et remonte des titres hors sujet.
  Vérifié : `dune` → *Dune* (Herbert), `camus` → *L'étranger*, `tolkien` → *The
  Hobbit*, avec 18 à 20 résultats exploitables sur 20.
- Le synopsis n'est pas dans `/search.json` : il vient de `/works/{id}.json`, hydraté
  à la demande et mis en cache mémoire. `useDiscoveryQueue` préchauffe les 3
  prochaines cartes.
- Les couvertures tombent parfois en 502 sur `-L.jpg` : `BookCover` retente en
  `-M.jpg` puis génère une couverture typographique déterministe. Jamais de trou visuel.
- Les `subject` sont bruités (métadonnées internes, mentions d'accessibilité) :
  `cleanSubjects` filtre, déduplique et traduit.

Constantes qui règlent le comportement du deck, dans `useDiscoveryQueue` :
`MIN_BATCH = 12`, `REFILL_THRESHOLD = 8` (large exprès : si la file tombe à zéro, le
deck est démonté et rejoue toute son animation d'entrée), `HYDRATE_WINDOW = 3`.

---

## 7. Vérifier une modification

`typecheck`, `build` et `lint` ne disent rien du rendu. Pour tout ce qui est visuel
ou gestuel, piloter un vrai navigateur — c'est ainsi qu'ont été trouvés les bugs
§5.2 et §5.4, après deux diagnostics erronés faits « au raisonnement ».

```bash
npm i -D playwright && npx playwright install chromium
```

Mesurer une chaîne de hauteurs (le motif qui a résolu §5.2) :

```js
await page.evaluate(() => {
  let node = document.querySelector('main')
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node)
    console.log(node.className.slice(0, 50), {
      clientH: node.clientHeight,
      scrollH: node.scrollHeight,
      overflowY: cs.overflowY,
      minH: cs.minHeight,          // `auto` ici = suspect n°1
    })
    node = node.parentElement
  }
})
```

Pour le deck, le seul observateur fiable de « quelle carte est au-dessus » est
**l'ordre du DOM** (`document.querySelector('[data-card]')`) : React rend la pile
dans l'ordre. Le z-index ne convient pas — `promote()` l'égalise temporairement, ce
qui produit de faux positifs.

Cadences de test utiles : 900 ms et 650 ms (tout doit passer, 6/6), et 300 ms —
pendant l'éjection — où une partie des gestes **doit** être ignorée sans jamais
valider la mauvaise carte.

Playwright a été retiré des dépendances après usage ; le binaire reste en cache local.

Les captures du README sont produites par [`scripts/screenshots.mjs`](../scripts/screenshots.mjs)
(`npm run screenshots`, serveur de dev lancé à part). Il peuple la bibliothèque via
de vrais gestes avant de photographier, sinon les vues Bibliothèque et Profil
seraient vides. À relancer dès que l'UI change visiblement.

⚠️ Les couvertures viennent d'un 302 vers `archive.org`, qui **extrait l'image d'une
archive ZIP à la volée** : le premier chargement prend souvent 5 à 15 s. Ce n'est
pas une panne, et le script attend explicitement `naturalWidth > 0` avant de
capturer — sans quoi les cartes ressortent noires.

---

## 8. PWA

Trois pièces, sans aucune dépendance : `public/manifest.webmanifest`, `public/sw.js`
(écrit à la main) et `scripts/generate-icons.mjs` (encode les PNG octet par octet).

- Chemins **relatifs** dans le manifeste : un déploiement en sous-répertoire fonctionne.
- Pas de précache généré au build — les noms de fichiers sont hachés par Vite, donc
  inconnus. Cache runtime : réseau d'abord pour les documents, cache d'abord pour
  `/assets/*`, stale-while-revalidate plafonné pour les couvertures, réseau
  uniquement pour l'API.
- **Pas de `skipWaiting`** : une nouvelle version prend la main au prochain
  démarrage, jamais en pleine session. Conséquence : après un déploiement, il faut
  fermer tous les onglets pour voir la mise à jour.
- L'installation exige **HTTPS** (ou `localhost`). En HTTP simple, aucun navigateur
  ne déclenche l'invite — c'est la première chose à vérifier si le bouton n'apparaît pas.
- Sur Android, Chrome empaquette la PWA en **WebAPK signé** : c'est déjà une vraie
  application. Pour un `.apk` distribuable, l'étape suivante est
  [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap), qui emballe cette
  même PWA en TWA.
- L'icône maskable confine le motif au carré inscrit au cercle de sécurité
  (marge 21,7 % = 80 %/√2). Ne pas réduire cette marge.

---

## 9. État des lieux

**Fonctionne et a été vérifié en navigateur** : défilement des quatre vues, swipe
(cadences 300/650/900 ms), rangement en étagère, recherche, installation PWA
(critères d'installabilité), responsive mobile/tablette/desktop.

**Approximations assumées**

- Le profil est un mockup : l'objectif annuel est une constante (`YEARLY_GOAL = 24`),
  il n'y a ni compte ni synchronisation.
- Le temps de lecture est estimé à 1,15 min/page.
- L'historique des « skip » est borné à 400 entrées pour ne pas gonfler le localStorage.
- Aucune internationalisation : tout est écrit en français en dur.
- Aucun test automatisé.

**Pistes naturelles**

- Persister l'étagère et l'onglet actifs (aujourd'hui réinitialisés à chaque session).
- Annuler le dernier swipe (le curseur est déjà un simple index, donc décrémentable).
- Exporter / importer la bibliothèque en JSON.
- Utiliser `Flip` pour la transition tuile → fiche, déjà disponible sans installation.

**Clés de stockage** — à changer en cas de rupture de schéma :
`bookshelf:library:v1` (localStorage, versionné via le middleware `persist`),
`bookshelf:splash-seen` (sessionStorage), caches SW `bookshelf-{shell,assets,covers}-v1`.
