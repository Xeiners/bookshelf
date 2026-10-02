-- Photos de profil importées : de l'adresse « photo de la personne connectée »
-- (`/api/profile/avatar-image`, invisible pour les autres) vers l'adresse publique
-- du titulaire (`/api/users/<id>/avatar`). Version (`?v=`) et recadrage (`#…`) suivent.
UPDATE "User"
SET "avatarUrl" = REPLACE("avatarUrl", '/api/profile/avatar-image', '/api/users/' || "id" || '/avatar')
WHERE "avatarUrl" LIKE '/api/profile/avatar-image%';
