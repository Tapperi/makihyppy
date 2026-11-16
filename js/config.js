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
  // Kyykkyasennon tasapaino: osoitin -1..1 (+ = asento nousee / paino kantapäillä).
  // Vihreällä kaistalla vastus on yllä oleva drag; kaistan ulkopuolella se kasvaa.
  balanceHalf: 0.22,     // vihreän kaistan puolileveys
  balanceErrFull: 0.5,   // etäisyys kaistan reunasta, jolla virhe = 1
  dragPenalty: 0.22,     // vastuksen lisäys täydellä virheellä (osuus)
  balanceAccel: 6,       // nojauksen teho (1/s²)
  balanceDamp: 4,
  curvePush: 6,          // siirtymäkaaren paine nostaa asentoa: kiihtyvyys per g (1/s²)
  swayAmp: 1.8,          // hidas huojunta suoralla (1/s²)
  swayPeriod: 2.6,       // (s)
  balanceTurb: 0.35,     // satunnainen tärinä
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
  liftK: 0.0086,       // nostekerroin kaistan sisällä (1/m); asento skaalaa tätä, ks. BAND
  drag: 0.0061,        // vastuskerroin lentoasennossa (1/m)
  // Paras kohtauskulma (kaistan keskikohta tyynellä) kasvaa lennon aikana: lentorata jyrkkenee, mutta
  // sukset pysyvät lähellä vaakatasoa. Mitatut arvot ovat noin 25–40°, lopussa suurimmillaan.
  aoaOpt: 26 * DEG,        // lennon alussa
  aoaOptLate: 38 * DEG,    // lennon lopussa
  aoaRampStart: 0.8,       // optimi alkaa kasvaa (s nokalta)
  aoaRampEnd: 3.8,         // ja on tässä lopullisessa arvossaan (s)
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
  trimAbove: 8 * DEG,       // sukset pyrkivät itsestään näin paljon optimin yläpuolelle: aina kaistan yläpuolella -> pelaajan pitää painaa eteen
  trimRate: 8,              // palauttavan momentin voimakkuus (1/s²)
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

/**
 * Kaatuminen kesken suorituksen: kun kyykky- tai asentomittarin osoitin on liian syvällä
 * punaisella (virhe >= raja), vaara kasvaa; täynnä (1) hyppääjä menettää hallinnan.
 * Sen jälkeen hän on eloton kappale, joka pomppii ja pyörii alas (Jump.stepCrash).
 */
export const CRASH = {
  inrunError: 0.85,    // kyykkymittarin virhe (0..1), josta vaara alkaa kasvaa
  inrunTime: 0.6,      // näin kauan rajan yli = kaatuu (s)
  // Lennossa raja on kulma kaistan reunasta. Etureunan alla (sukellus) se on tiukempi kuin
  // takareunan yllä, jossa mittarissa on ensin keltainen alue.
  flightFront: 3.5 * DEG,
  flightBack: 10 * DEG,
  flightTime: 0.8,
  recover: 0.6,        // vaara purkautuu tässä ajassa, kun osoitin palaa rajan alle (s)
  // Vauhtimäessä kaatuminen
  inrunKeep: 0.92,     // vauhdista säilyvä osuus kaatumishetkellä
  inrunPop: 2.6,       // hyppääjä kimpoaa ladusta (m/s)
  inrunImpact: 7,      // ensimmäisen tällin voimakkuus tehosteita varten (m/s)
  // Kierivä ja pomppiva hyppääjä
  airDrag: 0.008,      // ilmanvastus holtittomasti pyörivänä (1/m)
  restitution: 0.35,   // pinnasta kimpoava osuus kohtisuorasta nopeudesta
  kick: 0.1,           // osa pinnan suuntaisesta vauhdista kääntyy pompuksi (enintään, osuus)
  hitKeep: 0.86,       // pinnan suuntaisesta vauhdista säilyvä osuus iskussa
  settle: 1.5,         // tätä pienempi pomppu jää liu'uksi (m/s)
  friction: 0.45,      // kierimisen kitka rinteessä
  brakeFriction: 0.7,  // ja tasaisella loppuliu'ulla
  groundDrag: 0.006,   // (1/m)
  popSpeed: 7,         // tätä kovemmassa vauhdissa kierivä hyppääjä sinkoaa välillä ilmaan
  popRate: 1.4,        // keskimäärin näin monta kertaa sekunnissa
  popMin: 0.08, popMax: 0.22, // singahduksen nopeus osuutena vauhdista
  popKeep: 0.9,
  spinRadius: 1.6,     // pyörimisnopeus = vauhti / tämä (m)
  restSpeed: 3,        // tätä hitaammin hyppääjä jää makaamaan rinteen suuntaisesti (m/s)
  flightPenalty: 4,    // tyylivähennys ilmassa menetetystä hallinnasta kaatumisen lisäksi
};

