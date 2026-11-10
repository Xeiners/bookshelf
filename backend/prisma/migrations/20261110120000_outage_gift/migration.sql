-- Geste d'excuse après la coupure du serveur (une journée éteint) : les calendriers de la
-- récompense quotidienne sont repartis du jour 1 pour tout le monde. Chaque compte existant :
--   - reprend son calendrier au jour 25 ;
--   - reçoit 5 boosters offerts et un pack Légendaire garanti à ouvrir, avec une notification.
-- Une migration ne s'applique qu'une fois : rien n'est donné deux fois.

-- Jour de Paris au moment du déploiement (`YYYY-MM-DD`). SQLite ne connaît pas les fuseaux :
-- Paris est à UTC+1 l'hiver (la base PostgreSQL de production, elle, suit le vrai fuseau).
-- Case du jour déjà prise : elle compte pour le jour 25 (demain, le 26).
UPDATE "DailyReward"
SET "streak" = 25,
    "bestStreak" = MAX("bestStreak", 25),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "lastDay" = date('now', '+1 hour')
  AND "streak" < 25;

-- Les autres : la case du jour sera le jour 25 (sauf une série déjà au-delà, qui continue).
UPDATE "DailyReward"
SET "streak" = 24,
    "lastDay" = date('now', '+1 hour', '-1 day'),
    "bestStreak" = MAX("bestStreak", 24),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE ("lastDay" IS NULL OR "lastDay" <> date('now', '+1 hour'))
  AND NOT ("lastDay" IS NOT NULL AND "lastDay" = date('now', '+1 hour', '-1 day') AND "streak" >= 24);

-- Un compte qui n'a jamais ouvert le calendrier : il commence lui aussi au jour 25.
INSERT INTO "DailyReward" ("userId", "streak", "cycle", "lastDay", "totalClaims", "bestStreak", "updatedAt")
SELECT "id", 24, 0, date('now', '+1 hour', '-1 day'), 0, 24, CURRENT_TIMESTAMP
FROM "User"
WHERE "id" NOT IN (SELECT "userId" FROM "DailyReward");

-- Un compte qui n'a encore jamais ouvert de booster n'a pas de ligne de stock : on la crée.
INSERT INTO "UserBooster" ("userId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "User"
WHERE "id" NOT IN (SELECT "userId" FROM "UserBooster");

UPDATE "UserBooster"
SET "giftedBoosters" = "giftedBoosters" + 5,
    "legendaryPacks" = "legendaryPacks" + 1;

INSERT INTO "Notification" ("id", "userId", "type", "data", "createdAt")
SELECT 'gift-server-outage-' || "id", "id", 'team_gift', '{"boosters":5,"legendaryPacks":1,"reason":"server_outage"}', CURRENT_TIMESTAMP
FROM "User";
