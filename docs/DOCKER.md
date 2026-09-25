# Docker — lancer et déployer Bookshelf

Toute la pile en conteneurs : **PostgreSQL 17**, **API** (Node 22 + Prisma) et
**front** (PWA servie par Nginx, qui relaie aussi `/api`).

```
navigateur ──► 127.0.0.1:8082  frontend (Nginx) ──/api──► backend :5000 ──► postgres :5432
                       SPA + PWA statiques        (réseau interne de la pile, non exposé)
```

## 1. Démarrage rapide (production locale)

Prérequis : Docker Desktop (ou Docker Engine) avec Compose v2.

```bash
cp .env.example .env
# Renseigner au minimum POSTGRES_PASSWORD et JWT_SECRET (32 caractères min.) :
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run docker:up        # = docker compose up --build -d
```

Puis **http://localhost:8082** (`PORT`, lié à 127.0.0.1 : accessible depuis la
machine elle-même seulement ; sur un serveur, on passe par un reverse proxy, cf.
[DEPLOY-VPS.md](DEPLOY-VPS.md)). Démarrage ordonné par les sondes de santé :
PostgreSQL prêt → migrations appliquées puis API prête → front démarré.

| Commande | Effet |
| --- | --- |
| `npm run docker:up` | build + démarrage en arrière-plan |
| `npm run docker:logs` | journaux de toute la pile |
| `docker compose ps` | état et santé des services |
| `npm run docker:down` | arrêt (les données restent dans le volume `postgres_data`) |
| `docker compose down -v` | arrêt **et suppression des données** |

Au premier démarrage, l'API indexe le catalogue AniList + MangaDex en tâche de
fond (≈ 4 minutes, ~3 000 œuvres, directement dans PostgreSQL). Le deck est
utilisable après quelques secondes ; `CATALOG_SYNC=off` coupe l'indexation.

### Vérifier que tout fonctionne

```bash
docker compose ps                                  # 3 services « healthy »
curl http://localhost:8082/api/health              # API via le relais Nginx
curl -I http://localhost:8082/sw.js                # Cache-Control: no-cache
docker compose logs backend | grep -i migration    # migrations appliquées
docker compose exec postgres psql -U bookshelf -d bookshelf -c 'select count(*) from "CatalogWork";'
```

## 2. Développement dans Docker (rechargement à chaud)

```bash
npm run docker:dev       # = docker compose -f docker-compose.dev.yml up --build
```

- Front Vite **http://localhost:5173** (HMR), API **http://localhost:5000**,
  PostgreSQL **localhost:5432** (client SQL, Prisma Studio).
