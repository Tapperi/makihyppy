// Kaikki viritettävät vakiot yhdessä paikassa.
// Yksiköt: metri, sekunti, radiaani (ellei nimessä lue Deg).

export const DEG = Math.PI / 180;
export const G = 9.81;

/** Fysiikan kiinteä aika-askel (s). */
export const STEP = 1 / 120;

/** Mäen määrittely. Vaiheessa 3 tänne lisätään muita mäkiä. */
export const HILLS = {
  tuulivaara: {
    id: 'tuulivaara',
    name: 'Tuulivaara',
    k: 120,              // K-piste (m)
    hs: 134,             // mäen koko (m)
    pointsPerMeter: 1.8,
    // Vauhtimäki
    tableAngle: 11 * DEG,   // hyppyripöydän kaltevuus
    tableLength: 6.5,
    inrunAngle: 35 * DEG,   // suoran osan kaltevuus
    inrunRadius: 95,        // siirtymäkaaren säde
    inrunLength: 84,        // lähtöpuomin etäisyys nokalta rataa pitkin
    // Alastulorinne
    takeoffHeight: 3,       // nokan korkeus rinteestä
    knollAngle: 9 * DEG,    // rinteen kaltevuus heti nokan alla
    pAngle: 37 * DEG,       // jyrkin kohta (P-piste)
    pDist: 90,              // P-pisteen etäisyys
    kAngle: 35 * DEG,
    hsAngle: 32 * DEG,
    outRadius: 105,         // alastulon siirtymäkaaren säde
    outrunLength: 120,      // tasaisen loppuliu'un pituus
  },
};

export const INRUN = {
  friction: 0.03,
  drag: 0.0019,        // ilmanvastus kyykyssä (1/m)
  windFactor: 0.3,     // kuinka paljon tuuli tuntuu suojaisessa vauhtimäessä
};

export const TAKEOFF = {
  zone: 20,            // ajoituspalkki alkaa näin monta metriä ennen nokkaa
  lateZone: 4,         // palkin jatke nokan jälkeen (m)
  optimum: 0.4,        // paras ponnistuskohta, metriä ennen nokkaa
  perfect: 0.5,        // tämän sisällä optimista = täysi teho (m)
  falloff: 11,         // tästä eteenpäin teho laskee nollaan (m)
  lateTime: 0.15,      // myöhästynyt ponnistus kelpaa vielä näin kauan (s)
  lateMax: 0.7,        // myöhästyneen ponnistuksen paras mahdollinen teho
  baseShare: 0.4,      // osuus ponnistuksesta, jonka saa huonollakin ajoituksella
  impulse: 2.7,        // täyden ponnistuksen nopeus pöytää vastaan kohtisuoraan (m/s)
};

export const FLIGHT = {
  liftK: 0.0090,       // nostekerroin parhaassa asennossa (1/m)
  dragBase: 0.0026,
  dragAlpha: 0.021,   // kohtauskulmasta riippuva vastus
  aoaOpt: 24 * DEG,    // paras kohtauskulma
  aoaLow: 22 * DEG,    // nosteen leveys optimin alapuolella
  aoaHigh: 21 * DEG,   // nosteen leveys optimin yläpuolella (sakkaus)
  liftMin: 0.15,
  uprightLift: 0.0008, // pystyasento (ponnistuksen jälkeen / alastuloon valmistautuessa)
  uprightDrag: 0.0062,
  entryPitch: 10 * DEG,     // suksien asento, johon hyppääjä kiertyy itsestään ponnistuksen jälkeen
  entryTime: 0.5,
  postureTime: 0.45,        // lentoasennon ottamiseen kuluva aika hyvällä ponnistuksella
  postureSlow: 0.5,         // lisäaika huonolla ponnistuksella
  prepTime: 0.2,            // alastuloasentoon nousu
  pitchAccel: 150 * DEG,    // ohjauksen kulmakiihtyvyys
  pitchDamp: 4.2,
  pitchLimit: 55 * DEG,
  trimAoa: 27 * DEG,        // kohtauskulma, johon sukset pyrkivät itsestään (liian pysty -> pelaajan pitää painaa eteen)
  trimRate: 14,              // palauttavan momentin voimakkuus (1/s²)
  windTilt: 18 * DEG,       // tuuli myötäilee rinnettä: vastatuuli puhaltaa hieman ylöspäin
  turbBase: 5 * DEG,        // tuulen pyörteiden vaikutus asentoon
  turbWind: 2.5 * DEG,
  landArmTime: 1.0,         // alastulonappi toimii vasta näin pitkän lennon jälkeen (s)
};

export const LANDING = {
  prepMin: 0.1,        // lyhyempi valmistautuminen = tasajalka
  prepIdealMax: 0.6,   // pidempi valmistautuminen = tyylivähennys
  hardImpact: 7.0,     // rinnettä vastaan kohtisuora nopeus, jolla telemark ei enää onnistu (m/s)
  fallImpact: 9.2,     // tällä nopeudella kaatuu varmasti
  slideFriction: 0.05,
  brakeFriction: 0.55,
  // Kaatunut hyppääjä pyörii rinteen alas lumipallona
  fallFriction: 0.2,   // pyörimisvastus rinteessä
  ballBrake: 0.24,     // pyörimisvastus tasaisella loppuliu'ulla
  ballDrag: 0.005,     // pallon lisävastus (1/m)
  ballGrow: 90,        // matka (m), jonka pyörittyään pallo on täysikokoinen
  ballRadius: 3.0,     // täysikokoisen lumipallon säde (m)
  slideDrag: 0.0035,
};

export const WIND = {
  max: 4,              // m/s, + = vastatuuli
  baseRange: 1.4,
  slowAmp: 1.1, slowPeriod: 9.5,
  fastAmp: 0.6, fastPeriod: 3.7,
  gustSigma: 0.55, gustRate: 0.8,   // sileä kohina
  // Erilliset puuskat
  burstEvery: 3.5,     // keskimääräinen väli (s)
  burstMinGap: 1.2,    // lyhin tauko puuskien välillä (s)
  burstMin: 0.5, burstMax: 1.5,       // kesto (s)
  burstAmpMin: 0.9, burstAmpMax: 2.2, // voimakkuus (m/s), suunta arvotaan
  burstLead: 0.4,      // ennakkovaroitus ennen kuin puuska alkaa vaikuttaa (s)
};

/** Asentomittarin vihreä kaista. Leveydet osuutena koko mittarin korkeudesta (2 × range). */
export const BAND = {
  range: 20 * DEG,       // mittarin näyttämä poikkeama suuntaansa
  widthCalm: 0.25,       // kaistan leveys tyynellä
  widthWindy: 0.10,      // kaistan leveys täydellä tuulella (WIND.max)
  shiftPerMs: 1.2 * DEG, // optimin siirtymä per m/s: vastatuuli -> kärjet alemmas, myötätuuli -> ylemmäs
  follow: 6,             // kuinka nopeasti kaista seuraa tuulta (1/s)
  errFull: 12 * DEG,     // etäisyys kaistan reunasta, jolla virhe = 1 (täysi huojunta)
};

/** Globaali tulostaulu (worker/). Tyhjä url = tulostaulu pois päältä. */
export const LEADERBOARD = {
  url: 'https://tuulimaki-scores.tapperi.workers.dev', // näkyy `wrangler deploy` -komennon tulosteessa
};

export const GATE_TIME = 20; // lähtöaika sekunteina, sen jälkeen hyppääjä lähtee itse
