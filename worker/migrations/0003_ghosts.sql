-- Haamuhyppääjä: parhaan tuloksen rata JSON-tekstinä (ks. pelin js/ghost.js ja worker/src/ghost.js).
-- NULL, jos tulos on ajalta ennen haamuja tai hyppy päättyi kaatumiseen.
ALTER TABLE scores ADD COLUMN ghost TEXT;
