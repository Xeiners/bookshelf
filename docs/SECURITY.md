# Sécurité — audit et durcissement

Dernier passage : audit en lecture seule en quatre volets (comptes/sessions, fichiers/réseau sortant,
temps réel/économie, plateforme/frontend), chaque trouvaille vérifiée dans le code avant correction.
Aucun audit ne garantit « zéro faille » : ce document dit ce qui est couvert, et ce qui reste.

## Garde-fous en place

| Domaine | Mesure | Où |
| --- | --- | --- |
| Sessions | JWT HS256 (issuer, `sessionVersion`, suspension), cookie `HttpOnly` + `SameSite=Lax` + `Secure` en production | `core/security/session.ts` |
| Secret | production : `JWT_SECRET` ≥ 32 caractères exigé ; le build compilé (`dist/*.js`) est « production » par défaut | `core/config.ts` |
| Codes e-mail | HMAC, 6 chiffres `randomInt`, 15 min, 5 essais **réservés atomiquement** avant comparaison, plafond par compte en plus de l'IP | `modules/auth/auth.routes.ts` |
| Limiteurs | par IP (IPv6 regroupée par /64) et par compte visé | `core/http/rateLimit.ts` |
| Mot de passe | scrypt N=2^16 ; changer le mot de passe coupe toutes les autres sessions | `core/security/password.ts` |
| En-têtes API | `nosniff`, `X-Frame-Options`, CSP `default-src 'none'; sandbox`, `Referrer-Policy`, HSTS (cookie `Secure`), `no-store` sur le JSON | `core/http/securityHeaders.ts` |
| Front (nginx) | `nosniff`, `X-Frame-Options`, `Permissions-Policy`, CSP minimale (`object-src`, `base-uri`, `form-action`, `frame-ancestors`) | `frontend/nginx.conf` |
| Images tierces | type lu dans les **octets** (jpeg/png/gif/webp/avif), jamais l'en-tête ; pas de SVG/HTML servi ; redirections refusées | `core/infra/imageType.ts` |
| SSRF | liste d'hôtes publics, redirections revalidées, IPv4 encapsulée (`::ffff:`, NAT64, compatible) décodée | `modules/proxy/proxy.fetch.ts` |
| EPUB | analyse linéaire (pas de ReDoS) dans un fil jetable avec délai de 8 s | `modules/books/epub/*` |
| Photos de profil | ré-encodées en WebP (métadonnées/GPS retirées), 1024 px max, pixels décodés bornés | `modules/users/avatarUpload.ts` |
| Économie | reçus d'invité à usage unique (table `GuestReceiptClaim`), règlement unique des parties Bomb, 1 récompense de record / compte / 24 h | `cards.service.ts`, `stardust.service.ts`, `bomb.solo.ts`, `rewards.service.ts` |
| Temps réel | Origin vérifiée, 3 connexions par joueur, battement de cœur, salons plafonnés, upgrades inconnus fermés | `stack.socket.ts`, `core/security/socketAuth.ts` |
| Production | `BOOSTER_UNLIMITED_MODE` interdit (le démarrage échoue) | `src/index.ts` |
| Conteneurs | Suwayomi/FlareSolverr (extensions tierces) sur un réseau à part, sans accès à PostgreSQL | `docker-compose.yml` |

## Risques résiduels connus (décisions, pas oublis)

- **Scores des jeux solo déclarés par le client** (Stack, Runner, Plus ou Moins, Bomb) : le serveur borne au plausible
  physique et plafonne les gains/jour, mais seul un rejeu des entrées côté serveur prouverait un score.
- **DLE zoom/pixel** : l'image complète est servie, le recadrage se fait côté client ; un joueur outillé peut la lire.
  Correctif possible : rendre le recadrage/la pixellisation côté serveur selon le nombre d'erreurs.
- **Énumération d'e-mails à l'inscription** (`409 email_taken`) : compromis d'ergonomie, limité par les limiteurs.
- **Déconnexion** : efface le cookie mais n'invalide pas le jeton (30 j) ; un jeton volé est coupé par un changement/réinitialisation du mot de passe.
- **DNS rebinding** du relais d'images : le nom est résolu puis `fetch` le résout à nouveau ; exploitable seulement
  par un hôte de source déjà hostile, en GET aveugle (réponse servie uniquement si c'est une image).
- **Quota de livres** : des envois parallèles peuvent dépasser le quota de quelques fichiers (borné par le limiteur d'envoi).
- **epubjs → @xmldom/xmldom** (front, `npm audit`) : analyse de **ses propres** fichiers dans son navigateur, sans effet serveur.
- Production en HTTP seul (`COOKIE_SECURE=false`, déploiement par IP) : le cookie et les mots de passe circulent en clair —
  à réserver aux essais ; en production publique, utiliser un domaine HTTPS.