- Le code est monté depuis l'hôte ; `node_modules` vit dans des volumes Docker
  (dépendances Linux, jamais mélangées à celles de l'hôte). Un service `deps`
  les installe une fois (`npm ci`) avant le reste.
- Rechargement : Vite (HMR) pour le front, `tsx watch` pour l'API. Les fichiers
  montés depuis Windows / macOS n'émettent pas d'événements dans un conteneur
  Linux : la scrutation est activée (`CHOKIDAR_USEPOLLING`, `VITE_USE_POLLING`).
- `npm run docker:dev:down` pour arrêter (données dans `postgres_dev_data`).

Sans Docker, `npm run dev` fonctionne toujours tel quel, sur **SQLite** : rien à installer.

## 3. Deux bases, un seul schéma

| | SQLite | PostgreSQL |
| --- | --- | --- |
| Usage | `npm run dev` sur l'hôte, tests | Docker, production |
| Schéma | `backend/prisma/schema.prisma` (**source**) | `backend/prisma/postgres/schema.prisma` (**généré**) |
| Migrations | `backend/prisma/migrations/` | `backend/prisma/postgres/migrations/` |
| Client généré | `src/generated/prisma` | `src/generated/prisma-pg` |

`DATABASE_URL` choisit tout : `file:…` → SQLite, `postgres(ql)://…` →
PostgreSQL (`prisma.config.ts` pour la CLI, `src/db.ts` pour l'API, qui charge
client et adaptateur à la demande : l'image n'embarque pas le pilote SQLite natif).

**Faire évoluer le schéma** :

```bash
# 1. Modifier backend/prisma/schema.prisma, puis (SQLite) :
npm run db:migrate            # migration SQLite + régénère le schéma PostgreSQL
# 2. Migration PostgreSQL, contre la base de dev Docker :
docker compose -f docker-compose.dev.yml up -d postgres
cd backend && DATABASE_URL="postgresql://bookshelf:<mot de passe>@localhost:5432/bookshelf" \
  npx prisma migrate dev --name <nom>
```

`npm test` échoue si le schéma PostgreSQL n'a pas été régénéré (`db:schema:pg --check`).

## 4. Les images

**API** (`backend/Dockerfile`, 149 Mo compressés) — étapes :

1. `builder` : `npm ci` du workspace backend (dépendances optionnelles
   incluses : TypeScript 7 est un binaire natif livré ainsi), génération des
   deux clients Prisma, compilation vers `dist/` ;
2. `deps` : dépendances de production seules, **sans** optionnelles (donc sans
   pilote SQLite natif) ;
3. `runner` : `node:22-alpine` + OpenSSL (moteur de migration Prisma),
   utilisateur `node` (jamais root), npm / yarn retirés. Démarrage :
   `prisma migrate deploy && exec node dist/index.js` — les migrations sont
   idempotentes, `exec` transmet SIGTERM à Node (arrêt propre).
   Sonde de santé : `GET /api/health`.

La CLI Prisma (nécessaire aux migrations au démarrage) représente l'essentiel du
poids (Studio et ses dépendances). Alternative plus légère si besoin : lancer
les migrations dans un service `migrate` séparé (image `builder`) et retirer
`prisma` de l'image finale.

**Front** (`frontend/Dockerfile`, Nginx alpine, ~75 Mo) : build Vite (argument
`VITE_API_URL`, `/api` par défaut) puis Nginx (`frontend/nginx.conf`) :

- routage SPA (`try_files … /index.html`) ; un asset manquant renvoie un vrai
  404 (le Service Worker ne met jamais de HTML en cache à la place d'un `.js`) ;
- `index.html`, `sw.js`, `manifest.webmanifest` en `no-cache` (nouvelle version
  détectée), assets hachés `immutable` (1 an), gzip ;
- relais `/api/` → `backend:5000` (même origine : ni CORS ni cookie tiers ;
  résolveur DNS Docker, Nginx démarre même si l'API redémarre) ;
- en-têtes `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` ;
- sonde `/healthz`.

**Contexte de build = racine du monorepo** (un seul `package-lock.json` pour
les workspaces npm). Chaque Dockerfile a son `Dockerfile.dockerignore` voisin
(liste blanche, utilisée par BuildKit), le `.dockerignore` racine couvre le reste.

## 5. Variables (`.env`)

Voir `.env.example` : ports (`PORT`, `APP_URL`, `DEV_*`), PostgreSQL, `JWT_SECRET`,
`COOKIE_SECURE`, `TRUST_PROXY`, `CORS_ORIGINS`, `PUBLIC_API_BASE`,
`VITE_API_URL`, `CATALOG_SYNC`, `MANGADEX_USER_AGENT`. Compose refuse de
démarrer sans `POSTGRES_PASSWORD` ni `JWT_SECRET`.

## 6. Mise en production sur un serveur

Pas à pas, derrière Caddy et par l'IP publique : **[DEPLOY-VPS.md](DEPLOY-VPS.md)**.

1. Copier le dépôt (ou pousser les images `bookshelf-api` / `bookshelf-web` dans
   un registre), créer `.env`, `npm run docker:up` (ou `docker compose up --build -d`).
2. Placer un reverse proxy (Caddy, Traefik, Nginx…) devant `127.0.0.1:${PORT}`.
   Le cookie de session est `Secure` : sans HTTPS, la connexion échoue ailleurs
   que sur `localhost` (en HTTP par une IP : `COOKIE_SECURE=false`).
3. Reverse proxy de l'hôte + Nginx du front = deux sauts : `TRUST_PROXY=2`. Sinon
   toutes les requêtes semblent venir du même proxy, et le limiteur de
   tentatives de connexion (par IP) bloque tout le monde.
4. Sauvegardes : `docker compose exec postgres pg_dump -U bookshelf bookshelf > sauvegarde.sql`.
