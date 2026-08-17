# Bookshelf — Swipe & Match

Bibliothèque personnelle et interactive **mobile-first**. Dark mode immersif, cartes
empilées en 3D, swipe à la Tinder — toutes les animations sont orchestrées par **GSAP**.

> 🧭 Tu reprends ce projet ? Commence par [`aicontext/HANDOFF.md`](aicontext/HANDOFF.md) :
> décisions, pièges déjà payés et méthode de vérification. Ce README-ci décrit
> comment le code fonctionne ; le handoff décrit ce qu'on ne peut pas y lire.

```bash
npm install
npm run dev        # http://localhost:5173 (+ URL réseau pour tester sur mobile)
npm run build      # tsc --noEmit && vite build
npm run preview    # sert le build : nécessaire pour tester le service worker
npm run icons      # régénère les icônes PWA
npm run typecheck
npm run lint
```

> `server.host: true` est activé : l'URL « Network » affichée au démarrage permet
> d'ouvrir l'app sur un vrai téléphone du même Wi-Fi — indispensable pour juger
> les gestes.

---

## 1. Stack

| Rôle | Paquet | Version |
| --- | --- | --- |
| Build | `vite` + `@vitejs/plugin-react` (React Compiler activé) | 8.2 |
| UI | `react` / `react-dom` | 19.2 |
| Animation | `gsap` + `@gsap/react` | 3.15 / 2.1 |
| Styles | `tailwindcss` + `@tailwindcss/vite` | 4.3 |
| Icônes | `lucide-react` | 1.31 |
| État persistant | `zustand` (middleware `persist`) | 5.0 |
| Types | `typescript` | 7.0 |

### Plugins GSAP

Depuis la v3.13, **tous** les plugins GSAP sont gratuits et livrés dans le paquet npm
public. Ce projet utilise `Draggable` et `InertiaPlugin` (lecture de vélocité).
`Flip`, `SplitText`, `Observer`, `ScrollTrigger`, `CustomEase` sont déjà disponibles
si tu veux aller plus loin.

Tout est enregistré **une seule fois** dans [`src/lib/gsap.ts`](src/lib/gsap.ts), qui
exporte aussi le vocabulaire d'easings (`EASE`) et de durées (`DUR`) du projet.
Aucun composant n'importe `gsap` directement.

### Tailwind v4

Configuration **CSS-first** : pas de `tailwind.config.js`. Les tokens (`--color-void`,
`--font-display`, `--shadow-card`…) sont déclarés dans `@theme` au sein de
[`src/index.css`](src/index.css), et les utilitaires maison (`glass`, `grain`,
`pb-safe`, `text-gradient`) via `@utility`.

⚠️ Vite privilégie `vite.config.js` sur `vite.config.ts`. Le fichier `.js` du scaffold
a été supprimé — sans quoi le plugin Tailwind n'est jamais chargé et `@apply` fuit
dans le CSS final.

---

## 2. Structure

```
src/
├── main.tsx                     entrée (StrictMode)
├── App.tsx                      coquille + transitions de vues
├── index.css                    design tokens @theme + utilitaires @utility
│
├── lib/
│   ├── gsap.ts                  registration unique + EASE / DUR
│   ├── format.ts                durée de lecture, auteurs, couverture procédurale
│   ├── shelf.ts                 métriques de tranche + rangement en rayons (pur)
│   ├── stats.ts                 agrégats du profil
│   └── haptics.ts               vibration courte
│
├── types/book.ts                Book, LibraryEntry, ReadingStatus, SwipeDirection
│
├── services/
│   ├── openLibrary.ts           recherche, étagères, synopsis, couvertures
│   └── seedBooks.ts             jeu de secours hors-ligne
│
├── store/
│   ├── useLibraryStore.ts       entries + skipped, persistés en localStorage
│   └── useUiStore.ts            vue active, fiche ouverte, toasts
│
├── hooks/
│   ├── useDiscoveryQueue.ts     file du deck : pagination, filtrage, refill, hydratation
│   ├── useCatalog.ts            recherche debouncée + parcours d'étagère
│   └── useCountUp.ts            compteur animé sans re-render React
│
└── components/
    ├── layout/                  AppHeader · AmbientBackdrop · BottomNav · NavRail · SplashIntro
    ├── discover/                SwipeDeck · SwipeCard · DeckActions · ShelfPicker · DiscoverView
    ├── search/                  SearchView · SearchResultRow
    ├── library/                 LibraryView · SegmentedTabs · ShelfWall · BookSpine · FlatStack · BookTile
    ├── profile/                 ProfileView · InstallCard
    ├── book/                    BookSheet (fiche modale)
    └── ui/                      Pill · Pressable · BookCover · ToastHost
```

