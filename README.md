<div align="center">

<img src="frontend/public/icon-512.png" width="104" alt="Bookshelf" />

# Bookshelf

**Swipe. Découvre. Range.**
Tes mangas et manhwas, animés au doigt.

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![GSAP](https://img.shields.io/badge/GSAP-3.15-88CE02?style=flat-square&logo=greensock&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white)

</div>

---

<div align="center">

<img src="docs/screenshots/swipe.png" width="300" alt="Carte en cours de swipe, tampon Wishlist révélé" />

**À droite pour garder, à gauche pour passer.**
La carte s'incline en 3D sous le doigt, le tampon se révèle à mesure du geste,
et la pile derrière avance en même temps.

</div>

---

## Quatre écrans

<div align="center">
<table>
<tr>
<td align="center" width="25%"><img src="docs/screenshots/discover.png" width="185" alt="Découverte" /></td>
<td align="center" width="25%"><img src="docs/screenshots/library.png" width="185" alt="Bibliothèque" /></td>
<td align="center" width="25%"><img src="docs/screenshots/search.png" width="185" alt="Recherche" /></td>
<td align="center" width="25%"><img src="docs/screenshots/profile.png" width="185" alt="Profil" /></td>
</tr>
<tr>
<td align="center"><b>Découvrir</b><br/><sub>un deck sans fin</sub></td>
<td align="center"><b>Ma biblio</b><br/><sub>de vrais dos de livres</sub></td>
<td align="center"><b>Rechercher</b><br/><sub>tout le catalogue</sub></td>
<td align="center"><b>Profil</b><br/><sub>tes statistiques</sub></td>
</tr>
</table>
</div>

---

## Ce qui rend l'app particulière

🎴 **Un deck qui répond au doigt près**
Rotation, bascule 3D, parallaxe de la couverture, reflet spéculaire et promotion
progressive de la carte suivante — le tout piloté image par image pendant le geste.
Distance **ou** vélocité décident : un flick court mais vif suffit.

📚 **Une étagère, pas une grille**
Tes livres sont rangés debout, vus de dos. L'épaisseur d'une tranche suit sa
pagination — un pavé est visiblement plus large qu'une novella — et quelques piles
couchées cassent la ligne. Les livres émergent de la planche quand la vue s'ouvre.

🔍 **Le catalogue MangaDex, en français d'abord**
Mangas (Japon) et manhwas (Corée) lisibles en français ou en anglais, via notre
propre API : titres et résumés en français quand ils existent, genres traduits,
notes, couvertures HD relayées et mises en cache. Quatorze étagères thématiques et
une recherche instantanée. Le mode hors-ligne prend le relais tout seul.

🌍 **Français ou anglais, jusque dans le catalogue**
Un sélecteur FR / EN dans l'en-tête traduit l'interface ET les œuvres : titres,
résumés et genres sont servis dans ta langue, avec repli annoncé quand une
traduction manque. Le choix suit ton compte d'un appareil à l'autre.

☁️ **Sans compte d'abord, synchronisé ensuite**
Aucune inscription pour commencer : tout vit sur l'appareil. Crée un compte depuis
le Profil et ta bibliothèque invitée rejoint le compte sans doublon ; chaque swipe
est ensuite synchronisé, même après une coupure réseau.

✨ **Tout est animé avec GSAP**
Pas une transition CSS : `Draggable`, `InertiaPlugin` et des timelines sur mesure,
avec un nettoyage rigoureux des contextes via `useGSAP`.

📱 **Installable comme une vraie app**
Service worker maison, manifeste complet, icônes générées par script. Sur Android,
Chrome en fait un **WebAPK signé** — sans passer par le Play Store.

---

## Sur grand écran

<div align="center">
<img src="docs/screenshots/desktop.png" width="760" alt="Vue desktop avec rail de navigation latéral" />
</div>

Mobile-first, puis deux ruptures : la barre flottante devient un **rail vertical**
en tablette, qui déploie ses libellés en desktop. Le contenu s'élargit, les grilles
gagnent des colonnes — mais le deck reste plafonné et centré : une carte de swipe
large de 900 px n'aurait aucun sens.

---

## Démarrer

Node 22 ou plus récent. Une seule commande lance l'API et le front :

```bash
npm install        # installe les deux workspaces et génère le client Prisma
npm run dev        # API → http://localhost:5000/api · front → http://localhost:5173
```

La base SQLite est créée au premier lancement, rien d'autre à installer. Le front
appelle `/api`, relayé par Vite vers l'API : l'URL « Network » affichée au démarrage
permet donc d'ouvrir l'app sur un vrai téléphone du même Wi-Fi, API comprise.

<details>
<summary>Autres commandes</summary>

```bash
npm run build                    # API (tsc) puis front (vite build)
npm start                        # sert l'API compilée
npm test                         # tests d'intégration API + audit i18n du front
npm run typecheck                # les deux workspaces
npm run lint
npm run db:migrate               # nouvelle migration après un changement de schéma
npm run db:studio                # explorer la base
npm run preview -w frontend      # sert le build du front (tester le service worker)
npm run icons -w frontend        # régénère les icônes PWA
```

Configuration de l'API : copier `backend/.env.example` en `backend/.env`.
`JWT_SECRET` y est **obligatoire en production**.

</details>

### Avec Docker (PostgreSQL, prêt pour la production)

```bash
cp .env.example .env     # renseigner POSTGRES_PASSWORD et JWT_SECRET
npm run docker:up        # PostgreSQL + API + front Nginx → http://localhost:8082
npm run docker:dev       # variante développement, rechargement à chaud
```

Tout est détaillé dans [docs/DOCKER.md](docs/DOCKER.md) : images, variables,
schéma SQLite / PostgreSQL. Déploiement pas à pas sur un VPS derrière Caddy,
par l'IP publique : [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md).

```
bookshelf/
├── frontend/   React 19 · Vite · GSAP · Zustand — la PWA (+ Dockerfile, nginx.conf)
├── backend/    Express 5 · Prisma · SQLite / PostgreSQL — catalogue, comptes, synchro (+ Dockerfile)
└── docs/       architecture du front, API, synchronisation, Docker
```

---

## Sous le capot

| | |
| --- | --- |
| **Interface** | React 19 · TypeScript strict · Tailwind CSS 4 (config CSS-first) |
| **Animation** | GSAP 3.15 + `@gsap/react` — `Draggable`, `InertiaPlugin` |
| **État** | Zustand 5 + `persist` (localStorage) + file de synchronisation persistée |
| **API** | Express 5 · TypeScript · Zod · JWT en cookie HTTP-only |
| **Base** | Prisma 7 · SQLite (PostgreSQL en changeant une ligne) |
| **Données** | MangaDex, via un proxy qui filtre, normalise et met en cache |
| **Build** | Vite 8 (rolldown) · React Compiler · npm workspaces |

📐 **[Architecture](docs/ARCHITECTURE.md)** — comment le système de swipe est bâti,
le rangement en rayons, la gestion des contextes GSAP, les choix de performance.

🔌 **[Backend & synchronisation](docs/BACKEND.md)** — l'API, le schéma de base, le
proxy MangaDex et la stratégie « invité d'abord ».

🧭 **[Passation](aicontext/HANDOFF.md)** — les décisions, les pièges déjà payés et
la méthode de vérification. À lire en premier si tu reprends le projet.

---

<div align="center">
<sub>Interface en français et en anglais · Dark mode uniquement · Compte facultatif</sub>
</div>
