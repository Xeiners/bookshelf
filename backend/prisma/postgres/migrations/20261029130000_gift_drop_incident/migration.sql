-- Geste d'excuse après l'incident des Légendaires (garantie déclenchée en masse lors du passage à
-- 100 boosters) : chaque compte existant reçoit 5 boosters offerts et un pack Légendaire garanti à
-- ouvrir, avec une notification de l'équipe. Une migration ne s'applique qu'une fois : le cadeau
-- n'est jamais donné deux fois.

-- Un compte qui n'a encore jamais ouvert de booster n'a pas de ligne de stock : on la crée.
INSERT INTO "UserBooster" ("userId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "User"
WHERE "id" NOT IN (SELECT "userId" FROM "UserBooster");

UPDATE "UserBooster"
SET "giftedBoosters" = "giftedBoosters" + 5,
    "legendaryPacks" = "legendaryPacks" + 1;

INSERT INTO "Notification" ("id", "userId", "type", "data", "createdAt")
SELECT 'gift-drop-incident-' || "id", "id", 'team_gift', '{"boosters":5,"legendaryPacks":1,"reason":"drop_incident"}', CURRENT_TIMESTAMP
FROM "User";
