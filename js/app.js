/* ==========================================================================
   VEDETTA — interfaccia: rete, stato, disegno. La logica pura (soglie,
   bandiera, sintesi, allerte) sta in logica.js ed è coperta dai test.
   ========================================================================== */
"use strict";
const {
  BANDIERA_SOGLIE, puntoCardinale, nomeVento, descrizioneBeaufort, descrizioneDouglas,
  classeUV, descrizioneCielo, calcolaBandiera, trendPressione, classeBarraVento,
  classeBarraPioggia, indiceOraCorrente, giornoDaMostrare, puntiGiornata, sintesiVento,
  sintesiPioggia, cercaTemporale, posizioniVicine, datiSalvatiUsabili
} = window.Vedetta;

const POSIZIONE_DEFAULT = { lat: 42.92, lon: 10.76, nome: "Follonica" };
const REFRESH_MINUTI       = 12;     // aggiornamento automatico
const RETRY_TENTATIVI      = 3;      // dopo il primo giro fallito: 2s, 4s, 8s
const RETRY_BASE_MS        = 2000;
const ORE_GRAFICO          = 48;
const DATI_VECCHI_MINUTI   = 20;     // oltre: orario in rosso
const CURRENT_VALIDO_MINUTI = 30;    // oltre: "adesso" si ricava dalla serie oraria
const VISTE = ["previsione", "bagnino", "radar"];

/* Open-Meteo, nomenclatura attuale (snake_case). Forecast senza "models=" =
   best_match (per l'Italia ECMWF IFS + DWD ICON, GFS a riempimento). Marine:
   MFWAM / ECMWF WAM; sea_surface_temperature può essere null sotto costa. */
const PARAM_FORECAST_HOURLY = ["temperature_2m","apparent_temperature","pressure_msl",
  "surface_pressure","wind_speed_10m","wind_direction_10m","wind_gusts_10m","cloud_cover",
  "precipitation_probability","precipitation","uv_index","weather_code"].join(",");
const PARAM_FORECAST_CURRENT = ["temperature_2m","apparent_temperature","pressure_msl",
  "surface_pressure","wind_speed_10m","wind_direction_10m","wind_gusts_10m","cloud_cover",
  "precipitation","weather_code"].join(",");
const PARAM_MARINE_HOURLY = ["wave_height","wave_direction","wave_period","wind_wave_height",
  "wind_wave_direction","wind_wave_period","swell_wave_height","swell_wave_direction",
  "swell_wave_period","sea_surface_temperature"].join(",");
const PARAM_MARINE_CURRENT = ["wave_height","wave_direction","wave_period","sea_surface_temperature"].join(",");

/* 3BMeteo e IlMeteo non hanno API pubbliche leggibili dal browser (e i ToS
   vietano lo scraping): nessun confronto numerico, solo link alla fonte. */
const FONTI_SECONDA_OPINIONE = [
  { nome:"3BMeteo",   tipo:"nome",  url: n => "https://www.3bmeteo.com/meteo/" + n.toLowerCase().replace(/\s+/g, "-") },
  { nome:"IlMeteo",   tipo:"nome",  url: n => "https://www.ilmeteo.it/meteo/" + encodeURIComponent(n) },
  { nome:"MeteoAM",   tipo:"nome",  url: n => "https://www.meteoam.it/it/meteo-citta?text=" + encodeURIComponent(n), extra:"Aeronautica Militare" },
  { nome:"meteoblue", tipo:"coord", url: (lat, lon) => "https://www.meteoblue.com/it/tempo/settimana/" + lat + "N" + lon + "E" }
];

const stato = {
  lat: POSIZIONE_DEFAULT.lat, lon: POSIZIONE_DEFAULT.lon,
  nomeLuogo: POSIZIONE_DEFAULT.nome, origine: "default",   // "gps" | "manuale" | "default"
  meteo: null, marine: null, fonte: null,                    // fonte: "rete" | "salvati"
  ultimoAggiornamento: null, oraMostrata: null,
  caricamentoInCorso: false, ricaricaRichiesta: false,
  vista: "previsione"
};

/* Memoria locale con guardia: dove non c'è (navigazione privata, artifact)
   si degrada in silenzio. */
const MEMORIA = { POSIZIONE: "vedetta-pos", DATI: "vedetta-dati", VISTA: "vedetta-vista" };
function leggiMemoria(chiave){
  try { return JSON.parse(localStorage.getItem(chiave)); } catch(e){ return null; }
}
function scriviMemoria(chiave, valore){
  try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch(e){}
}

const $ = id => document.getElementById(id);
const fmtOra = iso => iso.slice(11, 16);
function fmtGiorno(iso){
  const d = new Date(iso);
  return ["dom","lun","mar","mer","gio","ven","sab"][d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
}
const num = (v, dec = 0) => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(dec);
const oraBreve = d => d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

/* ========================== RETE E DATI ========================== */
async function fetchJson(url, etichetta, tentativi){
  let errore = null;
  for (let t = 0; t < tentativi; t++){
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.reason || "errore API");
      return j;
    } catch(e){
      errore = e;
      if (t < tentativi - 1) await new Promise(res => setTimeout(res, RETRY_BASE_MS * 2 ** t));
    }
  }
  throw new Error(etichetta + ": " + (errore?.message || "rete non raggiungibile"));
}

