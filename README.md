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
| Nojaa eteen / taakse liidossa | ▼ / ▲ | ↓ / ↑ (myös → / ←, S / W) |

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

## Tilanne

- [x] Vaihe 1: yksi mäki, tuuli, lähtö, ponnistus, liito, telemark, pituus + tyylipisteet
- [ ] Vaihe 2: maailmancup-tila, tietokonevastustajat, mäkiviikko, tallennus
- [ ] Vaihe 3: moninpeli samalla laitteella, äänet, lisää mäkiä, tuomaripisteet
