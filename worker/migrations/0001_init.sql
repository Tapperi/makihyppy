-- Pelaaja = laite. Nimi on varattu sille laitteelle, joka käytti sitä ensin.
-- Laitetunnuksesta tallennetaan vain SHA-256-tiiviste.
CREATE TABLE players (
  device_hash  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL UNIQUE,   -- pienaakkosin, vertailua varten
  created_at   INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL        -- laitekohtainen lähetysväli
) WITHOUT ROWID;

-- Vain paras tulos per pelaaja ja mäki.
CREATE TABLE scores (
  device_hash TEXT NOT NULL REFERENCES players(device_hash),
  hill        TEXT NOT NULL,
  distance    REAL NOT NULL,
  style       REAL NOT NULL,
  total       REAL NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (device_hash, hill)
) WITHOUT ROWID;

CREATE INDEX scores_top ON scores (hill, total DESC, distance DESC, achieved_at);