const urlForecast = () => "https://api.open-meteo.com/v1/forecast?latitude=" + stato.lat + "&longitude=" + stato.lon +
  "&hourly=" + PARAM_FORECAST_HOURLY + "&current=" + PARAM_FORECAST_CURRENT +
  "&forecast_days=3&timezone=auto&wind_speed_unit=kmh";
const urlMarine = () => "https://marine-api.open-meteo.com/v1/marine?latitude=" + stato.lat + "&longitude=" + stato.lon +
  "&hourly=" + PARAM_MARINE_HOURLY + "&current=" + PARAM_MARINE_CURRENT +
  "&forecast_days=3&timezone=auto";

function applicaDati(meteo, marine, quando, fonte){
  stato.meteo = meteo; stato.marine = marine; stato.fonte = fonte;
  stato.ultimoAggiornamento = new Date(quando);
  renderTutto();
}

/* Avvio istantaneo e funzionamento senza rete: gli ultimi dati reali salvati
   per QUESTA posizione, finché coprono abbastanza ore future. */
function caricaDatiSalvati(){
  const salvati = leggiMemoria(MEMORIA.DATI);
  if (!datiSalvatiUsabili(salvati, stato)) return false;
  applicaDati(salvati.meteo, salvati.marine, salvati.salvato, "salvati");
  return true;
}

async function caricaDati(){
  if (stato.caricamentoInCorso){ stato.ricaricaRichiesta = true; return; }
  stato.caricamentoInCorso = true;
  $("btn-aggiorna").classList.add("gira");
  $("caricamento").hidden = !!stato.meteo;
  const pos = { lat: stato.lat, lon: stato.lon };
  try {
    // Un tentativo subito per capire se c'è rete; poi, se serve, retry con backoff.
    let [meteo, marine] = await Promise.allSettled([
      fetchJson(urlForecast(), "Open-Meteo", 1), fetchJson(urlMarine(), "Open-Meteo Marine", 1)
    ]);
    if (meteo.status === "rejected" && navigator.onLine !== false){
      [meteo, marine] = await Promise.allSettled([
        fetchJson(urlForecast(), "Open-Meteo", RETRY_TENTATIVI),
        fetchJson(urlMarine(), "Open-Meteo Marine", RETRY_TENTATIVI)
      ]);
    }
    if (meteo.status === "rejected") throw meteo.reason;
    if (!posizioniVicine(pos, stato)) return;   // la posizione è cambiata nel frattempo
    const datiMare = marine.status === "fulfilled" ? marine.value : null;
    const adesso = Date.now();
    scriviMemoria(MEMORIA.DATI, { lat: pos.lat, lon: pos.lon, salvato: adesso, meteo: meteo.value, marine: datiMare });
    applicaDati(meteo.value, datiMare, adesso, "rete");
    if (datiMare) nascondiAvvisoRete();
    else mostraAvvisoRete("giallo", "Dati del mare momentaneamente non disponibili: onde e temperatura del mare mancano fino al prossimo aggiornamento.");
  } catch(e){
    console.warn(e);
    if (stato.meteo || caricaDatiSalvati()){
      mostraAvvisoRete("giallo", "Senza rete · dati delle " + oraBreve(stato.ultimoAggiornamento) +
        ". Riprovo da solo appena torna il segnale.");
    } else {
      mostraAvvisoRete("rosso", "Nessun dato: il servizio meteo non risponde e non ci sono dati " +
        "salvati per questa posizione. Controlla la connessione.");
    }
  } finally {
    stato.caricamentoInCorso = false;
    $("btn-aggiorna").classList.remove("gira");
    $("caricamento").hidden = true;
    if (stato.ricaricaRichiesta){ stato.ricaricaRichiesta = false; caricaDati(); }
  }
}

function mostraAvvisoRete(tono, testo){
  const a = $("avviso-rete");
  a.className = "avviso " + tono;
  $("testo-avviso-rete").textContent = testo;
  a.hidden = false;
}
function nascondiAvvisoRete(){ $("avviso-rete").hidden = true; }

function testoEta(minuti){
  if (minuti < 60) return minuti + " min";
  if (minuti < 48 * 60) return Math.round(minuti / 60) + " h";
  return Math.round(minuti / 1440) + " giorni";
}
function aggiornaEtaDati(){
  const el = $("ultimo-agg");
  if (!stato.ultimoAggiornamento){ el.className = "sotto"; el.textContent = "in attesa dei dati…"; return; }
  const minuti = Math.round((Date.now() - stato.ultimoAggiornamento.getTime()) / 60000);
  const ora = oraBreve(stato.ultimoAggiornamento);
  if (minuti > DATI_VECCHI_MINUTI){
    el.className = "sotto stantio";
    el.textContent = "⚠ dati di " + testoEta(minuti) + " fa · " + ora;
  } else {
    el.className = "sotto";
    el.textContent = "aggiornato alle " + ora;
  }
}

