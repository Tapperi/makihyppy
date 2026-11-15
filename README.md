# Tuulimäki

Mäkihyppypeli selaimeen ja puhelimeen. HTML5 canvas + vanilla JS, ei kirjastoja, ei build-vaihetta. Asentuu kotinäytölle (PWA) ja toimii ilman verkkoa.

## Käynnistys

```
npm start          # http://localhost:8080
npm test           # fysiikan ja pisteytyksen testit (Node)
npm run test:browser   # pelaa pelin läpi headless-selaimessa
```

Peli käyttää ES-moduuleja, joten se pitää avata palvelimen kautta (ei `file://`).
Puhelimeen asentaminen vaatii HTTPS-osoitteen – kansion voi julkaista sellaisenaan
millä tahansa staattisella palvelulla (esim. GitHub Pages).

## Ohjaus

| Vaihe | Kosketus | Näppäimistö |
|---|---|---|
| Lähtö, ponnistus, alastulo | iso painike tai napautus ruutuun | välilyönti / Enter |
| Nojaa eteen / taakse vauhtimäessä (kyykky) ja liidossa | ▼ / ▲ | ↓ / ↑ (myös → / ←, S / W) |

Kaatuminen: jos kyykky- tai asentomittarin osoitin on liian kauan mittarin päiden kirkkaanpunaisella
kaatumisalueella, hyppääjä menettää hallinnan ja kierii alas. Vauhtimäessä kaatunut ei saa tulosta;
ilmassa kaatuneen pituus mitataan putoamiskohdasta. Rajat ja kierimisen fysiikka: `js/config.js`:n `CRASH`.

## Rakenne

```
index.html, css/style.css     sivu, valikot, kosketuspainikkeet
manifest.webmanifest, sw.js   PWA (sw.js: päivitä ASSETS + VERSION, kun tiedostoja lisätään)
js/config.js                  kaikki viritettävät vakiot ja mäkien määrittelyt
js/hill.js                    mäen profiili (vauhtimäki + alastulorinne)
js/wind.js                    tuulimalli
js/physics.js                 puhtaat fysiikkafunktiot
js/scoring.js                 pituus- ja tyylipisteet
js/jump.js                    yhden hypyn tilakone (ei DOMia – ajettavissa myös Nodessa)
js/input.js                   näppäimistö + kosketus -> {action, lean}
js/storage.js                 localStorage-kääre
js/leaderboard.js             globaali tulostaulu: nimi + laitetunnus, tuloksen lähetys, top 50
worker/                       tulostaulun palvelin (Cloudflare Worker + D1), ks. alla
js/ui.js                      DOM-valikot ja tulospaneeli
js/render/scene.js            maailman piirto ja kamera
js/render/jumper.js           hyppääjän asennot ja piirto
js/render/hud.js              tuulimittari, ponnistuspalkki, asentomittari
js/main.js                    pelisilmukka, kokoaa kaiken
tests/                        simulaatiotestit, testibotti, selainajuri, tune.mjs virittämiseen
tools/                        kehityspalvelin, kuvakkeiden generointi
```

`Jump` ei tiedä piirrosta eikä syötelaitteista mitään: sille annetaan joka askeleella
`{action, lean}`. Sama luokka käy siis ihmispelaajalle, testibotille (`tests/bot.js`)
ja myöhemmin tietokonevastustajille.

## Globaali tulostaulu

Palvelin on `worker/`-kansiossa: Cloudflare Worker + D1. Peli toimii ilman sitäkin –
tulostaulu on päällä vain, kun `js/config.js`:n `LEADERBOARD.url` on asetettu.

- `POST /score` `{name, deviceId, hill, season, distance, style}` – palvelin laskee kokonaispisteet itse
  ja säilyttää vain pelaajan parhaan tuloksen per kausi. Vastaus: `{best, rank, improved}`.
- `GET /top?hill=tuulivaara&season=1` – kauden 50 parasta kokonaispisteiden mukaan (ilman `season`-arvoa nykyinen kausi).
- Kaudet: kun fysiikka muuttuu niin, etteivät vanhat tulokset ole vertailukelpoisia, kasvata `SEASON`-arvoa
  sekä `js/config.js`:ssä että `worker/src/index.js`:ssä ja aja `npx wrangler deploy`. Uusi kausi alkaa tyhjältä
  taululta, vanhat kaudet voi selata tulostaulun nuolilla. Kausien nimet ovat `worker/src/index.js`:n
  `SEASON_NAMES`-listassa (1 = Murtumaraja). Vanhan kauden peliversio saa lähetyksestä `400 season_mismatch`.
- Nimi (3–16 merkkiä) on varattu sille laitetunnukselle, joka käytti sitä ensin (`409 name_taken` muille).
- Tarkistukset: pituus 0–`maxDistance` puolen metrin portain, tyylipisteet 0–60 puolentoista pisteen portain.
- Rajoitukset: 12 lähetystä ja 60 hakua minuutissa per IP, lisäksi 5 s väli per laite.
- CORS vain `wrangler.toml`:n `ALLOWED_ORIGIN`-osoitteelle; muualta tulevat lähetykset hylätään.

Käyttöönotto (kerran):

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create tuulimaki-scores      # kopioi database_id tiedostoon wrangler.toml
npx wrangler d1 migrations apply tuulimaki-scores --remote
npx wrangler deploy                          # tulostaa Workerin osoitteen -> js/config.js LEADERBOARD.url
```

Uuden mäen lisääminen: lisää se myös `worker/src/index.js`:n `HILLS`-taulukkoon ja aja `npx wrangler deploy`.

Paikallinen kokeilu: tee `worker/.dev.vars`, jossa `ALLOWED_ORIGIN=http://localhost:8080`, aja
`npx wrangler d1 migrations apply tuulimaki-scores --local` ja `npx wrangler dev`, ja avaa peli osoitteessa
`http://localhost:8080/?api=http://localhost:8787`.

## Tilanne

- [x] Vaihe 1: yksi mäki, tuuli, lähtö, ponnistus, liito, telemark, pituus + tyylipisteet
- [ ] Vaihe 2: maailmancup-tila, tietokonevastustajat, mäkiviikko, tallennus
- [ ] Vaihe 3: moninpeli samalla laitteella, äänet, lisää mäkiä, tuomaripisteet
