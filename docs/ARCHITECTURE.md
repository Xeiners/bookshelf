# Architecture

Documentation technique de [Bookshelf](../README.md) : comment le code est bâti,
et pourquoi il l'est ainsi.

> 🧭 Tu reprends le projet ? Lis d'abord [`aicontext/HANDOFF.md`](../aicontext/HANDOFF.md),
> qui rassemble les décisions et les pièges déjà payés. Ce document-ci détaille
> le fonctionnement ; le handoff détaille ce qu'on ne peut pas lire dans le code.

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

Tout est enregistré **une seule fois** dans [`src/lib/gsap.ts`](../src/lib/gsap.ts), qui
exporte aussi le vocabulaire d'easings (`EASE`) et de durées (`DUR`) du projet.
Aucun composant n'importe `gsap` directement.

### Tailwind v4

Configuration **CSS-first** : pas de `tailwind.config.js`. Les tokens (`--color-void`,
`--font-display`, `--shadow-card`…) sont déclarés dans `@theme` au sein de
[`src/index.css`](../src/index.css), et les utilitaires maison (`glass`, `grain`,
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
│   ├── coverTone.ts             teinte dominante d'une couverture (canevas + cache)
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
    ├── library/                 LibraryView · SegmentedTabs · FeaturedBook · ShowcaseShelves · Book3D · BookTile
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

Fichier : [`src/components/discover/SwipeDeck.tsx`](../src/components/discover/SwipeDeck.tsx)

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
  { y:   0, scale: 1,     rotation:  0,   autoAlpha: 1 },
  { y: -16, scale: 0.945, rotation:  3,   autoAlpha: 1 },
  { y: -28, scale: 0.89,  rotation: -3.2, autoAlpha: 1 },
  { y: -36, scale: 0.85,  rotation:  1.5, autoAlpha: 0 }, // tampon invisible
]
```

Un `useGSAP` dépendant de `stackKey` (les ids visibles concaténés) place les cartes.
Une carte jamais vue est posée avec `gsap.set` ; une carte déjà placée **glisse** d'un
cran avec `gsap.to`. Au premier rendu, un `gsap.from` en cascade inversée déploie la
pile en éventail.

Les slots utilisent `autoAlpha`, jamais `opacity` seul : l'intro fait un
`from({ autoAlpha: 0 })` sur le tampon dont l'opacité de repos est 0, ce qui laisse
`visibility: hidden` en fin d'animation. Une promotion en `opacity` seule laissait
alors la carte invisible jusqu'en haut de la pile.

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

`commit()` notifie le parent **immédiatement** et garde la carte décidée montée
dans un état local `exiting` le temps de sa sortie :

```ts
exitingIds.add(decided.id)
gsap.set(node, { zIndex: EXIT_Z + exitCount })        // devant la pile, sous le proxy
gsap.to(node, { x, y, rotation, duration, ease,
  onComplete: () => setExiting(prev => prev.filter(b => b.id !== decided.id)) })