/* ========================== VALORI ATTUALI ==========================
   Il blocco "current" vale solo se i dati sono freschi; con dati salvati
   da ore si usa la serie oraria dell'ora in corso. */
function mappaMarine(){
  const m = new Map();
  stato.marine?.hourly?.time?.forEach((t, i) => m.set(t, i));
  return m;
}
function valoreMarino(mm, tempo, campo){
  const i = mm.get(tempo);
  return i == null ? null : (stato.marine.hourly[campo]?.[i] ?? null);
}
function valoriAdesso(){
  const h = stato.meteo.hourly;
  const i0 = indiceOraCorrente(h.time);
  const fresco = Date.now() - stato.ultimoAggiornamento.getTime() < CURRENT_VALIDO_MINUTI * 60e3;
  const c = fresco ? stato.meteo.current : null;
  const cm = fresco ? stato.marine?.current : null;
  const mm = mappaMarine();
  return {
    i0,
    vento:       c?.wind_speed_10m      ?? h.wind_speed_10m[i0],
    raffica:     c?.wind_gusts_10m      ?? h.wind_gusts_10m[i0],
    direzione:   c?.wind_direction_10m  ?? h.wind_direction_10m[i0],
    temperatura: c?.temperature_2m      ?? h.temperature_2m[i0],
    percepita:   c?.apparent_temperature ?? h.apparent_temperature[i0],
    pressione:   c?.pressure_msl        ?? h.pressure_msl[i0],
    codice:      c?.weather_code        ?? h.weather_code?.[i0],
    onda:        cm?.wave_height        ?? valoreMarino(mm, h.time[i0], "wave_height"),
    mare:        cm?.sea_surface_temperature ?? valoreMarino(mm, h.time[i0], "sea_surface_temperature"),
    uv:          h.uv_index?.[i0]
  };
}

/* ============================ GRAFICI ============================
   Canvas nativo, DPR-aware, crosshair + tooltip (mouse e touch). */
const grafici = {};
const tokenCss = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

function costruisciGrafico(idTela, idTooltip, cfg){
  const tela = $(idTela), avv = tela.parentElement;
  const g = { tela, tt: $(idTooltip), cfg, dati: null, hover: null, margini: { sx:30, dx:8, alto:8, basso:18 } };
  grafici[idTela] = g;
  new ResizeObserver(() => disegnaGrafico(g)).observe(avv);
  avv.addEventListener("pointermove", e => {
    if (!g.dati) return;
    const r = tela.getBoundingClientRect();
    const fra = (e.clientX - r.left - g.margini.sx) / (r.width - g.margini.sx - g.margini.dx);
    g.hover = Math.max(0, Math.min(g.dati.tempi.length - 1, Math.round(fra * (g.dati.tempi.length - 1))));
    disegnaGrafico(g);
  });
  avv.addEventListener("pointerleave", () => { g.hover = null; disegnaGrafico(g); });
}