---

## 3. Données : pourquoi Open Library et pas Google Books

L'endpoint Google Books **sans clé API** renvoie aujourd'hui un `429` permanent
(*« Quota exceeded … Queries per day »* sur le projet anonyme partagé) : impossible
de bâtir une app dessus. Open Library est gratuite, sans clé, sans quota, et répond
`Access-Control-Allow-Origin: *`.

Deux endpoints :

1. `GET /search.json?q=subject:…&sort=rating&fields=…&page=N`
   → titre, auteurs, `cover_i`, note moyenne, pages, sujets.
2. `GET /works/{id}.json`
   → `description` (le synopsis), **hydraté à la demande** et mis en cache mémoire.

`useDiscoveryQueue` préchauffe le synopsis des **3 prochaines cartes** : le texte est
déjà là quand la carte remonte. En attendant, la carte affiche un squelette animé.

Robustesse :

- couvertures en cascade `-L.jpg` → `-M.jpg` → **couverture typographique procédurale**
  (dégradé déterministe dérivé d'un hash du livre) ;
- si l'API est injoignable, bascule sur `SEED_BOOKS` + badge « Hors-ligne » ;
- pagination aléatoire (pages 1→6) pour que deux sessions ne se ressemblent pas.

---

## 4. Le système de swipe, pas à pas

Fichier : [`src/components/discover/SwipeDeck.tsx`](src/components/discover/SwipeDeck.tsx)

### Le choix d'architecture qui change tout : le *drag proxy*

`Draggable` n'est **pas** attaché aux cartes, mais à un `<div>` invisible qui couvre
la scène :

```tsx
<div ref={stageRef} className="relative flex-1 [perspective:1100px]">
  {visible.map((book, depth) => <SwipeCard key={book.id} book={book} depth={depth} />)}
  <div ref={proxyRef} className="absolute inset-0 z-50 touch-none" aria-hidden />
</div>
```

Trois bénéfices :

1. **Une seule instance** de `Draggable` pour toute la vie du composant — aucune
   création/destruction à chaque swipe (gain net sur mobile) ;
2. les `transform` des cartes restent la **propriété exclusive** de nos timelines :
   plus de conflit entre le geste et l'animation de la pile ;
3. le nettoyage devient trivialement correct (voir §5).

### Étape 1 — la pile au repos

Chaque niveau a une position de repos ; les rotations alternées donnent l'effet
« paquet de cartes battu ».

```ts
const SLOTS = [
  { y:   0, scale: 1,     rotate:  0,   opacity: 1 },
  { y: -16, scale: 0.945, rotate:  3,   opacity: 1 },
  { y: -28, scale: 0.89,  rotate: -3.2, opacity: 1 },
  { y: -36, scale: 0.85,  rotate:  1.5, opacity: 0 }, // tampon invisible
]
```

Un `useGSAP` dépendant de `stackKey` (les ids visibles concaténés) place les cartes.
Une carte jamais vue est posée avec `gsap.set` ; une carte déjà placée **glisse** d'un
cran avec `gsap.to`. Au premier rendu, un `gsap.from` en cascade inversée déploie la
pile en éventail.

### Étape 2 — le rendu du geste

`onDrag` appelle `render(drag.x, drag.y)`, qui pilote **cinq** choses en une frame :

```ts
const progress  = gsap.utils.clamp(-1, 1, x / threshold)   // -1 → +1
const magnitude = Math.abs(progress)

gsap.set(top, { x, y,
  rotate:     progress * 11,                               // inclinaison plane
  rotationY:  progress * 9,                                // basculement 3D
  rotationX:  gsap.utils.clamp(-7, 7, -y / 26),
})

setLike(Math.max(0,  progress))                            // tampon « Wishlist »
setSkip(Math.max(0, -progress))                            // tampon « Passer »

gsap.set(cover, { x: -x * 0.05, y: -y * 0.035 })           // parallaxe couverture
gsap.set(sheen, { xPercent: progress * 42,                 // reflet spéculaire
                  opacity: magnitude * 0.55 })

nextY(gsap.utils.interpolate(SLOTS[1].y, SLOTS[0].y, magnitude))   // la pile respire
nextScale(...) ; nextRotate(...)
```

- `gsap.quickSetter` pour les opacités des tampons : écriture directe, zéro allocation.
- `gsap.quickTo` pour la carte du dessous : un léger lissage (0,35 s) qui la fait
  « monter » à mesure que le geste s'engage.
- La carte du dessus est en `gsap.set` : elle doit coller au doigt au pixel.

### Étape 3 — l'arbitrage au relâchement

Distance **ou** vélocité : un flick court mais rapide vaut décision.

```ts
const velocity = InertiaPlugin.getVelocity(proxy, 'x')   // nécessite .track()
const flicked  = Math.abs(velocity) > 620
const pulled   = Math.abs(drag.x) > threshold            // min(150, 30 % largeur)

if (!pulled && !flicked) settle()                        // retour élastique
else commit((flicked ? velocity : drag.x) >= 0 ? 1 : -1)
```

`settle()` ramène la carte avec `elastic.out(1, 0.62)`, efface les tampons, remet la
couverture et la carte du dessous en place, puis **réinitialise le proxy**
(`gsap.set(proxy, {x:0, y:0})` + `drag.update()` pour resynchroniser son cache).

### Étape 4 — l'éjection

`commit(direction)` éjecte la carte *et* fait monter la pile **sans attendre React** :

```ts
gsap.to(top, {
  x: direction * (stage.offsetWidth * 1.25 + 140),
  y: currentY + 48,
  rotate: direction * 26,
  autoAlpha: 0,
  duration: 0.52,
  ease: 'power2.in',
  onComplete: () => { resetProxy(); onDecision(decided, direction) },
})
promote()   // chaque carte restante glisse d'un cran, stagger 0.03 s
```

L'état React n'avance qu'à la fin de l'animation. Comme `promote()` a déjà amené les
cartes à leur nouvelle position, le `useGSAP` de layout qui se déclenche ensuite
anime vers des valeurs identiques : **aucun saut visuel**.

Un drapeau `live.current.animating` fait ignorer tout geste pendant l'éjection.

### Étape 5 — le ré-armement du geste (le piège)

On ne peut **pas** déverrouiller le geste à la fin de l'animation d'éjection : à
cet instant React n'a pas encore re-rendu, donc `live.cards[0]` désigne toujours
la carte qui vient de partir — invisible, mais encore montée. Un appui dans cette
fenêtre pilotait cette carte fantôme, pendant que la carte réellement visible
recevait l'animation « carte suivante ». Symptôme : *on swipe celle du dessous*.

Le deck mémorise donc l'id de la carte éjectée (`pendingId`) et ne se ré-arme que
lorsque la pile React reflète vraiment la décision :

```ts
if (live.current.pendingId !== null && visible[0]?.id !== live.current.pendingId) {
  live.current.pendingId = null
  live.current.animating = false
}
```

Vérifié au navigateur : à 650 et 900 ms d'intervalle, la séquence des cartes vues
et celle des cartes enregistrées sont identiques (6/6) ; à 300 ms — soit pendant
l'éjection — 3 gestes sur 6 sont ignorés, **sans jamais valider la mauvaise
carte**.

### Étape 6 — les mêmes rails pour tout

Les boutons `✕` / `♥` et les flèches ← / → appellent **exactement** `commit()`. Un seul
chemin de code, donc un seul comportement.

---

## 4 bis. Stabilité du châssis (chrome)

Trois règles, apprises à la dure :

1. **L'en-tête vit hors de la zone animée.** `AppHeader` est un frère de `<main>`,
   pas un enfant. Sa structure est identique pour les trois vues (ligne d'accroche +
   titre), donc sa hauteur ne varie jamais. Seul le texte permute, en `transform` +
   `opacity` — zéro reflow.
2. **Pas de glissement horizontal du contenu.** La barre de navigation est en
   `backdrop-filter: blur(28px)` : tout contenu qui défile dessous fait scintiller
   le verre et donne l'illusion que la barre bouge. La transition de vue est donc un
   fondu avec une élévation de 10 px maximum.
3. **Aucun easing qui dépasse sur les capsules.** `elastic.out` sur un indicateur
   contenu dans un `overflow-hidden` se fait rogner aux extrémités. `power3.out`
   termine pile sur la cible.

Corollaire : les actions propres à une vue (mélanger le deck, badge hors-ligne) ne
vivent pas dans l'en-tête global mais dans le contenu de la vue — ici sur la ligne
du rail d'étagères, à hauteur constante.

**Contrat de hauteur — à respecter pour toute nouvelle vue.** `<main>` est une
**colonne flex**, et chaque vue est un enfant `flex-1 min-h-0`.

⚠️ `min-h-0` doit figurer sur **chaque maillon** de la chaîne flex verticale, pas
seulement sur le conteneur de défilement. Sans lui, un élément flex conserve
`min-height: auto` = la hauteur minimale de son contenu : il refuse de se
comprimer, dépasse son parent, et le conteneur de défilement plus bas n'est
jamais contraint. `overflow-y: auto` ne se déclenche alors pas — le contenu tient
« naturellement » — et l'`overflow-hidden` de `<main>` **coupe le bas de la page**.
Un seul maillon oublié suffit. Mesuré avant correctif sur la page Profil :

```
div.mx-auto…flex-1   clientH=985  minH=auto   ← 985 px dans un parent de 828
scroller Profil      clientH=827  scrollH=827 ← rien à défiler
```

Après ajout de `min-h-0` sur les deux ancêtres : scroller `clientH=670`,
`scrollH=827` → 157 px réellement défilables.

Le dégagement sous la barre passe par l'utilitaire `pb-nav`, qui compose la
hauteur de la barre **et** la zone sûre du bas (34 px sur un iPhone à barre
d'accueil — un padding fixe calibré pour Android passait juste en dessous).

## 4 ter. Le mur d'étagères (« Ma biblio »)

La bibliothèque est rendue **comme une vraie étagère** : les livres sont debout,
vus de dos, quelques-uns couchés en pile. Toute la logique est pure et isolée dans
[`lib/shelf.ts`](src/lib/shelf.ts) — aucun DOM, donc lisible et testable.

**Dimensions déterministes.** L'épaisseur d'une tranche suit la pagination
(`22 + pages/12`, borné à 26–52 px) : un pavé est visiblement plus large qu'une
novella. La hauteur varie via un hash de l'id — mais avec une **graine distincte
de la teinte** (`id#h`), sinon tous les livres rouges seraient les plus courts.
Une bibliothèque garde ainsi exactement la même allure d'une session à l'autre.

**Unités puis rangement.** La liste est d'abord découpée en unités — une tranche
debout, ou une pile de 2–3 livres couchés insérée au rythme d'un hash — puis les
unités sont rangées en rayons successifs selon la largeur mesurée
(`ResizeObserver`, pas de valeur devinée). Un rayon incomplet reçoit un
serre-livres clair, qui tranche joliment sur les dos sombres.

**L'astuce d'animation.** La rangée est en `overflow-hidden` et la planche est
dessinée juste en dessous : le masque coïncide donc pile avec la surface du
rayon. Les livres entrent par le bas (`y: 34 → 0`) et semblent **émerger de la
planche** au lieu de tomber du ciel. Au tap, la tranche se soulève et bascule de
3,5° avec un pivot `origin-bottom` — le geste d'un livre qu'on sort du rayon.

Un bouton bascule vers la grille de couvertures classique si tu préfères
naviguer visuellement.

## 4 quater. Recherche & catalogue

Onglet dédié, alimenté par [`useCatalog`](src/hooks/useCatalog.ts), qui gère deux
modes dans un seul cycle de vie :

- **requête libre** — debounce 380 ms, minimum 2 caractères ;
- **étagère du catalogue** — immédiate, car le tap est déjà une intention ferme.

Chaque changement annule la requête précédente (`AbortController`) : sans ça, une
réponse lente écrase une réponse plus récente quand on tape vite.

⚠️ La recherche plein texte n'utilise **pas** `sort=rating`. Trier par note écrase
le classement par pertinence et remonte des titres hors sujet ; l'ordre natif
d'Open Library est bien meilleur. Vérifié sur l'API : `dune` → *Dune* (Herbert),
`camus` → *L'étranger*, avec un rendement de 18–20 résultats exploitables sur 20.

Chaque ligne permet l'ajout express en wishlist sans ouvrir la fiche, et affiche
une coche teintée du statut si le livre est déjà dans la bibliothèque.

## 4 quinquies. Tablette & desktop

Mobile-first, puis deux ruptures :

| Largeur | Navigation | Contenu |
| --- | --- | --- |
| `< md` (768) | capsule flottante en bas | colonne unique, `max-w-md` |
| `md` → `lg` | rail vertical **en icônes seules** | `max-w-3xl`, grilles 2–4 colonnes |
| `≥ lg` (1024) | rail vertical **avec libellés** + signature | `xl` : `max-w-5xl`, jusqu'à 6 colonnes |

`BottomNav` et `NavRail` partagent une source unique
([`navItems.ts`](src/components/layout/navItems.ts)) et la même mécanique
d'indicateur — `xPercent` sur l'axe X en bas, `yPercent` sur l'axe Y dans le
rail, sans aucune mesure DOM.

Le deck, lui, ne s'étire jamais : sa scène est plafonnée à `26rem` et centrée.
Une carte de swipe large de 900 px n'aurait aucun sens.

## 4 sexies. Performance du swipe

Le geste saccadait. Trois causes, toutes liées au **flou**, et une au **débordement** :

1. **Les halos du décor étaient animés en `scale`.** Animer l'échelle d'un
   élément flouté force le navigateur à **re-rastériser le flou à chaque
   frame**. Désormais : translation seule + `will-change: transform`, donc un
   calque rendu une fois puis simplement déplacé.
2. **Tout élément en `backdrop-filter` doit être recomposé dès que quelque
   chose bouge derrière lui.** Avec un décor animé en permanence, la barre de
   navigation, les puces et les boutons refloutaient leur arrière-plan en
   continu — même à l'arrêt. Le décor se met donc en pause pendant le geste
   (cf. [`lib/ambient.ts`](src/lib/ambient.ts)), et reprend au relâchement.
3. **Les badges portés par la carte utilisaient `backdrop-filter`.** Ils se
   déplacent avec elle : leur arrière-plan était donc recalculé à chaque frame.
   D'où l'utilitaire `glass-flat` — même allure, sans filtre — obligatoire sur
   tout élément mobile. Idem pour les `mix-blend-mode`, supprimés du reflet et
   du grain : un mode de fusion force la recomposition de toute la pile.

Enfin, les transforms du geste passent par un unique `gsap.quickSetter(el, 'css')` :
les cinq propriétés sont écrites en **un seul recalcul** par frame, sans allouer
de tween comme le ferait `gsap.set`.

**Scintillement et débordement** venaient d'ailleurs : la carte éjectée part à
±1,25 × la largeur de l'écran et **rien ne la découpait**. Le document
s'élargissait, une barre de défilement horizontale apparaissait, et ce reflow
faisait clignoter toute la page. Correctif : `overflow: hidden` sur
`html, body, #root` (coquille applicative — chaque vue gère son propre
défilement) et sur `<main>`.

## 4 septies. Installation (PWA)

Le profil propose d'installer l'app. Sur Android, Chrome empaquette réellement
la PWA en **WebAPK signé** : icône dans le tiroir d'applications, entrée dans
les paramètres système — une vraie application, sans passer par le Play Store.

Trois pièces, **sans aucune dépendance** :

- [`public/manifest.webmanifest`](public/manifest.webmanifest) — nom, icônes
  192/512 + maskable, `display: standalone`, raccourcis. Chemins **relatifs**,
  donc un déploiement en sous-répertoire fonctionne tel quel.
- [`public/sw.js`](public/sw.js) — service worker écrit à la main. Pas de
  précache généré au build (les noms de fichiers sont hachés par Vite, donc
  inconnus) : on mise sur du cache runtime — réseau d'abord pour les documents,
  cache d'abord pour `/assets/*` (immuables), stale-while-revalidate plafonné
  pour les couvertures, réseau uniquement pour l'API. Pas de `skipWaiting` :
  une nouvelle version prend la main au prochain démarrage, jamais en pleine
  session.
- [`scripts/generate-icons.mjs`](scripts/generate-icons.mjs) — `npm run icons`.
  Encode les PNG à la main (IHDR / IDAT zlib / IEND + CRC32) et dessine quatre
  tranches de livres sur une planche, suréchantillonné ×4 pour lisser les
  arrondis. L'icône maskable confine le motif au carré inscrit au cercle de
  sécurité (marge de 21,7 % = 80 %/√2).

Le hook [`usePwaInstall`](src/hooks/usePwaInstall.ts) intercepte
`beforeinstallprompt` pour proposer l'installation **au moment choisi par
l'utilisateur**, et distingue quatre états : déjà installée, prête, iOS (pas
d'API — instructions « Partager → Sur l'écran d'accueil »), ou non supportée.

> ⚠️ L'installation exige **HTTPS** (ou `localhost`). En HTTP simple, aucun
> navigateur ne déclenchera l'invite.
>
> Pour un vrai fichier `.apk` distribuable (Play Store, sideload), l'étape
> suivante est [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) :
> il emballe cette même PWA dans une **TWA** et produit l'APK signé.

## 5. Nettoyage des contextes GSAP

Le détail que tout le monde rate : avec des **dépendances non vides** et
`revertOnUpdate` absent, `useGSAP` ne *revert* **pas** son contexte entre deux runs
(cf. `deferCleanup` dans la source de `@gsap/react`). Il ne nettoie qu'au démontage.

Les trois cas du projet :

| Cas | Réglage | Pourquoi |
| --- | --- | --- |
| Instance impérative (`Draggable`) | `{ dependencies: [] }` + **cleanup retourné** | `context.add()` mémorise la fonction retournée (`_r` dans `gsap-core`) et l'exécute au revert → `drag.kill()` + `InertiaPlugin.untrack()` |
| Animation qui doit **repartir de zéro** (toast, anneau du profil, compteurs) | `revertOnUpdate: true` | sinon la timeline précédente survit et son `onComplete` casse la suivante |
| Animation de layout (pile de cartes) | dépendances, **sans** revert | un revert restaurerait les styles inline d'avant le geste → les cartes sauteraient |

Pour les animations créées dans des **gestionnaires d'événements** (`Pressable`,
fermeture de la `BookSheet`), on passe par `contextSafe()` : les tweens rejoignent le
contexte du hook et sont donc revertés au démontage.

Enfin, `SwipeDeck` remet sa comptabilité à zéro au démontage
(`placed.clear()`, `firstPaint = true`) pour rester **idempotent sous `<StrictMode>`**
(mount → unmount → mount en dev), sinon l'entrée en éventail serait sautée.

---

## 6. Inventaire des animations

| Où | Effet |
| --- | --- |
| `SplashIntro` | titre découpé en caractères masqués, révélé en cascade ; sortie par `clip-path` |
| `AmbientBackdrop` | 3 halos en dérive infinie (`repeatRefresh` → jamais la même boucle) |
| `SwipeDeck` | pile 3D, inclinaison, parallaxe, reflet, tampons, éjection, promotion |
| `BottomNav` / `NavRail` | capsule glissante `power3.out` (X en bas, Y dans le rail), teintes tweenées |
| `InstallCard` | halo qui respire tant que l'installation est possible |
| `AppHeader` | permutation du titre en `transform` + `opacity` (aucun reflow) |
| `App` | transition de vues en fondu + légère élévation |
| `SegmentedTabs` | même capsule glissante pour les statuts |
| `ShelfWall` | les livres émergent de la planche en cascade (masque `overflow-hidden`) |
| `BookSpine` | soulèvement + bascule 3,5° au tap, pivot sur la base du livre |
| `SearchView` | cascade des résultats à chaque nouvelle réponse |
| `BookTile` | enfoncement au press, jauge de progression remplie au montage |
| `BookSheet` | entrée en rideau + cascade de contenu, `Draggable` vertical pour refermer |
| `ProfileView` | anneau `strokeDashoffset`, compteurs animés, barres de genres en cascade |
| `ToastHost` | entrée `back.out`, auto-dismiss après 1,9 s |
| `BookCover` | fondu + léger dézoom au chargement de l'image |

---

## 7. Persistance

`useLibraryStore` sérialise `entries` et `skipped` sous la clé
`bookshelf:library:v1` (localStorage, middleware `persist`, `version: 1`).

- swipe droite → statut `wishlist` ;
- swipe gauche → id ajouté à `skipped` (borné à 400 entrées) et **plus jamais proposé** ;
- la fiche permet de basculer entre `Wishlist` / `En cours` / `Lus` ;
- atteindre 100 % de progression passe automatiquement le livre en `Lus`.