setExiting(prev => [...prev, decided])
onDecision(decided, intent)                             // le curseur avance tout de suite
```

React re-rend dans la foulée : la carte suivante devient `visible[0]` et le
`useGSAP` de pile la fait monter d'un cran. Il n'y a **aucun verrou** : on peut
saisir la carte suivante pendant que la précédente s'envole. Les cartes `exiting`
sont rendues avant la pile, donc l'ordre DOM ne bouge pas quand une carte en sort.

L'éjection prolonge l'élan du doigt : si la vitesse au relâchement dépasse
400 px/s, le mouvement est linéaire (`ease: 'none'`) avec une durée calculée pour
garder cette vitesse. Une courbe `power2.in` partait de l'arrêt : la carte
semblait s'immobiliser, voire revenir, avant de partir. Les boutons et le clavier,
sans vitesse initiale, gardent `power2.in`.

### Étape 5 — saisir une carte en mouvement (le piège)

Une carte peut être attrapée en pleine promotion ou en plein retour élastique.
Si l'animation continue, elle réécrit `x`/`y`/`rotation` à chaque frame par-dessus
le `quickSetter` du geste : la carte reste au centre sous le doigt puis part au
relâchement.

À l'appui, `bind()` coupe donc les tweens des propriétés du geste
(`killTweensOf(top, 'x,y,rotation,rotationX,rotationY')`), mémorise l'écart restant
dans `base` et le résorbe en 0,3 s (`render` ajoute `base` à la position du doigt).
`scale` et `autoAlpha` finissent normalement leur promotion. La carte du dessous est
traitée de même avant de créer ses `quickTo`.

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
2. **Pas de glissement horizontal du contenu.** La transition de vue reste un
   fondu avec une élévation de 10 px maximum : le châssis paraît stable et la
   navigation flottante reste visuellement ancrée.
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

## 4 ter. La vitrine (« Ma biblio »)

La bibliothèque est une **vitrine de libraire** : les vraies couvertures, en
volume, posées face à nous sur des étagères éclairées. Chaque onglet s'ouvre sur
un titre **à la une**. Fichiers : `components/library/` (`Book3D`,
`FeaturedBook`, `ShowcaseShelves`) et `lib/coverTone.ts`.

**Un livre en CSS 3D.** `Book3D` construit un pavé à six faces
(`transform-style: preserve-3d`) : la face avant est la couverture (vernis, pli
de reliure, signet doré pour une lecture en cours), la tranche prend la teinte de
la couverture, le bloc de pages est strié comme du papier. L'épaisseur vaut ~13 %
de la largeur. Le composant ne fait que construire l'objet : son orientation
appartient aux animations GSAP de l'appelant (`ref` sur la racine).

**La couleur de chaque couverture.** `coverTone()` réduit l'image dans un
canevas de 24 × 36 et fait une moyenne pondérée par la **saturation²** : un fond
noir ou blanc ne l'emporte jamais sur la couleur identitaire. Le résultat est
ramené dans une plage vive et lisible sur fond sombre, puis mis en cache
(mémoire + `bookshelf:tones:v1`). Les couvertures passent par notre API (même
origine), donc le canevas reste lisible ; sinon, teinte déterministe dérivée de
l'id. Cette teinte colore la tranche, le halo de la une et la flaque de lumière
que chaque livre jette sur sa planche.

**À la une.** Le titre touché en dernier (`updatedAt`) : grand volume sur un
halo de sa couleur, flottement continu du livre, reflet qui balaie la couverture
toutes les ~6 s, inclinaison qui suit le pointeur (`quickTo`, ignorée au toucher).
Le halo, lui, est **immobile** et couvre exactement la carte (`inset-0`) : une
respiration en `scale` faisait zoomer le fond et révélait les bords de sa boîte. Action
contextuelle : *Reprendre* (en cours), *Commencer* (wishlist → passe le titre en
lecture et suit le livre dans son onglet), *Voir la fiche* (lus). Sur grand écran,
le début du résumé occupe la largeur libre.

**Les étagères.** Colonnes calculées sur la largeur mesurée (`ResizeObserver`) :
3 livres par rayon sur téléphone, de grands volumes centrés sur ordinateur. Chaque
livre a un angle de repos propre (hash de l'id) qui montre sa tranche. La planche
est rendue **avant** les livres : ils se tiennent sur son dessus, et leur reflet
coloré s'y étale au lieu de passer dessous. Entrée : les planches se déroulent,
les LED s'allument, les livres montent du rayon un à un. Au tap, le livre pivote
face à nous et se soulève, comme pris en main.

**Ordinateur (conteneur ≥ 900 px).** Deux colonnes : la une, en version
verticale (fiche technique note · parution · chapitres · année, résumé), est
épinglée à gauche (`sticky`) pendant qu'on parcourt les étagères à droite, 4 livres
par rayon. La taille du livre à la une suit aussi la HAUTEUR visible, pour que la
carte épinglée tienne entière à l'écran (vérifié en 1440 × 900 sur les 3 onglets).

**Pièges évités.**
- Pas de `content-visibility` sur les rayons : son confinement de peinture
  rognerait tout ce qui déborde (reflets, lueur des LED, pourcentages).
- Tout dégradé décoratif (spot, reflets, lueurs) est en `closest-side` ou
  s'éteint avant les bords de sa boîte : un dégradé coupé par un bord dessine un
  rectangle pâle, très visible sur fond noir.

Un bouton bascule vers la grille de couvertures classique.

## 4 quater. Recherche & catalogue

Page d'affiches sur tout le catalogue MangaDex (en cache côté API, cf. `docs/BACKEND.md` §7 quater).

- **État** : [`useSearchStore`](../frontend/src/store/useSearchStore.ts) garde recherche, filtres et tri hors du
  composant : quitter la page puis revenir retrouve la même recherche (non persisté entre sessions).
- **Données** : [`useCatalog`](../frontend/src/hooks/useCatalog.ts) — clé = langue + tous les filtres ; seule la
  frappe est temporisée (320 ms), un tap sur un filtre part tout de suite. Chaque changement annule
  les requêtes en vol (`AbortController`). Défilement infini par sentinelle (`IntersectionObserver`).
  Recherche maigre (`supplement: true`) : le complément MangaDex est demandé APRÈS l'affichage.
- **Interface** : champ de recherche, bouton **Filtres** (compteur d'actifs) qui ouvre
  [`SearchFilters`](../frontend/src/components/search/SearchFilters.tsx) — feuille du bas sur mobile, tiroir
  latéral sur desktop, rendue en **portail** dans `document.body` (sinon la barre d'onglets, dans un contexte
  d'empilement plus haut, passait par-dessus). Origine, parution, note minimale, genres cumulables avec
  leur nombre de titres ; le bouton du bas annonce « Voir N titres » en direct. Menu de **tri**
  ([`SortMenu`](../frontend/src/components/search/SortMenu.tsx)) : Pertinence (avec texte), Pour toi (% de match),
  Popularité, Mieux notés, Récents. Les filtres actifs sont des puces qu'un tap retire.
- **Grille** : [`CatalogCard`](../frontend/src/components/search/CatalogCard.tsx), affiche plein cadre (titre sur
  dégradé, note, type, année), % de match, ajout express en wishlist ou état du titre (cœur si favori).
  2 → 6 colonnes selon la largeur.
- **Défilement** ([`SearchView`](../frontend/src/components/search/SearchView.tsx)) : en descendant, l'en-tête de
  l'app et le choix Mangas / Romans / Membres se replient (`useUiStore.chromeCollapsed`, deux seuils), puis la
  barre de recherche, les filtres et le compteur (`useCollapse`). Ils reviennent dès 10 px de remontée
  (chemin parcouru dans le sens courant, remis à zéro à chaque changement de sens), toujours tout en haut
  (< 120 px) ou pendant la frappe. Chaque affiche apparaît en entrant à l'écran (`IntersectionObserver`,
  cascade dans l'ordre de la grille) ; la page suivante est demandée 1 600 px avant le bas, et des affiches
  fantômes attendent au bout tant qu'il reste des résultats.

## 4 quater bis. Favoris & notes

- `LibraryEntry.favorite` et `userRating` (0,5 → 5 par demi-étoiles), synchronisés par l'opération `patch`
  de la file d'envoi, fusionnés à la connexion comme le reste de l'entrée.
- Fiche : [`FavoriteButton`](../frontend/src/components/ui/FavoriteButton.tsx) sous le bouton de fermeture (un titre
  hors bibliothèque y entre en wishlist) ; [`StarRating`](../frontend/src/components/ui/StarRating.tsx) pour un titre lu :
  tap (moitié gauche = demi-étoile), glisser le doigt, clavier (rôle `slider`). Hauteurs réservées : la
  feuille est ancrée en bas, rien ne doit faire bouger les étoiles sous le doigt.
- « Ma biblio » : 4ᵉ onglet **Favoris** (cœur, tous statuts confondus), aussi dans la barre latérale ;
  cœur et note sur les tuiles et le livre à la une.
- Favoris et notes pèsent dans le profil de recommandation (`likeWeight`, cf. BACKEND §7 ter).

## 4 quinquies. Tablette & desktop

Mobile-first, puis deux ruptures :

| Largeur | Navigation | Contenu |
| --- | --- | --- |
| `< md` (768) | capsule flottante en bas | colonne unique, `max-w-md` |
| `md` → `lg` | rail vertical **en icônes seules** (`NavRail`) | `max-w-3xl`, grilles 2–4 colonnes |
| `≥ lg` (1024) | **barre latérale complète** (`Sidebar`), repliable | `xl` : `max-w-5xl`, `2xl` : `max-w-6xl` |

`BottomNav`, `NavRail` et `Sidebar` partagent une source unique
([`navItems.ts`](../src/components/layout/navItems.ts)) et la même mécanique
d'indicateur (une capsule translatée par GSAP, sans mesure DOM).

**La barre latérale d'ordinateur** rassemble ce qui sert souvent, à portée de
clic : navigation (compteur de la bibliothèque, raccourci affiché au survol),
accès direct aux onglets Wishlist / En cours / Lus, « Reprendre la lecture »
(couverture + progression du dernier titre en cours), sélecteur de langue (retiré
de l'en-tête à partir de `lg`) et compte (avatar + état de synchro, ou « Se
connecter » en invité). Repliée, elle devient un rail de 80 px : les libellés
s'effacent, la langue passe en pastille compacte ; le choix est mémorisé
(`useSettingsStore.sidebarCollapsed`). L'onglet de la bibliothèque vit dans
`useUiStore.libraryTab` pour que la barre puisse y mener.

**Raccourcis** (`useKeyboardShortcuts`) : `1`–`4` pour les vues, `Ctrl/⌘ K` pour
la recherche (curseur placé dans le champ, même quand la vue n'est montée
qu'après la transition), `Ctrl/⌘ B` pour replier la barre. Ignorés pendant une
saisie (pour les chiffres) et quand une feuille modale est ouverte ; les flèches
restent au deck.

Aucun changement sous `lg` : le mobile garde sa capsule basse, la tablette son
rail, et le sélecteur de langue reste dans l'en-tête.

**Bandeau invité** (`GuestBanner`, toutes tailles). Tout en haut de l'app, tant
que l'utilisateur n'a pas de session : « Connecte-toi pour conserver tes
données ». Le message (et le bouton, à partir de `sm`) ouvre la connexion ; la
croix le retire, choix mémorisé sur l'appareil
(`useSettingsStore.guestBannerDismissed`). Il disparaît de lui-même une fois
connecté. Il porte la zone sûre du haut (encoche) : tant qu'il est affiché, la
colonne de contenu ne la rajoute pas (`pt-4` au lieu de `pt-safe`).

**Sélecteur de langue.** Ses boutons occupent chacun leur moitié de grille
(`w-full`) : étiré dans la barre latérale, un bouton à largeur fixe laissait le
libellé décalé sous la capsule.

Le deck, lui, ne s'étire jamais : sa scène est plafonnée à `26rem` et centrée.
Une carte de swipe large de 900 px n'aurait aucun sens.

## 4 quinquies bis. L'Oracle (« Le Tirage de l'Ombre »)

Page `src/pages/TarotPage.tsx`, composants `src/components/tarot/`. Parcours :
paquet flottant → **mélange** (les cartes se croisent pendant l'appel API, au
moins 1,1 s) → **distribution** (glissé avec gravité, `back.out`) → révélation
**dans l'ordre** (la carte suivante pulse, les autres sont scellées) → **final**
(Ambiance et Rythme s'effacent vers la Pépite qui grandit) → résultat, puis
compte à rebours jusqu'à minuit. Un tirage commencé se reprend ; terminé, il
reste affiché jusqu'au lendemain.

**`TarotCard3D`** sépare trois transformations sur trois éléments, pour qu'aucune
animation n'écrase l'autre : enveloppe (distribution, final — pilotée par la
page), inclinaison (suit la souris, `quickTo` ; pression + vibration au toucher),
pivot (`rotationY` 0 → 180, `perspective: 1000px`). À la révélation : léger
soulèvement en Z, pivot, éclair qui balaie la face, halo de la couleur de la
carte. Une carte déjà face visible **au montage** (reprise) est placée sans
animation — sans garde « déjà fait », qui sous StrictMode laissait la carte de
dos après l'annulation du contexte GSAP.

**Esthétique** : dos au sceau doré en SVG (cercles, étoile à huit branches,
croissant — aucun texte), faces néo-brutalistes (bord franc et ombre dure à la
couleur de la carte), poussière d'étoiles, fond qui prend la teinte de la
dernière carte révélée (`--oracle-tone` animé par GSAP ; `coverTone` pour la
Pépite). `prefers-reduced-motion` coupe les animations d'ambiance.

**Partage** (`lib/oracleShare.ts`) : image 1080 × 1350 dessinée dans un canevas
(cadre doré, couverture avec ombre néon, rang, combinaison, série). Partage natif
avec fichier si le navigateur le permet, sinon téléchargement + texte copié.

**Navigation** : 5ᵉ entrée « Oracle » (raccourci `2`), étincelle dorée tant que
le tirage du jour attend, ⚡ série dans la barre latérale. Les indicateurs de la
barre basse et du rail calculent désormais leur taille sur `NAV_ITEMS.length`.

**Lint à zéro avertissement** : les `contextSafe(() => … ref.current …)` créés
au rendu sont désormais créés à l'événement (`() => contextSafe(…)()`), et
`useDiscoveryQueue` dérive « chargement » et « renfort » au lieu de les poser
dans un effet.

## 4 quinquies ter. Activités : boosters et collection de cartes

L'onglet « Oracle » est devenu **Activités** (`Gamepad2`, vue `activities`) :
un hub et ses modules, sans routeur — `useUiStore.activity` vaut `hub`,
`oracle` (le `TarotPage` existant), `collection`, `market` (§ « Le Marché ») ou `dle`
(BookshelfDLE, §4 decies, chargé à la demande). Le hub : autel du booster, Oracle, collection,
BookshelfDLE (emblème « ? » lumineux), Marché ; le solde de Poussières s'affiche en tête. Les romans
ne sont plus un artefact du hub : ils vivent dans la Bibliothèque. L'étincelle dorée de la
navigation s'allume si le tirage du jour OU un booster attend
(`useActivitiesStatus`).

```
components/activities/  ActivitiesView (hub ↔ module, retour), ActivitiesHub (sanctuaire),
                        SanctumBackdrop (fond, portail), EnergyRing (jauge néon circulaire)