function disegnaGrafico(g){
  const { tela, cfg } = g;
  if (!g.dati) return;
  const dpr = window.devicePixelRatio || 1;
  const W = tela.clientWidth, H = tela.clientHeight;
  if (!W) return;   // vista nascosta: si ridisegna quando torna visibile
  if (tela.width !== W * dpr || tela.height !== H * dpr){ tela.width = W * dpr; tela.height = H * dpr; }
  const ctx = tela.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const mg = g.margini;
  const { tempi, serie, banda } = g.dati;
  const n = tempi.length;
  const colSerie = tokenCss(cfg.tokenColore), colGriglia = tokenCss("--griglia");
  const colMuto = tokenCss("--inchiostro-3"), colFilo = tokenCss("--filo-forte");

  let vmax = cfg.minMax;
  for (let i = 0; i < n; i++){
    if (serie[i] != null) vmax = Math.max(vmax, serie[i]);
    if (banda && banda[i] != null) vmax = Math.max(vmax, banda[i]);
  }
  vmax = cfg.vmaxFisso || vmax * 1.15;
  const X = i => mg.sx + (W - mg.sx - mg.dx) * (n <= 1 ? 0 : i / (n - 1));
  const Y = v => mg.alto + (H - mg.alto - mg.basso) * (1 - v / vmax);

  ctx.font = "10px " + tokenCss("--f-strumento");
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let k = 1; k <= 3; k++){
    const v = vmax / 3 * k, y = Y(v);
    ctx.strokeStyle = colGriglia; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mg.sx, y); ctx.lineTo(W - mg.dx, y); ctx.stroke();
    ctx.fillStyle = colMuto; ctx.fillText(cfg.fmtAsse(v), mg.sx - 4, y);
  }
  ctx.strokeStyle = colFilo;
  ctx.beginPath(); ctx.moveTo(mg.sx, Y(0)); ctx.lineTo(W - mg.dx, Y(0)); ctx.stroke();

  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i = 0; i < n; i++){
    const hh = tempi[i].slice(11, 13);
    if (hh === "00" || i === 0){
      ctx.strokeStyle = colFilo;
      ctx.beginPath(); ctx.moveTo(X(i), mg.alto); ctx.lineTo(X(i), H - mg.basso); ctx.stroke();
      ctx.fillStyle = colMuto; ctx.fillText(i === 0 ? "ora" : fmtGiorno(tempi[i]), X(i) + 2, H - mg.basso + 4);
    } else if (["06","12","18"].includes(hh)){
      ctx.fillStyle = colMuto; ctx.fillText(hh, X(i), H - mg.basso + 4);
    }
  }

  for (const s of cfg.soglie || []){
    if (s.v >= vmax) continue;
    ctx.strokeStyle = tokenCss(s.token); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(mg.sx, Y(s.v)); ctx.lineTo(W - mg.dx, Y(s.v)); ctx.stroke();
    ctx.setLineDash([]);
  }

  if (banda){
    ctx.beginPath();
    let inizio = true;
    for (let i = 0; i < n; i++){
      if (serie[i] == null || banda[i] == null) continue;
      if (inizio){ ctx.moveTo(X(i), Y(banda[i])); inizio = false; } else ctx.lineTo(X(i), Y(banda[i]));
    }
    for (let i = n - 1; i >= 0; i--){
      if (serie[i] == null || banda[i] == null) continue;
      ctx.lineTo(X(i), Y(serie[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colSerie; ctx.globalAlpha = .18; ctx.fill(); ctx.globalAlpha = 1;
  }
  if (cfg.areaBase){
    ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let i = 0; i < n; i++){ if (serie[i] != null) ctx.lineTo(X(i), Y(serie[i])); }
    ctx.lineTo(X(n - 1), Y(0)); ctx.closePath();
    ctx.fillStyle = colSerie; ctx.globalAlpha = .13; ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = colSerie; ctx.lineWidth = 2; ctx.lineJoin = "round";
  ctx.beginPath();
  let inizio = true;
  for (let i = 0; i < n; i++){
    if (serie[i] == null) continue;
    if (inizio){ ctx.moveTo(X(i), Y(serie[i])); inizio = false; } else ctx.lineTo(X(i), Y(serie[i]));
  }
  ctx.stroke();
  if (serie[n - 1] != null){
    ctx.fillStyle = colSerie;
    ctx.beginPath(); ctx.arc(X(n - 1), Y(serie[n - 1]), 3.5, 0, 7); ctx.fill();
  }

  if (g.hover != null && serie[g.hover] != null){
    const i = g.hover, x = X(i);
    ctx.strokeStyle = colMuto; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, mg.alto); ctx.lineTo(x, H - mg.basso); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colSerie; ctx.beginPath(); ctx.arc(x, Y(serie[i]), 4, 0, 7); ctx.fill();
    ctx.strokeStyle = tokenCss("--superficie"); ctx.lineWidth = 2; ctx.stroke();
    g.tt.innerHTML = '<span class="tt-ora">' + fmtGiorno(tempi[i]) + " " + fmtOra(tempi[i]) +
      "</span><br>" + cfg.fmtTooltip(i, g.dati);
    g.tt.style.display = "block";
    const largTT = g.tt.offsetWidth;
    g.tt.style.left = Math.max(0, Math.min(W - largTT, x - largTT / 2)) + "px";
    g.tt.style.top = "-6px";
  } else {
    g.tt.style.display = "none";
  }
}

function aggiornaGrafici(){
  const h = stato.meteo.hourly;
  const i0 = indiceOraCorrente(h.time);
  const fine = Math.min(i0 + ORE_GRAFICO, h.time.length);
  const tempi = h.time.slice(i0, fine);
  const mm = mappaMarine();
  grafici["tela-vento"].dati = { tempi, serie: h.wind_speed_10m.slice(i0, fine), banda: h.wind_gusts_10m.slice(i0, fine) };
  grafici["tela-onda"].dati = { tempi, serie: tempi.map(t => valoreMarino(mm, t, "wave_height")) };
  grafici["tela-pioggia"].dati = { tempi,
    serie: (h.precipitation_probability || []).slice(i0, fine),
    mmOra: (h.precipitation || []).slice(i0, fine) };
  Object.values(grafici).forEach(disegnaGrafico);
}

/* ============================ RENDER ============================ */
function frecciaVento(gradi){
  if (gradi == null) return "—";
  return '<span class="freccia-nav" style="transform:rotate(' + ((gradi + 180) % 360) +
    'deg)" title="' + Math.round(gradi) + '° (da ' + puntoCardinale(gradi) + ')">↑</span>';
}

function renderAdesso(a){
  const b = calcolaBandiera(a.vento, a.raffica, a.onda);
  const cost = $("costola-bandiera");
  cost.className = "bandiera-costola " + b.classe;
  cost.textContent = b.classe;
  const nv = nomeVento(a.direzione);
  $("ad-vento").innerHTML = frecciaVento(a.direzione) + " " + num(a.vento) + " <small>km/h</small>";
  $("ad-vento-desc").textContent = "raffiche " + num(a.raffica) + " · " + descrizioneBeaufort(a.vento) +
    " da " + puntoCardinale(a.direzione) + (nv ? " (" + nv + ")" : "");
  $("ad-onda").innerHTML = (a.onda != null ? num(a.onda, 1) : "—") + " <small>m</small>";
  $("ad-onda-desc").textContent = a.onda != null ? descrizioneDouglas(a.onda) : "dato del mare non disponibile";
  $("ad-aria").innerHTML = num(a.temperatura) + "<small>°C</small>";
  const cielo = descrizioneCielo(a.codice);
  $("ad-aria-desc").textContent = "percepita " + num(a.percepita) + "°" + (cielo ? " · " + cielo : "");
  $("ad-mare").innerHTML = a.mare != null ? num(a.mare, 1) + "<small>°C</small>" : "n.d.";
  const tp = trendPressione(stato.meteo.hourly.pressure_msl, a.i0);
  $("ad-pressione").innerHTML = num(a.pressione, 1) + " <small>hPa</small>";
  $("ad-press-trend").innerHTML = '<span class="trend ' + tp.classe + '">' + tp.simbolo + "</span> " +
    (tp.delta == null ? "tendenza n.d." : (tp.delta >= 0 ? "+" : "") + tp.delta.toFixed(1) + " hPa in 3 h");
  const uv = classeUV(a.uv);
  $("ad-uv").innerHTML = '<span class="uv-tacca" style="background:' + uv.colore + '"></span>' + num(a.uv);
  $("ad-uv-desc").textContent = uv.testo + (uv.consiglio ? " · " + uv.consiglio : "");
}

function renderProssime(i0){
  const h = stato.meteo.hourly, mm = mappaMarine();
  let html = "";
  for (let k = 0; k < 6 && i0 + k < h.time.length; k++){
    const i = i0 + k;
    const onda = valoreMarino(mm, h.time[i], "wave_height");
    html += '<div class="ora-card"><div class="h">' + fmtOra(h.time[i]) + "</div>" +
      '<div class="t">' + num(h.temperature_2m[i]) + "°</div>" +
      '<div class="cielo">' + descrizioneCielo(h.weather_code?.[i]) + "</div>" +
      '<div class="vr">' + frecciaVento(h.wind_direction_10m[i]) + " " + num(h.wind_speed_10m[i]) + " km/h</div>" +
      (onda != null ? '<div class="on">' + num(onda, 1) + " m</div>" : "") +
      "<div>☂ " + num(h.precipitation_probability?.[i]) + "%</div></div>";
  }
  $("prossime-ore").innerHTML = html;
}

function renderTabella(i0){
  const h = stato.meteo.hourly, mm = mappaMarine();
  const fine = Math.min(i0 + 72, h.time.length);
  let html = "", giorno = "";
  for (let i = i0; i < fine; i++){
    if (h.time[i].slice(0, 10) !== giorno){
      giorno = h.time[i].slice(0, 10);
      html += '<tr class="riga-giorno"><td colspan="12">' + fmtGiorno(h.time[i]) + "</td></tr>";
    }
    const tp = trendPressione(h.pressure_msl, i);
    const onda = valoreMarino(mm, h.time[i], "wave_height");
    const swD = valoreMarino(mm, h.time[i], "swell_wave_direction");
    const swH = valoreMarino(mm, h.time[i], "swell_wave_height");
    const uv = classeUV(h.uv_index?.[i]);
    html += '<tr class="' + (i === i0 ? "riga-attuale" : "") + '">' +
      "<td>" + fmtOra(h.time[i]) + "</td>" +
      "<td>" + num(h.temperature_2m[i]) + "°</td>" +
      "<td>" + num(h.apparent_temperature[i]) + "°</td>" +
      "<td>" + num(h.pressure_msl[i]) + "</td>" +
      '<td><span class="trend ' + tp.classe + '">' + tp.simbolo + "</span></td>" +
      "<td>" + frecciaVento(h.wind_direction_10m[i]) + " " + puntoCardinale(h.wind_direction_10m[i]) + " " + num(h.wind_speed_10m[i]) + "</td>" +
      "<td>" + num(h.wind_gusts_10m[i]) + "</td>" +
      "<td>" + (onda != null ? num(onda, 1) : "—") + "</td>" +
      "<td>" + (swD != null ? frecciaVento(swD) + " " + puntoCardinale(swD) + (swH != null ? " " + num(swH, 1) : "") : "—") + "</td>" +
      "<td>" + num(h.precipitation_probability?.[i]) + "</td>" +
      "<td>" + num(h.precipitation?.[i], 1) + "</td>" +
      '<td><span class="uv-chip" style="background:' + uv.colore + '">' + num(h.uv_index?.[i]) + "</span></td></tr>";
  }
  $("corpo-tabella").innerHTML = html;
}

function renderPubblico(a){
  const b = calcolaBandiera(a.vento, a.raffica, a.onda);
  $("pp-bandiera").className = "pp-bandiera " + b.classe;
  $("pp-nome").textContent = b.nome;
  $("pp-significato").textContent = b.significato;
  $("pp-temp").textContent = num(a.temperatura) + "°";
  $("pp-cielo").textContent = descrizioneCielo(a.codice);
  $("pp-mare").textContent = a.mare != null ? num(a.mare) + "°" : "n.d.";
  const uv = classeUV(a.uv);
  $("pp-uv").textContent = num(a.uv);
  $("pp-uv-consiglio").textContent = a.uv != null ? uv.testo + " — " + uv.consiglio : "";
  $("pp-onde").textContent = a.onda != null ? num(a.onda, 1) + " m" : "n.d.";
  $("pp-onde-desc").textContent = descrizioneDouglas(a.onda);
  const nv = nomeVento(a.direzione);
  $("pp-vento").textContent = descrizioneBeaufort(a.vento) + " da " + puntoCardinale(a.direzione, false) +
    (nv ? " (" + nv + ")" : "") + " · " + num(a.vento) + " km/h";
  $("pp-agg").textContent = oraBreve(stato.ultimoAggiornamento);
}

/* Barre orarie 6–21 del pannello Bagnino: stesso disegno per vento e pioggia. */
function renderGiornata(prefisso, titoloOggi, titoloDomani, serie, extra, classeBarra, altezza, sintesi){
  const h = stato.meteo.hourly;
  const i0 = indiceOraCorrente(h.time);
  const { giorno, domani } = giornoDaMostrare(h.time, i0);
  $(prefisso + "-titolo").textContent = domani ? titoloDomani : titoloOggi;
  const punti = puntiGiornata(h.time, giorno, serie, extra);
  $(prefisso + "-barre").innerHTML = punti.map(p =>
    '<div class="b ' + classeBarra(p.v) + (p.i === i0 ? " ora" : "") +
    '" style="height:' + Math.max(5, Math.min(100, altezza(p.v))) + '%"></div>').join("");
  $(prefisso + "-ore").innerHTML = punti.map(p => "<span>" + (p.ora % 3 === 0 ? p.ora : "") + "</span>").join("");
  $(prefisso + "-sintesi").textContent = sintesi(punti);
}

/* Temporale = fulmini = uscita dall'acqua: banner visibile in tutte le viste. */
function controllaTemporale(a){
  const banner = $("allerta-temporale");
  const h = stato.meteo.hourly;
  const t = cercaTemporale(h.weather_code, a.i0, a.codice);
  if (!t){ banner.hidden = true; return; }
  if (t.tipo === "in_corso"){
    banner.innerHTML = "⚡ Temporale in corso o imminente" +
      "<small>Rischio fulmini: far uscire i bagnanti dall'acqua e liberare la battigia</small>";
  } else {
    const altroGiorno = h.time[t.indice].slice(0, 10) !== h.time[a.i0].slice(0, 10);
    banner.innerHTML = "⚡ Temporale previsto verso le " + fmtOra(h.time[t.indice]) + (altroGiorno ? " di domani" : "") +
      "<small>Rischio fulmini: prepararsi a far uscire i bagnanti dall'acqua</small>";
  }
  banner.hidden = false;
}

function aggiornaLinkFonti(){
  const nomeReale = stato.origine !== "gps" && stato.nomeLuogo !== "punto personalizzato";
  const nome = nomeReale ? stato.nomeLuogo : POSIZIONE_DEFAULT.nome;
  $("fonti-chips").innerHTML = FONTI_SECONDA_OPINIONE.map(f => {
    const url = f.tipo === "coord" ? f.url(stato.lat, stato.lon) : f.url(nome);
    const sotto = f.tipo === "coord" ? "coordinate esatte" : (f.extra || nome);
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + f.nome + "<small>" + esc(sotto) + "</small></a>";
  }).join("");
}

function renderTutto(){
  if (!stato.meteo) return;
  const a = valoriAdesso();
  if (a.i0 < 0){
    document.body.dataset.stato = "vuoto";
    mostraAvvisoRete("rosso", "I dati disponibili sono scaduti: serve la rete per scaricarne di nuovi.");
    return;
  }
  document.body.dataset.stato = "pronto";
  stato.oraMostrata = stato.meteo.hourly.time[a.i0];
  renderAdesso(a);
  renderProssime(a.i0);
  aggiornaGrafici();
  renderTabella(a.i0);
  renderPubblico(a);
  const h = stato.meteo.hourly;
  renderGiornata("pp-vento", "Vento nella giornata (6–21)", "Vento domani (6–21)",
    h.wind_speed_10m, null, classeBarraVento, v => (v ?? 0) / 45 * 100, sintesiVento);
  renderGiornata("pp-pioggia", "Pioggia nella giornata (6–21)", "Pioggia domani (6–21)",
    h.precipitation_probability, h.precipitation, classeBarraPioggia, p => p ?? 0, sintesiPioggia);
  controllaTemporale(a);
  aggiornaEtaDati();
}

/* ============================ RADAR ============================
   Caricato solo quando si apre la vista: niente traffico inutile. */
let urlRadarCorrente = "";
function aggiornaRadar(){
  if (stato.vista !== "radar") return;
  const offline = navigator.onLine === false;
  $("radar-offline").hidden = !offline;
  $("radar-frame").hidden = offline;
  if (offline) return;
  const url = "https://www.rainviewer.com/map.html?loc=" + stato.lat + "," + stato.lon +
    ",8&oCS=1&c=3&o=83&lm=1&layer=radar&sm=1&sn=1";
  if (url !== urlRadarCorrente){ urlRadarCorrente = url; $("radar-frame").src = url; }
}

/* ============================ VISTE ============================ */
function mostraVista(nome){
  if (!VISTE.includes(nome)) nome = "previsione";
  stato.vista = nome;
  scriviMemoria(MEMORIA.VISTA, nome);
  for (const v of VISTE){
    const attiva = v === nome;
    $("vista-" + v).hidden = !attiva;
    const tab = $("tab-" + v);
    tab.setAttribute("aria-selected", attiva);
    tab.tabIndex = attiva ? 0 : -1;
  }
  if (nome === "radar") aggiornaRadar();
  if (nome === "previsione" && stato.meteo && document.body.dataset.stato === "pronto") aggiornaGrafici();
  window.scrollTo({ top: 0 });
}

/* ============================ POSIZIONE ============================ */
function aggiornaPosizioneUI(){
  $("nome-luogo").textContent = stato.origine === "gps" ? "Posizione GPS" : stato.nomeLuogo;
  $("btn-posizione").classList.toggle("default", stato.origine === "default");
  $("avviso-posizione").hidden = stato.origine !== "default";
  $("dlg-coord").textContent = stato.lat.toFixed(4) + ", " + stato.lon.toFixed(4) +
    (stato.origine === "default" ? " · posizione di default" : "");
  aggiornaLinkFonti();
}

function impostaPosizione(lat, lon, nome, origine){
  const nuova = { lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4) };
  const cambiata = !posizioniVicine(nuova, stato);
  stato.lat = nuova.lat; stato.lon = nuova.lon;
  stato.nomeLuogo = nome; stato.origine = origine;
  scriviMemoria(MEMORIA.POSIZIONE, { lat: stato.lat, lon: stato.lon, nome, origine });
  aggiornaPosizioneUI();
  if (cambiata){
    // Mai mostrare i numeri di un altro posto con il nome di questo.
    stato.meteo = null; stato.marine = null; stato.ultimoAggiornamento = null;
    document.body.dataset.stato = "vuoto";
    $("allerta-temporale").hidden = true;
    aggiornaEtaDati();
    caricaDatiSalvati();
  }
  aggiornaRadar();
  caricaDati();
}

function richiediGPS(){
  if (!("geolocation" in navigator)){
    $("testo-avviso-posizione").textContent = "Il GPS non è disponibile su questo dispositivo: imposta la posizione a mano.";
    $("avviso-posizione").hidden = false;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const nuova = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!posizioniVicine(nuova, stato) || stato.origine !== "gps")
        impostaPosizione(nuova.lat, nuova.lon, "posizione attuale", "gps");
    },
    err => {
      if (err.code === err.PERMISSION_DENIED && stato.origine === "default"){
        $("testo-avviso-posizione").textContent =
          "Permesso GPS negato: uso Follonica. Imposta le coordinate esatte dello stabilimento.";
        $("avviso-posizione").hidden = false;
      }
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}

let timerRicerca = null;
async function cercaLuogo(testo){
  const ul = $("risultati-ricerca");
  if (testo.trim().length < 2){ ul.innerHTML = ""; return; }
  try {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(testo) + "&count=5&language=it&format=json");
    const j = await r.json();
    ul.innerHTML = (j.results || []).map(x =>
      '<li data-lat="' + x.latitude + '" data-lon="' + x.longitude + '" data-nome="' + esc(x.name) + '">' +
      esc(x.name) + (x.admin1 ? ", " + esc(x.admin1) : "") + "</li>"
    ).join("") || "<li>Nessun risultato</li>";
  } catch(e){ ul.innerHTML = "<li>Ricerca non disponibile senza rete</li>"; }
}

