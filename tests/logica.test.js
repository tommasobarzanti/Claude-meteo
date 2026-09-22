/* Test della logica con responsabilità di sicurezza: bandiera, sintesi,
   allerta temporale, validità dei dati salvati. Solo moduli Node standard:
   si lanciano con  node --test tests/  (o  npm test). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/logica.js");
const { generaFixture, isoLocale } = require("./fixture.js");

const S = V.BANDIERA_SOGLIE;

test("bandiera verde solo con vento E onda sotto le soglie verdi", () => {
  assert.equal(V.calcolaBandiera(10, 15, 0.3).classe, "verde");
  assert.equal(V.calcolaBandiera(S.VENTO_VERDE_KMH, 25, 0.3).classe, "gialla");
  assert.equal(V.calcolaBandiera(10, 15, S.ONDA_VERDE_M).classe, "gialla");
});

test("bandiera rossa se vento, raffica o onda superano le soglie rosse", () => {
  assert.equal(V.calcolaBandiera(S.VENTO_ROSSO_KMH, 40, 0.3).classe, "rossa");
  assert.equal(V.calcolaBandiera(15, S.RAFFICA_ROSSA_KMH, 0.3).classe, "rossa");
  assert.equal(V.calcolaBandiera(10, 15, S.ONDA_ROSSA_M).classe, "rossa");
  assert.equal(V.calcolaBandiera(S.VENTO_ROSSO_KMH - 0.1, S.RAFFICA_ROSSA_KMH - 0.1, S.ONDA_ROSSA_M - 0.01).classe, "gialla");
});

test("bandiera con dati mancanti: l'onda assente non blocca il vento", () => {
  assert.equal(V.calcolaBandiera(10, 15, null).classe, "verde");
  assert.equal(V.calcolaBandiera(45, null, null).classe, "rossa");
});

test("punti cardinali e nomi dei venti", () => {
  assert.equal(V.puntoCardinale(0), "N");
  assert.equal(V.puntoCardinale(359), "N");
  assert.equal(V.puntoCardinale(225), "SO");
  assert.equal(V.puntoCardinale(-45), "NO");
  assert.equal(V.puntoCardinale(null), "—");
  assert.equal(V.nomeVento(315), "maestrale");
  assert.equal(V.nomeVento(135), "scirocco");
});

test("scale Beaufort e Douglas ai bordi", () => {
  assert.equal(V.descrizioneBeaufort(11.9), "brezza leggera");
  assert.equal(V.descrizioneBeaufort(12), "brezza tesa");
  assert.equal(V.descrizioneDouglas(0.49), "poco mosso");
  assert.equal(V.descrizioneDouglas(0.5), "mosso");
});

test("cielo in parole dai codici WMO", () => {
  assert.equal(V.descrizioneCielo(0), "sereno");
  assert.equal(V.descrizioneCielo(81), "rovesci");
  assert.equal(V.descrizioneCielo(95), "temporale");
  assert.equal(V.descrizioneCielo(12345), "");
  assert.equal(V.descrizioneCielo(null), "");
});

test("tendenza pressione su 3 ore", () => {
  assert.equal(V.trendPressione([1010, 1010, 1010, 1012], 3).classe, "su");
  assert.equal(V.trendPressione([1012, 1012, 1012, 1010.5], 3).classe, "giu");
  assert.equal(V.trendPressione([1012, 1012, 1012, 1012.4], 3).classe, "stab");
  assert.equal(V.trendPressione([1012, 1012], 1).delta, null);
});

test("ora corrente: -1 quando tutti i dati sono nel passato", () => {
  const adesso = new Date(2026, 6, 10, 14, 30);
  const tempi = [];
  for (let h = 0; h < 24; h++) tempi.push(isoLocale(new Date(2026, 6, 10, h)));
  assert.equal(V.indiceOraCorrente(tempi, adesso.getTime()), 14);
  assert.equal(V.indiceOraCorrente(tempi, new Date(2026, 6, 12).getTime()), -1);
  assert.equal(V.oreFuture(tempi, adesso.getTime()), 10);
});

test("dopo le 21 il pannello passa a domani", () => {
  const f = generaFixture(new Date(2026, 6, 10, 22, 10)).meteo.hourly.time;
  const r = V.giornoDaMostrare(f, 22);
  assert.equal(r.domani, true);
  assert.equal(r.giorno, "2026-07-11");
  assert.equal(V.giornoDaMostrare(f, 10).domani, false);
});

test("sintesi vento: salita, picco e calo", () => {
  const punti = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(ora =>
    ({ ora, v: ora >= 12 && ora <= 16 ? 25 : 8 }));
  assert.equal(V.sintesiVento(punti), "Si alza verso le 12 · massimo 25 km/h alle 12 · cala dopo le 17.");
  assert.match(V.sintesiVento(punti.map(p => ({ ...p, v: 5 }))), /Vento debole/);
  assert.equal(V.sintesiVento([]), "");
});

test("sintesi pioggia: arrivo, esaurimento e accumulo", () => {
  const punti = [10,11,12,13,14,15,16,17,18,19].map(ora =>
    ({ ora, v: ora >= 13 && ora <= 16 ? 70 : 5, extra: ora >= 13 && ora <= 16 ? 2 : 0 }));
  assert.equal(V.sintesiPioggia(punti), "Pioggia probabile dalle 13 · esaurimento verso le 17 · accumulo ~8 mm.");
  assert.equal(V.sintesiPioggia(punti.map(p => ({ ...p, v: 5 }))), "Nessuna pioggia significativa prevista.");
  assert.match(V.sintesiPioggia(punti.map(p => ({ ...p, v: 35 }))), /Possibili rovesci/);
});

test("allerta temporale: in corso, prevista entro la finestra, oltre la finestra", () => {
  const codici = new Array(48).fill(1);
  assert.equal(V.cercaTemporale(codici, 0, 95).tipo, "in_corso");
  codici[5] = 96;
  assert.deepEqual(V.cercaTemporale(codici, 0, 1), { tipo:"previsto", indice:5 });
  codici[5] = 1; codici[V.ORE_ALLERTA_TEMPORALE + 2] = 95;
  assert.equal(V.cercaTemporale(codici, 0, 1), null);
});

test("dati salvati: stessa posizione e abbastanza ore future", () => {
  const adesso = new Date(2026, 6, 10, 9, 0);
  const { meteo } = generaFixture(adesso);
  const salvati = { lat: 42.92, lon: 10.76, meteo };
  assert.equal(V.datiSalvatiUsabili(salvati, { lat: 42.921, lon: 10.759 }, adesso.getTime()), true);
  assert.equal(V.datiSalvatiUsabili(salvati, { lat: 42.76, lon: 10.88 }, adesso.getTime()), false);
  const troppoTardi = new Date(2026, 6, 12, 20, 0).getTime();
  assert.equal(V.datiSalvatiUsabili(salvati, { lat: 42.92, lon: 10.76 }, troppoTardi), false);
  assert.equal(V.datiSalvatiUsabili(null, { lat: 42.92, lon: 10.76 }), false);
});
