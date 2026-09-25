# Déployer sur un VPS derrière Caddy (accès par IP, sans domaine)

Cas couvert : un VPS qui héberge déjà d'autres projets sur les ports 80 / 443
avec **Caddy**, sans nom de domaine pour Bookshelf. L'app est servie en HTTP sur
l'IP publique, par un port dédié.

```
navigateur ─► http://IP:8080 ─► Caddy (hôte) ─► 127.0.0.1:8082 ─► Nginx (front) ─/api─► API ─► PostgreSQL
              port ouvert        reverse proxy    lié en local       conteneurs Docker (réseau interne)
```

Le port 8082 n'est lié qu'à `127.0.0.1` : **injoignable depuis Internet**, même
avec un pare-feu mal réglé (Docker publie ses ports avant `ufw`). Tout passe par Caddy.

## Prérequis sur le VPS

- Docker Engine et le plugin Compose v2 : `docker compose version`
- Caddy déjà installé en service : `systemctl status caddy`
- Git, et `openssl` (pour générer les secrets)

## 1. Récupérer le projet

Première installation :

```bash
sudo mkdir -p /opt/bookshelf && sudo chown "$USER" /opt/bookshelf
git clone <URL_DU_DÉPÔT> /opt/bookshelf
cd /opt/bookshelf
```

Mise à jour ultérieure :

```bash
cd /opt/bookshelf
git pull
```

## 2. Créer le `.env` de production

Docker Compose lit **`.env`** (à la racine du projet) : c'est le fichier de
production. Il n'est jamais versionné.

```bash
cp .env.example .env
IP=$(curl -4 -s https://ifconfig.me)          # ou l'IP publique connue du VPS
sed -i "s|^APP_URL=.*|APP_URL=http://$IP:8080|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=\n')|" .env
chmod 600 .env
grep -E '^(PORT|APP_URL|COOKIE_SECURE|TRUST_PROXY)=' .env
```

Valeurs attendues :

| Variable | Valeur | Pourquoi |
| --- | --- | --- |
| `PORT` | `8082` | port local du front, lié à `127.0.0.1` (changer si 8082 est pris) |
| `APP_URL` | `http://IP:8080` | adresse publique, origine autorisée par l'API |
| `COOKIE_SECURE` | `false` | en HTTP, un cookie `Secure` n'est jamais renvoyé : la session serait perdue à chaque requête |
| `TRUST_PROXY` | `2` | Caddy + Nginx : l'API voit la vraie IP de chaque visiteur (limiteur de connexion par IP) |

⚠️ Ne pas changer `POSTGRES_PASSWORD` après le premier démarrage : la base,
déjà initialisée dans le volume, garde l'ancien mot de passe.

## 3. Lancer la pile

```bash
docker compose up -d --build
```

Premier démarrage : quelques minutes de build, puis PostgreSQL → API
(migrations appliquées) → front, chacun attendant que le précédent soit sain.

```bash
docker compose ps                        # 3 services « healthy »
curl -s http://127.0.0.1:8082/api/health # l'app répond en local
```

## 4. Brancher Caddy

Ajouter le bloc de [`deploy/Caddyfile`](../deploy/Caddyfile) au Caddyfile global
(souvent `/etc/caddy/Caddyfile`), en remplaçant `YOUR_VPS_IP` :

```caddyfile
http://203.0.113.10:8080 {
	reverse_proxy 127.0.0.1:8082 {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
	}
}
```

```bash
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy   # si le bloc garde le journal dédié
caddy validate --config /etc/caddy/Caddyfile       # vérifier AVANT de recharger
sudo caddy reload --config /etc/caddy/Caddyfile    # sans coupure pour les autres sites
sudo ufw allow 8080/tcp                             # ouvrir le port public (si ufw est actif)
```

Puis ouvrir **http://IP:8080**.

- **Port 80 plutôt qu'un port dédié** : option B du fichier `deploy/Caddyfile`
  (`http://IP`), si aucun autre bloc ne capte tout le port 80. Mettre alors
  `APP_URL=http://IP` et relancer : `docker compose up -d`.
- **Pas de sous-dossier** (`http://IP/bookshelf`) : l'app utilise des chemins
  absolus (`/api`, `/assets`, `/sw.js`).
- **Sans HTTPS**, les navigateurs n'activent ni le mode PWA installable ni le
  Service Worker (réservés aux contextes sécurisés). L'app fonctionne
  normalement ; le partage de l'Oracle passe par un téléchargement.

## 5. Vérifier

```bash
docker compose ps                                   # état et santé
docker compose logs -f --tail=100                   # journaux de toute la pile
docker compose logs backend | grep -iE 'migration|prête|catalogue'
curl -s http://IP:8080/api/health                   # de l'extérieur, via Caddy
curl -sI http://IP:8080/ | grep -i via              # « Via: 1.1 Caddy »
curl -s -m 5 http://IP:8082/ || echo "port interne fermé ✔"   # doit échouer
sudo journalctl -u caddy -n 50 --no-pager           # journaux de Caddy
sudo tail -f /var/log/caddy/bookshelf.log           # accès à Bookshelf
```

Au premier démarrage, l'API indexe le catalogue AniList + MangaDex en tâche de
fond (≈ 4 min) ; le suivi : `docker compose logs -f backend | grep catalogue`.

## 6. Exploitation

| Besoin | Commande |
| --- | --- |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Redémarrer | `docker compose restart` |
| Arrêter (données conservées) | `docker compose down` |
| Sauvegarder la base | `docker compose exec -T postgres pg_dump -U bookshelf bookshelf > bookshelf-$(date +%F).sql` |
| Restaurer | `docker compose exec -T postgres psql -U bookshelf bookshelf < sauvegarde.sql` |
| Nettoyer les vieilles images | `docker image prune -f` |

Les conteneurs redémarrent seuls après un reboot du VPS (`restart: unless-stopped`),
à condition que le service Docker soit activé : `sudo systemctl enable docker`.

## 7. Plus tard : un nom de domaine et HTTPS

1. DNS : un enregistrement `A` vers l'IP du VPS.
2. Caddy : remplacer l'adresse du bloc par le domaine (HTTPS automatique, cf.
   la fin de `deploy/Caddyfile`), puis `sudo caddy reload --config /etc/caddy/Caddyfile`.
3. `.env` : `APP_URL=https://bookshelf.exemple.fr`, `COOKIE_SECURE=true`, puis
   `docker compose up -d`. Le mode PWA installable s'active alors tout seul.

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| Connexion au compte « perdue » aussitôt | `COOKIE_SECURE=true` alors que l'app est en HTTP |
| « Trop de tentatives » pour tout le monde | `TRUST_PROXY` trop bas (ex. `1`) : tous les visiteurs ont l'IP du proxy |
| 502 Bad Gateway (Caddy) | pile arrêtée ou `PORT` différent de celui du bloc Caddy : `docker compose ps` |
| `POSTGRES_PASSWORD` refusé après modification | la base garde le mot de passe initial (voir §2) |
| Le port 8082 répond depuis l'extérieur | il a été republié sans `127.0.0.1:` dans `docker-compose.yml` |