/**
 * Tuuli. Kaudella on yksi tuulikuvio, joka on kaikille sama: silmukka, joka lasketaan kauden
 * numerosta ja mäestä (js/wind.js). Hyppy alkaa satunnaisesta kohdasta silmukkaa, ja koska
 * silmukka on lähtöaikaa (GATE_TIME) lyhyempi, jokainen ehtii puomilta mihin tahansa kohtaan.
 * Hyppykohtaista arpaa on vain vähän: kohina ja puuskien pieni heilunta.
 */
export const WIND = {
  max: 4,              // m/s, + = vastatuuli
  loop: 19,            // kuvion pituus (s) – pidä pienempänä kuin GATE_TIME
  // Kaudella tuulee koko ajan samasta suunnasta: voimakkuus elää ja välillä tyyntyy,
  // mutta vasta- ja myötätuuli eivät vaihdu kesken kauden.
  strengthMin: 0.8, strengthMax: 2.2, // kauden keskituuli (m/s), arvotaan tältä väliltä
  headChance: 0.6,     // todennäköisyys, että kauden tuuli on vastatuuli
  slowAmp: 0.5, slowCycles: 2,   // aallon korkeus osuutena keskituulesta; aaltoja per silmukka
  fastAmp: 0.25, fastCycles: 5,  //   (kokonaisluku, jotta silmukka on saumaton)
  // Kauden puuskat: yksi per silmukan lohko, paikka, kesto ja voimakkuus kuuluvat kuvioon.
  // Puuska joko voimistaa tuulta tai tyynnyttää sen (enintään tyyneksi asti).
  burstCount: 4,
  burstMinGap: 0.8,    // lyhin tauko puuskien välillä (s)
  burstMin: 0.5, burstMax: 1.5,       // kesto (s)
  burstAmpMin: 0.9, burstAmpMax: 2.2, // voimakkuus (m/s)
  burstLead: 0.4,      // ennakkovaroitus ennen kuin puuska alkaa vaikuttaa (s)
  // Käsin valitut kaudet: {dir: 1 vasta / -1 myötä, strength}. Muut arvotaan kauden siemenestä.
  seasons: {
    3: { dir: 1, strength: 1.8 },   // kohtalainen vastatuuli
    4: { dir: 1, strength: 2.8 },   // kova vastatuuli
  },
  // Hyppykohtainen vaihtelu
  gustSigma: 0.2, gustRate: 0.8,   // sileä kohina (hajonta ~ sigma / sqrt(2 × rate) = 0,16 m/s)
  burstAmpJitter: 0.1,   // puuskan voimakkuus heiluu ± tämän osuuden
  burstTimeJitter: 0.1,  // puuskan ajoitus heiluu ± näin monta sekuntia
};

/**
 * Asentomittarin vihreä kaista ja lentoasennon suorituskyky. Leveydet osuutena
 * koko mittarin korkeudesta (2 × range).
 *
 * Noste = FLIGHT.liftK × kerroin, joka riippuu vain osoittimen paikasta kaistaan nähden:
 *   kaistan sisällä 1, etureunan (kärjet alhaalla) herkkukaistalla nousee arvoon 1 + edgeBonus,
 *   etureunan yli noste romahtaa (sukellus), takareunan yli se hiipuu loivasti.
 */
export const BAND = {
  range: 20 * DEG,       // mittarin näyttämä poikkeama suuntaansa
  widthCalm: 0.25,       // kaistan leveys tyynellä
  widthWindy: 0.10,      // kaistan leveys täydellä tuulella (WIND.max)
  shiftPerMs: 1.2 * DEG, // kaistan siirtymä per m/s: vastatuuli -> kärjet alemmas, myötätuuli -> ylemmäs
  follow: 6,             // kuinka nopeasti kaista seuraa tuulta (1/s)
  errFull: 12 * DEG,     // etäisyys kaistan reunasta, jolla virhe = 1 (täysi huojunta)
  sweet: 1.5 * DEG,      // herkkukaistan leveys etureunassa
  edgeBonus: 0.03,       // lisänoste aivan etureunalla
  diveWidth: 5 * DEG,    // etureunan yli: noste putoaa arvoon diveMin tällä matkalla
  diveMin: 0.75,
  backWidth: 20 * DEG,   // takareunan yli: noste hiipuu arvoon backMin tällä matkalla
  backMin: 0.75,
};

/** Globaali tulostaulu (worker/). Tyhjä url = tulostaulu pois päältä. */
/**
 * Kausi (ennätysten versio). Kasvata, kun fysiikka muuttuu niin, etteivät vanhat tulokset
 * ole vertailukelpoisia – myös worker/src/index.js:n SEASON. Uusi kausi alkaa tyhjältä
 * taululta; kausien nimet ovat workerissa.
 */
export const SEASON = 4;

export const LEADERBOARD = {
  url: 'https://tuulimaki-scores.tapperi.workers.dev', // näkyy `wrangler deploy` -komennon tulosteessa
};

/** Väliajat: lentokorkeus mitataan näillä etäisyyksillä (m) ja sitä verrataan ennätyshyppyyn. */
export const SPLITS = [50, 90];

export const GATE_TIME = 20; // lähtöaika sekunteina, sen jälkeen hyppääjä lähtee itse
