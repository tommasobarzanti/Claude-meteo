/* ==========================================================================
   VEDETTA — logica pura: nessun accesso al DOM né alla rete.
   Le soglie operative stanno qui in cima: si modificano qui, mai nella logica.
   Nel browser è uno script classico ed espone window.Vedetta; nei test Node
   si carica con require().
   ========================================================================== */
(function (radice) {
"use strict";

/* Soglie bandiera — Beaufort (vento) e Douglas (mare).
   VERDE: vento E onda sotto le soglie verdi (Beaufort ≤3, Douglas ≤2).
   ROSSA: vento O raffica O onda oltre le soglie rosse (Beaufort ≥6, Douglas ≥4).
   GIALLA: tutto il resto. Adatta i numeri all'ordinanza della Capitaneria
   competente (Portoferraio per il litorale di Follonica). */
const BANDIERA_SOGLIE = {
  VENTO_VERDE_KMH: 20, VENTO_ROSSO_KMH: 39, RAFFICA_ROSSA_KMH: 55,
  ONDA_VERDE_M: 0.5,   ONDA_ROSSA_M: 1.25
};
const PIOGGIA_SOGLIE = { BASSA: 20, ALTA: 50 };     // % probabilità
const PRESSIONE_DELTA_HPA = 1.0;                    // variazione su 3h per salita/calo
const PRESSIONE_ORE_CONFRONTO = 3;
const TEMPORALE_CODICI = [95, 96, 99];              // weather_code WMO: temporale (anche con grandine)
const ORE_ALLERTA_TEMPORALE = 12;                   // finestra di preavviso
const GIORNATA = { ORA_MIN: 6, ORA_MAX: 21 };       // fascia oraria del pannello Bagnino
const ORE_MINIME_DATI_SALVATI = 6;                  // dati salvati usabili solo se coprono N ore future

/* ============================ VOCABOLARIO ============================ */
const PUNTI16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
const NOMI_VENTO = { N:"tramontana", NE:"grecale", E:"levante", SE:"scirocco",
                     S:"ostro", SO:"libeccio", O:"ponente", NO:"maestrale" };

function puntoCardinale(gradi, fine = true){
  if (gradi == null || isNaN(gradi)) return "—";
  const settori = fine ? 16 : 8;
  const g = ((gradi % 360) + 360) % 360;
  const idx = Math.round(g / (360 / settori)) % settori;
  return fine ? PUNTI16[idx] : PUNTI16[idx * 2];
}
const nomeVento = gradi => NOMI_VENTO[puntoCardinale(gradi, false)] || "";

function descrizioneBeaufort(kmh){
  if (kmh == null) return "—";
  if (kmh < 2)  return "calma di vento";
  if (kmh < 6)  return "bava di vento";
  if (kmh < 12) return "brezza leggera";
  if (kmh < 20) return "brezza tesa";
  if (kmh < 29) return "vento moderato";
  if (kmh < 39) return "vento teso";
  if (kmh < 50) return "vento fresco";
  if (kmh < 62) return "vento forte";
  if (kmh < 75) return "burrasca";
  return "burrasca forte o più";
}

function descrizioneDouglas(m){
  if (m == null) return "";
  if (m < 0.1)  return "mare calmo";
  if (m < 0.5)  return "poco mosso";
  if (m < 1.25) return "mosso";
  if (m < 2.5)  return "molto mosso";
  if (m < 4)    return "agitato";
  return "molto agitato o più";
}

function classeUV(uv){
  if (uv == null) return { colore:"#7D939E", testo:"—", consiglio:"" };
  if (uv < 3)  return { colore:"#177245", testo:"basso",      consiglio:"protezione non necessaria" };
  if (uv < 6)  return { colore:"#8A5B00", testo:"moderato",   consiglio:"crema e occhiali consigliati" };
  if (uv < 8)  return { colore:"#B85C00", testo:"alto",       consiglio:"crema, cappello, ombra nelle ore centrali" };
  if (uv < 11) return { colore:"#BF2F3A", testo:"molto alto", consiglio:"evitare il sole dalle 12 alle 16" };
  return { colore:"#7D1FA0", testo:"estremo", consiglio:"restare all'ombra, protezione massima" };
}

/* Codici WMO del campo weather_code, in parole da dire ai bagnanti. */
const CIELO = {
  0:"sereno", 1:"prevalentemente sereno", 2:"parzialmente nuvoloso", 3:"coperto",
  45:"nebbia", 48:"nebbia con brina",
  51:"pioviggine debole", 53:"pioviggine", 55:"pioviggine intensa",
  56:"pioviggine gelata", 57:"pioviggine gelata intensa",
  61:"pioggia debole", 63:"pioggia", 65:"pioggia forte",
  66:"pioggia gelata", 67:"pioggia gelata forte",
  71:"neve debole", 73:"neve", 75:"neve forte", 77:"nevischio",
  80:"rovesci deboli", 81:"rovesci", 82:"rovesci violenti",
  85:"rovesci di neve", 86:"forti rovesci di neve",
  95:"temporale", 96:"temporale con grandine", 99:"temporale con forte grandine"
};
const descrizioneCielo = codice => (codice == null ? "" : (CIELO[codice] || ""));

/* ============================ DECISIONI ============================ */
function calcolaBandiera(vento, raffica, onda){
  const S = BANDIERA_SOGLIE;
  if ((vento   != null && vento   >= S.VENTO_ROSSO_KMH) ||
      (raffica != null && raffica >= S.RAFFICA_ROSSA_KMH) ||
      (onda    != null && onda    >= S.ONDA_ROSSA_M))
    return { classe:"rossa", nome:"Bandiera rossa", significato:"Balneazione pericolosa o vietata" };
  if ((vento == null || vento < S.VENTO_VERDE_KMH) &&
      (onda  == null || onda  < S.ONDA_VERDE_M))
    return { classe:"verde", nome:"Bandiera verde", significato:"Balneazione consentita, mare tranquillo" };
  return { classe:"gialla", nome:"Bandiera gialla", significato:"Attenzione: bagno con prudenza" };
}

function trendPressione(pressioni, i){
  const j = i - PRESSIONE_ORE_CONFRONTO;
  if (!pressioni || j < 0 || pressioni[i] == null || pressioni[j] == null)
    return { simbolo:"→", classe:"stab", delta:null };
  const d = pressioni[i] - pressioni[j];
  if (d >= PRESSIONE_DELTA_HPA)  return { simbolo:"↗", classe:"su",  delta:d };
  if (d <= -PRESSIONE_DELTA_HPA) return { simbolo:"↘", classe:"giu", delta:d };
  return { simbolo:"→", classe:"stab", delta:d };
}

function classeBarraVento(v){
  if (v == null) return "";
  if (v >= BANDIERA_SOGLIE.VENTO_ROSSO_KMH) return "rossa";
  if (v >= BANDIERA_SOGLIE.VENTO_VERDE_KMH) return "gialla";
  return "verde";
}
function classeBarraPioggia(p){
  if (p == null) return "";
  if (p >= PIOGGIA_SOGLIE.ALTA)  return "pb2";
  if (p >= PIOGGIA_SOGLIE.BASSA) return "pb1";
  return "pb0";
}

/* ============================ TEMPO ============================
   I tempi Open-Meteo con timezone=auto sono stringhe locali
   "YYYY-MM-DDTHH:MM": l'ora corrente è la prima iniziata da meno di un'ora. */
function indiceOraCorrente(tempi, adesso = Date.now()){
  if (!tempi) return -1;
  for (let i = 0; i < tempi.length; i++){
    if (new Date(tempi[i]).getTime() >= adesso - 3600e3) return i;
  }
  return -1;
}
function oreFuture(tempi, adesso = Date.now()){
  const i0 = indiceOraCorrente(tempi, adesso);
  return i0 < 0 ? 0 : tempi.length - i0;
}

/* Dopo la fine della giornata utile il pannello mostra il giorno dopo. */
function giornoDaMostrare(tempi, i0){
  const oggi = tempi[i0].slice(0, 10);
  const ora = parseInt(tempi[i0].slice(11, 13), 10);
  if (ora > GIORNATA.ORA_MAX){
    const domani = tempi.find(t => t.slice(0, 10) > oggi);
    if (domani) return { giorno: domani.slice(0, 10), domani: true };
  }
  return { giorno: oggi, domani: false };
}

function puntiGiornata(tempi, giorno, serie, extra){
  const punti = [];
  for (let i = 0; i < tempi.length; i++){
    if (tempi[i].slice(0, 10) !== giorno) continue;
    const ora = parseInt(tempi[i].slice(11, 13), 10);
    if (ora < GIORNATA.ORA_MIN || ora > GIORNATA.ORA_MAX) continue;
    punti.push({ ora, i, v: serie?.[i] ?? null, extra: extra?.[i] ?? null });
  }
  return punti;
}

/* "Si alza verso le X · massimo Y km/h alle Z · cala dopo le W" */
function sintesiVento(punti){
  const validi = punti.filter(p => p.v != null);
  if (!validi.length) return "";
  const picco = validi.reduce((a, b) => (b.v > a.v ? b : a));
  if (picco.v < 12) return "Vento debole per tutta la giornata (max " + Math.round(picco.v) + " km/h).";
  const soglia = picco.v * 0.6;
  const salita = validi.find(p => p.v >= soglia);
  const calo = validi.find(p => p.ora > picco.ora && p.v < soglia);
  return "Si alza verso le " + salita.ora + " · massimo " + Math.round(picco.v) +
    " km/h alle " + picco.ora +
    (calo ? " · cala dopo le " + calo.ora + "." : " · resta sostenuto fino a sera.");
}

/* punti: v = probabilità %, extra = mm nell'ora */
function sintesiPioggia(punti){
  const validi = punti.filter(p => p.v != null);
  if (!validi.length) return "";
  const S = PIOGGIA_SOGLIE;
  const maxP = Math.max(...validi.map(p => p.v));
  if (maxP < S.BASSA) return "Nessuna pioggia significativa prevista.";
  const accumulo = validi.reduce((s, p) => s + (p.extra || 0), 0);
  const arrivo = validi.find(p => p.v >= S.ALTA);
  if (!arrivo) return "Possibili rovesci (probabilità max " + Math.round(maxP) + "%).";
  const fine = validi.find(p => p.ora > arrivo.ora && p.v < S.BASSA + 10);
  return "Pioggia probabile dalle " + arrivo.ora +
    (fine ? " · esaurimento verso le " + fine.ora : " · fino a sera") +
    (accumulo >= 0.5 ? " · accumulo ~" + Math.round(accumulo) + " mm" : "") + ".";
}

/* Temporale in corso o previsto nelle prossime ORE_ALLERTA_TEMPORALE ore. */
function cercaTemporale(codiciOrari, i0, codiceAttuale){
  if (TEMPORALE_CODICI.includes(codiceAttuale)) return { tipo:"in_corso", indice:i0 };
  if (!codiciOrari || i0 < 0) return null;
  const fine = Math.min(i0 + ORE_ALLERTA_TEMPORALE, codiciOrari.length);
  for (let i = i0; i < fine; i++){
    if (TEMPORALE_CODICI.includes(codiciOrari[i])) return { tipo:"previsto", indice:i };
  }
  return null;
}

/* ============================ DATI SALVATI ============================ */
const posizioniVicine = (a, b) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

function datiSalvatiUsabili(salvati, posizione, adesso = Date.now()){
  if (!salvati || !salvati.meteo || !salvati.meteo.hourly || !salvati.meteo.hourly.time) return false;
  if (!posizioniVicine(salvati, posizione)) return false;
  return oreFuture(salvati.meteo.hourly.time, adesso) >= ORE_MINIME_DATI_SALVATI;
}

const API = {
  BANDIERA_SOGLIE, PIOGGIA_SOGLIE, TEMPORALE_CODICI, ORE_ALLERTA_TEMPORALE, GIORNATA,
  puntoCardinale, nomeVento, descrizioneBeaufort, descrizioneDouglas, classeUV, descrizioneCielo,
  calcolaBandiera, trendPressione, classeBarraVento, classeBarraPioggia,
  indiceOraCorrente, oreFuture, giornoDaMostrare, puntiGiornata, sintesiVento, sintesiPioggia,
  cercaTemporale, posizioniVicine, datiSalvatiUsabili
};
if (typeof module === "object" && module.exports) module.exports = API;
else radice.Vedetta = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
