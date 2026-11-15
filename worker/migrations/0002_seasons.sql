-- Kaudet: paras tulos per pelaaja, mäki ja kausi. Aiemmat tulokset kuuluvat kauteen 1.
-- Pääavain muuttuu, joten taulu rakennetaan uudelleen ja rivit kopioidaan.
CREATE TABLE scores_new (
  device_hash TEXT NOT NULL REFERENCES players(device_hash),
  hill        TEXT NOT NULL,
  season      INTEGER NOT NULL,
  distance    REAL NOT NULL,
  style       REAL NOT NULL,
  total       REAL NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (device_hash, hill, season)
) WITHOUT ROWID;

INSERT INTO scores_new (device_hash, hill, season, distance, style, total, achieved_at)
  SELECT device_hash, hill, 1, distance, style, total, achieved_at FROM scores;

DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;

CREATE INDEX scores_top ON scores (season, hill, total DESC, distance DESC, achieved_at);