/* ============================ EVENTI ============================ */
document.querySelectorAll(".barra-viste [role=tab]").forEach(tab => {
  tab.addEventListener("click", () => mostraVista(tab.dataset.vista));
  tab.addEventListener("keydown", e => {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!passo) return;
    const nuova = VISTE[(VISTE.indexOf(stato.vista) + passo + VISTE.length) % VISTE.length];
    mostraVista(nuova);
    $("tab-" + nuova).focus();
  });
});
$("btn-aggiorna").addEventListener("click", () => caricaDati());
$("btn-riprova").addEventListener("click", () => caricaDati());

const apriDialogPosizione = () => {
  $("inp-lat").value = stato.lat; $("inp-lon").value = stato.lon;
  $("dlg-posizione").showModal();
};
$("btn-posizione").addEventListener("click", apriDialogPosizione);
$("btn-imposta-posizione").addEventListener("click", apriDialogPosizione);
$("dlg-chiudi").addEventListener("click", () => $("dlg-posizione").close());
$("chip-gps").addEventListener("click", () => { $("dlg-posizione").close(); richiediGPS(); });
$("chip-follonica").addEventListener("click", () => {
  $("dlg-posizione").close();
  impostaPosizione(POSIZIONE_DEFAULT.lat, POSIZIONE_DEFAULT.lon, POSIZIONE_DEFAULT.nome, "manuale");
});
$("dlg-salva").addEventListener("click", () => {
  const lat = parseFloat($("inp-lat").value.replace(",", "."));
  const lon = parseFloat($("inp-lon").value.replace(",", "."));
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180){
    $("inp-lat").setCustomValidity("Coordinate non valide");
    $("inp-lat").reportValidity();
    $("inp-lat").setCustomValidity("");
    return;
  }
  $("dlg-posizione").close();
  impostaPosizione(lat, lon, "punto personalizzato", "manuale");
});
$("cerca-luogo").addEventListener("input", e => {
  clearTimeout(timerRicerca);
  timerRicerca = setTimeout(() => cercaLuogo(e.target.value), 350);
});
$("risultati-ricerca").addEventListener("click", e => {
  const li = e.target.closest("li[data-lat]");
  if (!li) return;
  $("risultati-ricerca").innerHTML = "";
  $("cerca-luogo").value = "";
  $("dlg-posizione").close();
  impostaPosizione(li.dataset.lat, li.dataset.lon, li.dataset.nome, "manuale");
});

