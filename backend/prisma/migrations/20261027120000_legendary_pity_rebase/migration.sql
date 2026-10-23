-- Garantie Légendaire passée de 125 à 100 boosters : les compteurs hérités de l'ancienne
-- règle (de 99 à 124) la déclenchaient tous au booster suivant. Chacun garde la distance
-- qu'il avait avec l'ancienne garantie (125 - n boosters restants) : n devient n - 25.
-- Un joueur à 124 (garantie au prochain booster avec l'ancienne règle) la garde.
UPDATE "UserBooster"
SET "boostersSinceLastLegendary" = "boostersSinceLastLegendary" - 25
WHERE "boostersSinceLastLegendary" >= 99;