components/boosters/    BoosterPackModal (orchestration), BoosterOpeningAnimation (mise en scène),
                        BoosterPackArt (le paquet, partagé hub / ouverture), CardReveal
                        (jaillissement + révélation), ParticleBurst (canevas : confettis, étincelles)
components/cards/       CollectibleCard (cadres par rareté, holo, ombre chinoise), cardFrames
                        (finitions), CardBack (sceau alchimique), CollectionView, CardZoom
lib/boosters.ts         minuteur, raretés, filtres de l'album, taux observés (purs, testés)
lib/sfx.ts              sons synthétisés (WebAudio, aucun fichier)
hooks/                  useBoosters (stock + minuteur + recette), useCollection, useHoloTilt
store/                  useBoosterStore, useCollectionStore (non persistés)
```

**Direction artistique — le Sanctuaire.** Fond d'encre `#050507` sous un mesh
néon immobile (un seul calque : un fond plein écran animé se recompose à
chaque image et faisait saccader la page) ; le fond global de l'app, caché dessous, se
met en pause. Les modules sont des artefacts (liseré or → violet, verre
d'encre), pas des cartes de tableau de bord : l'autel du booster (paquet
isométrique flottant au-dessus d'un piédestal lumineux, bordures
incandescentes fixes quand un booster est prêt, jauge d'énergie circulaire à
compte à rebours néon), la lame de tarot de l'Oracle, l'éventail de la
collection. Cadres de carte en métal biseauté : argent mat (Commune), cobalt
brillant (Rare), violet néon à l'aura pulsante (Épique), or ciselé étincelant
(Légendaire), iridescence tournante (Mythique) ; titres en Instrument Serif.

**Recette** (`BOOSTER_UNLIMITED_MODE` côté serveur) : pastille « Sandbox »,
bouton jamais grisé, et dans l'ouverture un relevé des taux observés depuis
le lancement de l'app (`useBoosterStore.tally`).

- **Minuteur anti-triche** : le serveur donne un délai en secondes ; le client
  le décompte sur `performance.now()` (horloge monotone), jamais sur
  `Date.now()`. Resynchronisé au montage, au retour au premier plan et à
  l'échéance. Changer l'heure du téléphone ne fait rien apparaître : c'est le
  serveur qui accepte ou refuse l'ouverture.
- **Ouverture** (plein écran, `z-[90]`, fond d'encre presque opaque sous une vignette très
  sombre) : le booster s'avance vers l'écran au-dessus de son ombre portée ;
  le serveur le tire **dès l'ouverture de la fenêtre**, pour que son halo
  trahisse le contenu (doré : une Légendaire ; irisé : une Mythique ; aucun
  indice en dessous d'Épique). Fermer avant la déchirure ne perd rien : les
  cartes sont déjà dans l'album. Le tirage ne part qu'une fois par booster,
  même si StrictMode rejoue l'effet (`requested`).
- **Déchirure** (glisser vers le haut ou toucher) : la bande, bordée de
  perforations dorées / néon, pivote sur son coin puis s'envole ; gerbe
  d'étincelles (lumière additive) depuis l'ouverture, éclair, vibration, son.
- **Révélation** : les cartes jaillissent en arc de cercle, face cachée (sceau
  alchimique gravé à la feuille d'or), et flottent. Commune / Rare :
  retournement net, flash blanc. Épique, Légendaire, Mythique : 300 ms de
  suspense (la carte se soulève et se charge), retournement (perspective
  1000 px), tremblement d'écran, rayon de lumière, onde de choc, particules
  violettes / dorées / arc-en-ciel — plus ample à chaque rang.
- **Holographique** (Épique et au-delà) : `useHoloTilt` écrit `--rx/--ry/--mx/--my/--holo`
  sur l'élément, une fois par image, sans rendu React ; souris, ou gyroscope
  (autorisation iOS demandée pendant un geste).
- **Album** : grille 3 → 6 colonnes (ResizeObserver), `content-visibility: auto`,
  filtres rareté / possédées-manquantes / titre ; cartes manquantes en ombre
  chinoise gris foncé. La carte agrandie passe par un **portail** : `<main>`
  est transformé par GSAP et piégerait un élément `fixed`.
- **Performance — règles apprises à la mesure** (première version : image
  médiane 104 ms, CPU ×4 ; après : 7 à 14 ms, p95 21 ms, séquence complète) :
  - tout élément animé par GSAP porte `will-change: transform` (sinon il est
    repeint à chaque image, contenu compris) ;
  - pas de `transform-style: preserve-3d` hors du conteneur qui retourne la
    carte (il faut bien un verso) : la perspective passe dans le transform
    (`transformPerspective`, `perspective()`) ;
  - une boucle ne doit jamais repeindre un SVG : l'anneau du sceau est un SVG
    à part, tourné par le compositeur ; ombres en `box-shadow`, pas en filtre ;
  - **aucun flou** : ni `backdrop-filter`, ni `filter: blur()`, ni `drop-shadow`
    (flous gaussiens recalculés dès que le fond bouge, très coûteux sur mobile) ;
    les fonds de fenêtre sont presque opaques, les lueurs sont des `box-shadow`
    ou des dégradés radiaux ;
  - ce qui est caché ne s'anime pas : faces encore retournées sans effets, hub
    et sanctuaire en pause sous l'ouverture (`data-paused`), fond global en
    pause sous le sanctuaire.
- Moteur d'animation : GSAP (déjà dans le projet) plutôt que Framer Motion,
  pour ne pas ajouter une seconde bibliothèque d'animation.

**Le Marché** (`activity = 'market'`, `components/trading/`) : artefact du hub, puis
`TradingHubView` — offres des autres collectionneurs (carte reçue ⇄ carte cédée), filtres rareté / série /
« seulement ce que je peux échanger », bouton « Échanger » à confirmer d'un second tap (désarmé après
3,5 s). `CreateTradeSheet` en trois étapes (doublon libre → carte de même rareté, manquantes d'abord →
confirmation), `MyTradesSheet` (offres en cours annulables, historique). Échange conclu :
`TradeSwapAnimation`, les deux cartes se croisent en tournoyant (`rotationY` 360°, perspective dans la
transformation, aucun flou), puis l'album se recharge (`useBoosterStore.collectionChanged`). Règles
dupliquées côté front dans `lib/trades.ts` (pur, testé) pour ne proposer que ce que l'API acceptera ;
l'API tranche (cf. docs/BACKEND.md §7 septies).

### Notifications

[`components/notifications/`](../frontend/src/components/notifications/) : `NotificationBell` (en-tête, compteur,
balancement à l'arrivée), `NotificationBanner` (bandeau en haut : carillon, vibration, jauge du temps restant
mise en pause au toucher, glisser vers le haut pour fermer ; masqué dans le lecteur), `NotificationCenter`
(« À faire », « Nouvelles », « Plus tôt », glisser à gauche pour effacer avec `Draggable`, « Tout lire »,
son coupable). Le texte est rédigé côté front (`lib/notifications.ts`, pur, testé) depuis `type` + `data`.
[`useNotifications`](../frontend/src/hooks/useNotifications.ts) interroge l'API toutes les 45 s, page visible
(curseur `since`). Toucher une notification ouvre sa cible : « Mes échanges », le Marché centré sur l'offre
(anneau doré), l'autel des boosters ou l'album. Le bandeau : une coque (entrée) et une carte (glisser)
séparées — `Draggable` et un tween d'entrée sur le même élément se battaient.

### Administration

[`components/admin/`](../frontend/src/components/admin/) (chargé à la demande, entrée dans les Paramètres pour les
comptes `isAdmin`) : `AdminView` plein écran (liste et fiche côte à côte sur ordinateur, fiche qui glisse par
dessus sur téléphone), `AdminUserPanel` (offrir boosters ou carte, modérer, suspendre — actions sensibles
confirmées d'un second tap), `AdminAudit` (journal). Client : `services/adminApi.ts`, `lib/admin.ts`.

### Profils : la collection des autres

`CollectionAlbum` (extrait de `CollectionView`) sert « Ma collection » et l'album d'un membre
([`MemberCollectionView`](../frontend/src/components/profile/MemberCollectionView.tsx), ouvert depuis son profil
public) : ses cartes qui me manquent portent « Te manque », un filtre « Qui me manquent » les isole.

## 4 decies. BookshelfDLE

Mini-jeu façon Loldle (API : `docs/BACKEND.md` §7 undecies). Tout vit sous
[`components/dle/`](../frontend/src/components/dle/), chargé à la demande (`lazy`).

```
DleView        racine : écrans, chargement de l'accueil et des propositions, lien d'invitation (?dle=)
DleBar         barre du haut : le retour TOUJOURS au même endroit (hors des colonnes centrées), infos à droite
BentoHome      grille des catégories (Manga, Naruto, One Piece, JoJo, Jujutsu Kaisen, « Prochainement »)
DleHome        CategoryMenu : énigmes du jour (Classique, Couverture/Portrait, Pixels) + Multijoueur
MenuEntry      entrée de menu sans cadre (pastille, nom, état) ; BoosterEntry (achat), DailyStatus
DailyGame      énigme du jour ; VictoryPanel + AnswerCard (carte de collection ou portrait) à la victoire
GuessInput     saisie avec suggestions (titres et autres noms) ; la liste mesure la place visible
               (clavier mobile compris) et s'ouvre vers le haut si besoin
GuessBoard     ClassicBoard (tuiles translucides en relief, révélation de l'en-tête puis des tuiles,
               colonne d'auteur en COOP), WrongGuesses, VerdictLegend
ZoomFrame      Couverture / Portrait : détail grossi autour d'un point, recul à chaque erreur
PixelFrame     Pixels : image réduite dans un petit canevas, agrandie sans lissage
DleMulti       formats (cases à cocher), VERSUS / COOP (KindPicker), pseudo d'invité, salon, code
RoomScreen     salon : RoomLobby (réglages de l'hôte, joueurs), RoomPlay (chrono, « 3, 2, 1 », joueurs,
               plateau), RoomResults (podium VERSUS, bandeau COOP, classement général, reçu d'invité)
dleStyle.ts    couleurs des verdicts et des catégories, libellés des formats (pas un composant)
```

- **État** : [`useDleStore`](../frontend/src/store/useDleStore.ts) — écran affiché (`home` · `category` · `daily` ·
  `multi` · `room`), catégorie, accueil, propositions par catégorie, énigmes du jour (`dailyKey`), salon. Le salon
  se suit par **attente longue** (`watch` : boucle `GET /rooms/:code?v=`), jamais un état plus ancien par-dessus
  un plus récent (`isNewer`) ; l'horloge du serveur corrige les chronos (`clockOffset`).
  [`useGuestStardustStore`](../frontend/src/store/useGuestStardustStore.ts) garde les reçus d'invité (persisté) et
  les échange à la connexion ou à l'inscription. Logique pure et testée : [`lib/dle.ts`](../frontend/src/lib/dle.ts).
- **Pixels sans flou** : l'image est dessinée dans un canevas de 8 à 150 pixels de large (lissage À LA
  RÉDUCTION : chaque pixel prend la couleur moyenne de sa zone), sur un fond opaque (un portrait détouré ne
  laisse pas voir l'image dessous), puis agrandie par `image-rendering: pixelated`. Un seul petit dessin par
  erreur ; l'image nette n'apparaît (en fondu) qu'à la victoire ou à la 15ᵉ erreur.
- **Leçons** : un mode « silhouette » a été essayé puis retiré — une carte noire au départ n'apprend rien, et
  animer `filter` repeint l'image à chaque frame (des voiles empilés dont seule l'opacité bouge étaient la
  bonne technique). Pas d'ombre portée ni de flou : auras en dégradé radial, halos en `box-shadow` intérieurs
  (une ombre extérieure débordait des tuiles du plateau). Pas de composant créé pendant le rendu
  (`ModeIcon` est un vrai composant).

## 4 sexies. Performance du swipe

Le geste saccadait principalement à cause des filtres de flou et du débordement.
Les filtres CSS ont donc été retirés de toute l'interface :

1. **Les halos sont maintenant des dégradés radiaux.** Ils conservent la DA
   lumineuse sans filtre et leur animation ne touche qu'à `transform`.
2. **Les surfaces `glass` sont des aplats sombres semi-opaques.** La navigation,
   les puces, les boutons et la fiche modale n'ont plus besoin de recalculer ce
   qui se trouve derrière eux.
3. **Les effets locaux utilisent des dégradés.** Ombre des rayons, lueur de la
   carte d'installation et voile modal gardent leur fonction visuelle sans flou.
   Les `mix-blend-mode` restent également exclus des éléments animés.

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

- [`public/manifest.webmanifest`](../public/manifest.webmanifest) — nom, icônes
  192/512 + maskable, `display: standalone`, raccourcis. Chemins **relatifs**,
  donc un déploiement en sous-répertoire fonctionne tel quel.
- [`public/sw.js`](../public/sw.js) — service worker écrit à la main. Pas de
  précache généré au build (les noms de fichiers sont hachés par Vite, donc
  inconnus) : on mise sur du cache runtime — réseau d'abord pour les documents,
  cache d'abord pour `/assets/*` (immuables), stale-while-revalidate plafonné
  pour les couvertures, réseau uniquement pour l'API. Pas de `skipWaiting` :
  une nouvelle version prend la main au prochain démarrage, jamais en pleine
  session.
- [`scripts/generate-icons.mjs`](../scripts/generate-icons.mjs) — `npm run icons`.
  Encode les PNG à la main (IHDR / IDAT zlib / IEND + CRC32) et dessine quatre
  tranches de livres sur une planche, suréchantillonné ×4 pour lisser les
  arrondis. L'icône maskable confine le motif au carré inscrit au cercle de
  sécurité (marge de 21,7 % = 80 %/√2).

Le hook [`usePwaInstall`](../src/hooks/usePwaInstall.ts) intercepte
`beforeinstallprompt` pour proposer l'installation **au moment choisi par
l'utilisateur**, et distingue quatre états : déjà installée, prête, iOS (pas
d'API — instructions « Partager → Sur l'écran d'accueil »), ou non supportée.

> ⚠️ L'installation exige **HTTPS** (ou `localhost`). En HTTP simple, aucun
> navigateur ne déclenchera l'invite.
>
> Pour un vrai fichier `.apk` distribuable (Play Store, sideload), l'étape
> suivante est [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) :
> il emballe cette même PWA dans une **TWA** et produit l'APK signé.

## 4 octies. Deck recommandé (« Pour toi »)

Le deck est servi par `POST /api/discover/deck` (moteur de recommandation,
catalogue MangaDex en cache : voir `docs/BACKEND.md` §7 ter).

- `services/discover.ts` : `fetchDeck` envoie l'étagère, l'origine, les cartes
  déjà en file (`seen`) et l'historique local (titres aimés avec leurs genres,
  titres passés). Un invité n'a pas de profil en base : le serveur le recalcule
  depuis cet historique, avec le même algorithme que pour un compte.
- `useDiscoveryQueue` : une page de 20 cartes par requête, renfort sous 8
  cartes, `hasMore: false` → étagère épuisée. La clé de requête inclut l'origine :
  changer de filtre recharge la file (et remonte le deck).
- `DiscoverView` : rail d'étagères (`DECK_SHELVES`, « Pour toi » en tête) et
  filtre d'origine Tous / Manga / Manhwa / Manhua (`radiogroup`).
- `SwipeCard` : badge « 94 % de match » (vert > 80, doré > 60, neutre sinon) et
  badge « À découvrir » sur la carte 80/20. `withoutDeckFields` retire ces champs
  avant l'enregistrement en bibliothèque : ils décrivent la carte à un instant donné.

## 4 nonies. Lecteur universel

Plein écran, par-dessus toute l'application (`z-[100]`, fond `#000`), ouvert par
`useUiStore.openReader(session)` : bouton **Lire / Reprendre** de la fiche,
« Reprendre » de la vitrine, ou un fichier de « Mes fichiers » (bouton dossier de
l'en-tête de « Ma biblio »). Chargé à la demande (`React.lazy`) : le lecteur, puis
epub.js et pdf.js, ne pèsent rien tant qu'on ne lit pas.

```
components/reader/
  UniversalReader   choisit le moteur ; crée l'état d'interface (contexte ReaderUiContext)
  MangaReader       MangaDex : chapitres, pages, suivi de progression → ImageReader
  ArchiveReader     CBZ importé (fflate) → ImageReader
  ImageReader       moteur « images » : WebtoonView ou PagedView, commandes, tiroirs
  WebtoonView       défilement vertical continu, pages bord à bord, reprise au pixel
  PagedView         simple / double page, RTL / LTR, swipe, tiers de l'écran, pincement
  EpubReader        moteur « texte » (epub.js) : typographie, thèmes, temps restant, barre de progression ;
                    lit une `EpubSource` : fichier de l'appareil, ou roman du compte via…
  CloudReader       …roman du compte : fiche + position (API, repli IndexedDB), fichier téléchargé
                    une fois puis lu hors-ligne, position synchronisée (ProgressSync)
  ReadingProgressBar  fine barre d'avancement (pure, rendue dans les tests)
  PdfReader         moteur « document » (pdf.js, canevas) : pincement, Ctrl + molette
  ReaderControls    en-tête + pied de page en surimpression ; ReaderStatus (heure, batterie)
  ChapterDrawer / SidePanel / ReaderSettings / ChapterEnd / PageImage / ReaderMessage
  LocalFilesSheet   « Mes fichiers » : import, liste, suppression
components/novels/  NovelsSheet (« Mes romans »), NovelDetails (fiche, « Corriger la fiche »),
                    EpubDropZone (glisser-déposer + sélecteur)
lib/reader/         progress, prefetch, navigation, formats, sources, cloudSync, epubStyle
                    (purs, testés : frontend/test/) ; archive (CBZ), db (IndexedDB partagée),
                    localFiles, cloudBooks, quality, readable
hooks/reader/       useReaderUi, usePrefetch, usePinch, useLocalPosition, useReaderEnvironment,
                    usePageRecovery (contexte : « Essayer sur <autre source> » d'une page en erreur)
workers/            prefetch.worker.ts
store/useReaderStore  préférences propres à l'appareil (bookshelf:reader:v1)
```

**Gestes.** Tap au centre : commandes ; tiers gauche / droit : page précédente /
suivante (inversés en sens japonais) ; swipe horizontal en mode pages ; flèches,
Espace, Page ↑↓ au clavier ; Échap ferme d'abord le tiroir ouvert, puis le lecteur ;
le geste « retour » du téléphone ferme le lecteur (entrée d'historique dédiée). Les
règles sont des fonctions pures (`navigation.ts`), identiques pour les trois moteurs.

**Modes.** Manhwa / manhua → webtoon par défaut, manga → pages en sens japonais ;
le choix est mémorisé par œuvre. Double page automatique à partir de 900 px de
large en paysage, couverture seule. Le mode se bascule en un tap depuis le pied de
page, sans perdre sa page.

**Préchargement.** `usePrefetch` confie les téléchargements à un Web Worker
(`PrefetchQueue` : priorité, concurrence 2, annulation quand on saute des pages) :
les 5 pages suivantes, la précédente, puis tout le reste du chapitre (sauf
connexion lente / économie de données), plus le début du chapitre suivant passé
60 %. Les deux prochaines pages sont aussi décodées sur le fil principal.

**Progression.** `useLibraryStore.recordReading` : position (page + part défilée,
au pixel près en webtoon), écrite ~1 s après le dernier mouvement et
immédiatement quand l'app passe en arrière-plan. Fin de chapitre →
`chaptersRead` (numéro du chapitre, ne recule jamais), avancement global si le
nombre de chapitres est connu (plafonné à 99 % pour une série en cours), et le
titre entre en « En cours » s'il n'était pas en bibliothèque. Compte connecté :
opération `progress` de la file d'envoi → `PATCH /api/library/progress`.

**Sources.** L'API fusionne déjà les chapitres de toutes ses sources (MangaDex,
bibliothèque perso, sites des extensions Tachiyomi — cf. docs/BACKEND.md §3 ter) :
chaque chapitre porte sa version principale et ses `alternates`. `lib/reader/sources.ts`
applique la source préférée de l'utilisateur (mémorisée par œuvre), et le lecteur
offre trois recours, du plus discret au plus explicite :

- *repli automatique* : l'API essaie les `alternates` si la source du chapitre
  échoue ; un bandeau dit quel site a servi (nom lu dans la liste : « Asura
  Scans », pas le fournisseur « Tachiyomi ») ;
- *page en erreur* : sous « Recharger l'image », **Essayer sur <source suivante>**
  (`PageRecoveryContext`, fourni par `ImageReader`, lu par `PageImage` — pas de
  prop à travers les deux vues) ;
- *sélecteur* (`ReaderControls`) : toutes les sources du chapitre, un choix = cette
  version tout de suite et cette source préférée pour la suite.

Badges du sommaire : le nom de la source quand plusieurs se mêlent, et **toujours**
pour le site d'une extension (`tachiyomi:<id>`), marqué d'un éclair. Crédits de
fin : les sites réellement présents, pas le nom du fournisseur.

**Hors-ligne.** Le Service Worker garde les pages de chapitre (cache d'abord, 400
max) et les listes de chapitres / pages (réseau d'abord) : le chapitre préchargé
se relit sans réseau. Fichiers importés : IndexedDB (`bookshelf-reader`), jamais
envoyés à l'API.

**Romans du compte (EPUB synchronisés).** Import depuis « Ma biblio » (bandeau
`NovelsStrip`, bouton de l'en-tête), le hub Activités ou la feuille « Mes romans » :
glisser-déposer ou sélecteur, plusieurs fichiers à la fois, signature et taille
(50 Mo) vérifiées avant tout envoi, avancement de l'envoi (XHR). Le fichier part
sur le compte (`POST /api/books/upload`, cf. docs/BACKEND.md §7 sexies).

- *Hors-ligne* : IndexedDB v2 (`lib/reader/db.ts`) ajoute `cloud-books` (fiche, position
  locale, en attente ou non, téléchargé ou non — chaque fiche porte l'id du compte),
  `cloud-blobs` (le fichier, téléchargé une fois) et `locations` (positions epub.js
  précalculées : un gros roman ne les recalcule plus à chaque ouverture, fichiers de
  l'appareil compris). La déconnexion volontaire efface tout, couvertures du Service
  Worker comprises (cache `bookshelf-private-*`).
- *Synchronisation* (`lib/reader/cloudSync.ts`, testé) : à chaque page tournée, le CFI
  est écrit tout de suite dans IndexedDB (« en attente »), puis envoyé à l'API une
  seconde après la dernière page (`ProgressSync`) ; immédiatement, en `keepalive`,
  quand l'application passe en arrière-plan. Hors-ligne, il attend : envoyé au retour
  du réseau ou au démarrage suivant (`usePendingNovelProgress`), même sans rouvrir le
  livre. À l'ouverture, `newestPosition(locale, serveur)` : la plus récente gagne.
- *Rouvrir n'est pas lire* : la position d'ouverture n'est jamais envoyée tant qu'aucune
  page n'a été tournée — sinon ouvrir le livre sur l'ordinateur périmerait la page lue
  hors-ligne sur le téléphone, pas encore synchronisée.
- *Pourcentage* : inconnu tant que les positions ne sont pas calculées ; on garde alors
  le précédent plutôt que d'écrire un 0 % trompeur sur le serveur (`percentFrom`).

**Typographie des romans** (`lib/reader/epubStyle.ts`, testé) : thèmes Sombre
(`#09090b`, par défaut), OLED noir pur (`#000000`), Sépia papier (`#f4ecd8`), Clair,
Nuit ; polices Serif et Sans du système, Merriweather, Inter, Roboto et OpenDyslexic
embarquées (woff2 `@fontsource`, lisibles hors-ligne), en aperçu dans les réglages ;
taille, interlignage, marges. La feuille est injectée dans l'iframe de chaque
chapitre avec des `@font-face` en URL absolues (document `about:srcdoc`).

**Deck : plusieurs types à la fois.** Le filtre du deck (Découvrir) se coche :
Manga, Manhwa, Manhua et Romans, en toute combinaison (jamais vide ; « Tout cocher »).
La sélection et la dernière étagère sont gardées sur l'appareil
(`store/useDeckStore.ts`, `bookshelf:deck:v1`) et retrouvées au lancement suivant.
Logique pure dans `lib/deckSources.ts` (testée : `frontend/test/deckSources.test.ts`).

- *Étagères* (`shelvesFor`) : celles du catalogue, celles des romans, ou l'union
  (communes d'abord). Une étagère d'un seul côté (« Isekai », « Thriller ») ne sert
  que ce côté ; l'étagère enregistrée absente de la sélection retombe sur la première
  (dérivé au rendu, pas d'effet).
- *Fournée mêlée* (`fetchDeck`) : `/api/discover/deck` (avec `origins`, plusieurs
  origines MangaDex) et `/api/books/discover` en parallèle, chacun avec ses propres
  cartes vues (`splitSeen`), puis une carte sur deux (`interleave`). Une moitié
  épuisée n'est plus interrogée, l'autre continue ; une moitié en panne n'empêche
  pas l'autre.
- Les romans sont des `Book` (`kind: 'book'`, id `ol:…`) : swipe, wishlist, « Lu »,
  fiche et synchro du compte sans code dédié ; résumés par `/api/books/summary/:id`.

**Recherche de romans.** La page Recherche bascule entre « Mangas » (catalogue) et
« Romans » (`NovelSearch` → `GET /api/books/search`) : les fiches Open Library +
Google Books arrivent au format `Book` (`kind: 'book'`), donc même carte, même fiche
détaillée, même ajout à la bibliothèque que le catalogue.

**Pièges.**

- Un seul `useReaderUi()` par lecteur (dans `UniversalReader`) : chaque instance
  ajoute une entrée d'historique et un écouteur d'Échap. Les moteurs lisent
  `useReaderChrome()`.
- Webtoon : la reprise est réappliquée à chaque image qui prend sa hauteur, tant
  que l'utilisateur n'a pas touché l'écran ou fait défiler (cf. `appliedTop`).
- EPUB : l'iframe d'epub.js reste en bac à sable (`allowScriptedContent: false`) ;
  la console affiche « Blocked script execution in 'about:srcdoc' » : c'est voulu.
  Les touches frappées dans l'iframe arrivent par un écouteur passif : pas de
  `preventDefault` sur ce chemin.
- CBR : seuls les « .cbr » qui sont en réalité des ZIP s'ouvrent (signature lue) ;
  un vrai RAR est refusé avec un message.

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
| `ShowcaseShelves` | planches qui se déroulent, LED qui s'allument, livres qui montent du rayon ; au tap, le livre pivote face à nous |
| `FeaturedBook` | entrée en rotation, flottement, halo qui respire, reflet balayé, inclinaison au pointeur |
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