addEventListener("online", () => { aggiornaRadar(); caricaDati(); });
addEventListener("offline", aggiornaRadar);
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (document.body.dataset.stato === "pronto") aggiornaGrafici();
});

/* ============================ AVVIO ============================ */
costruisciGrafico("tela-vento", "tt-vento", {
  tokenColore:"--serie-vento", minMax:30,
  soglie:[{ v:BANDIERA_SOGLIE.VENTO_VERDE_KMH, token:"--giallo" }, { v:BANDIERA_SOGLIE.VENTO_ROSSO_KMH, token:"--rosso" }],
  fmtAsse: v => Math.round(v),
  fmtTooltip: (i, d) => "vento " + num(d.serie[i]) + " km/h · raffica " + num(d.banda[i]) + " km/h"
});
costruisciGrafico("tela-onda", "tt-onda", {
  tokenColore:"--serie-onda", minMax:0.6, areaBase:true,
  soglie:[{ v:BANDIERA_SOGLIE.ONDA_VERDE_M, token:"--giallo" }, { v:BANDIERA_SOGLIE.ONDA_ROSSA_M, token:"--rosso" }],
  fmtAsse: v => v.toFixed(1),
  fmtTooltip: (i, d) => "onda " + num(d.serie[i], 2) + " m · " + descrizioneDouglas(d.serie[i])
});
costruisciGrafico("tela-pioggia", "tt-pioggia", {
  tokenColore:"--serie-pioggia", minMax:100, vmaxFisso:100, areaBase:true,
  fmtAsse: v => Math.round(v),
  fmtTooltip: (i, d) => "probabilità " + num(d.serie[i]) + "% · " + num(d.mmOra?.[i], 1) + " mm/h"
});

const posSalvata = leggiMemoria(MEMORIA.POSIZIONE);
if (posSalvata && isFinite(posSalvata.lat) && isFinite(posSalvata.lon)){
  stato.lat = posSalvata.lat; stato.lon = posSalvata.lon;
  stato.nomeLuogo = posSalvata.nome || "posizione salvata";
  stato.origine = posSalvata.origine || "manuale";
}
aggiornaPosizioneUI();
mostraVista(leggiMemoria(MEMORIA.VISTA) || "previsione");
caricaDatiSalvati();              // a schermo subito, prima ancora della rete
caricaDati();
if (!posSalvata) richiediGPS();   // solo alla prima apertura in assoluto

setInterval(caricaDati, REFRESH_MINUTI * 60e3);
setInterval(() => {               // ogni minuto: età dei dati e cambio d'ora
  aggiornaEtaDati();
  if (stato.meteo && stato.meteo.hourly.time[indiceOraCorrente(stato.meteo.hourly.time)] !== stato.oraMostrata) renderTutto();
}, 60e3);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")){
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
