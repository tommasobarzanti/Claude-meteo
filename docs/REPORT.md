# Vedetta — Report tecnico

**Progetto:** console meteo-mare per Assistenti Bagnanti · Follonica (GR)
**Data report:** 22 settembre 2026 · **Versione:** v4 (app installabile)
**Produzione:** https://tommasobarzanti.github.io/Claude-meteo/
**Repository:** github.com/tommasobarzanti/Claude-meteo

---

## 1. Sintesi

La v4 è il primo passo della ristrutturazione di fine stagione. Il prodotto
non cambia direzione (l'uso reale l'ha validata); cambia il contenitore:

- da un file unico di 1.750 righe a **file separati** con la logica pura
  isolata e **coperta da test automatici** che bloccano il deploy se falliscono;
- da pagina web ad **app installabile** (PWA) che si apre e mostra gli ultimi
  dati reali **anche senza rete**;
- **design da app**: barra delle viste in basso, testata compatta, radar a
  schermo intero, cielo descritto a parole;
- **pulizia**: via modalità demo, modulo SIR, fonte Tomorrow.io, selettore tema.

## 2. Architettura

```
index.html              solo struttura: testata, 3 viste, barra, dialog posizione
css/vedetta.css         token colore chiaro/scuro (segue il telefono), layout app
js/logica.js            logica pura: soglie in cima, bandiera, sintesi, allerte,
                        validità dati salvati. Nessun DOM, nessuna rete → testabile
js/app.js               rete (retry/backoff), stato, grafici canvas, viste, posizione
sw.js                   service worker: file dell'app disponibili offline
manifest.webmanifest    nome, icone, colori dell'app installata
icons/                  icona (SVG sorgente + PNG 180/192/512 + maskable)
tests/logica.test.js    13 test (node:test, zero dipendenze)
tests/fixture.js        dati di prova con la forma delle risposte Open-Meteo
```

Ancora **nessun framework e nessun build step**: script classici (funzionano
anche aprendo il file dal disco), deploy = copia dei file. Il workflow
pubblica solo i file dell'app, non test e documentazione.

## 3. Funzionamento senza rete

Due livelli, volutamente separati:

1. **L'app** (HTML/CSS/JS/icone) la tiene il service worker, con strategia
   "prima la rete": online si vede sempre l'ultima versione pubblicata.
2. **I dati** li salva l'app a ogni aggiornamento riuscito (ultima posizione).
   All'apertura compaiono **subito**, prima ancora della rete; se la rete
   manca restano a schermo con l'avviso "Senza rete · dati delle HH:MM" e
   l'orario in testata diventa rosso oltre i 20 minuti.

Regole di sicurezza (coperte da test): i dati salvati valgono solo per la
**stessa posizione** e solo se coprono ancora **almeno 6 ore future**; con
dati non freschi il blocco "adesso" si ricava dall'ora in corso della serie
oraria, non dal valore istantaneo di ore prima; cambiando posizione i numeri
del posto precedente spariscono subito. La modalità demo non esiste più:
senza rete e senza dati salvati l'app lo dice e non mostra numeri.

## 4. Design da app — valutazione e interventi

| Problema (v3.2 usata come app) | Intervento v4 |
|---|---|
| Testata alta ~170 px: 20% dello schermo perso, sempre | Testata di 58 px: marchio + orario dati, luogo, aggiorna |
| Schede in alto, lontane dal pollice | **Barra delle viste in basso** (Previsione / Bagnino / Radar), bersagli ≥ 48 px; su schermi larghi diventa un controllo a segmenti |
| Radar come card a metà pagina, alto 62% della larghezza | Vista dedicata **a tutta altezza**; caricato solo quando la apri (niente traffico inutile) |
| Coordinate e due "pillole" di stato sempre visibili | Un solo chip con il nome del luogo; coordinate nel dialog; avviso giallo solo se la posizione è quella di default |
| Registro 72 h sempre aperto: pagina lunghissima | Chiuso di default, si apre con un tocco |
| Il cielo non era mai detto a parole | "sereno", "rovesci", "temporale"… nel blocco Adesso, nelle prossime ore e nel pannello Bagnino |
| Selettore tema manuale | Segue il telefono; il pannello Bagnino resta sempre chiaro per il sole |
| Nessuna icona né comportamento da app | Icona dedicata (bandiera tra le onde, versione maskable per Android), colore barra di stato, margini per notch e barra home |

Ordine della vista Previsione pensato per il primo colpo d'occhio: allerta
temporale → Adesso (bandiera + 6 strumenti) → Prossime 6 ore → grafici 48 h.
Su un telefono da 6,1" Adesso e la prima fila delle prossime ore stanno nel
primo schermo senza scorrere.

**Scelte volutamente non fatte:** app nativa sugli store (costo di sviluppo e
revisione non giustificato: la PWA si installa dalla home e funziona offline);
pull-to-refresh (conflitti con lo scroll e con la mappa radar; c'è il tasto e
l'aggiornamento automatico ogni 12 minuti).

## 5. Fonti dati

| Fonte | Uso | Note |
|---|---|---|
| Open-Meteo Forecast (`best_match`) | previsione 72 h | ECMWF IFS + DWD ICON, GFS a riempimento |
| Open-Meteo Marine | onde, swell, T mare | MFWAM / ECMWF WAM |
| RainViewer (embed) | vista Radar | radar osservato + tendenza a brevissimo termine |
| Open-Meteo Geocoding | ricerca luogo | |
| 3BMeteo, IlMeteo, MeteoAM, meteoblue | "Seconda opinione": solo link | nessuna API pubblica leggibile dal browser |

**Licenze, da risolvere prima di vendere:** l'API gratuita di Open-Meteo è solo
per uso non commerciale (piano commerciale da ~29 €/mese); GitHub Pages non è
pensato per prodotti commerciali (Cloudflare Pages/Netlify, ~0 €).

## 6. Qualità e test

**Automatici (bloccano il deploy):** 13 test su bandiera e soglie ai bordi,
dati mancanti, punti cardinali, scale Beaufort/Douglas, cielo WMO, tendenza
pressione, ora corrente con dati scaduti, passaggio a "domani" dopo le 21,
sintesi vento e pioggia, allerta temporale (in corso / entro 12 h / oltre),
validità dei dati salvati (posizione e ore residue).

**Manuali in Chromium, a ogni rilascio:** telefono chiaro e scuro, desktop, tre
viste, dialog posizione, service worker attivo, riapertura **offline** con dati
salvati, primo avvio senza rete né dati (nessun numero a schermo). Zero errori
JavaScript. Le chiamate Open-Meteo sono servite con i dati di prova perché
l'ambiente di sviluppo non raggiunge le API.

**Rischi residui:** blocco `current=` dell'API Marine e URL dell'embed
RainViewer mai verificati con rete vera da qui. Entrambi degradano senza
danni: fallback sulla serie oraria e mappa che si apre con i valori
predefiniti.

## 7. Backlog

**P1 — completa il primo passo**
- Rendere `main` il branch predefinito (Settings → General) e aggiornare la
  riga `branches:` del workflow: oggi il deploy parte dal branch di sviluppo.
- Allerta "ingresso in zona bandiera gialla/rossa previsto alle 14".

**P2 — secondo passo (piccolo server intermedio, es. Cloudflare Worker)**
- Allerte ufficiali: Centro Funzionale Regionale Toscana e Meteoalarm.
- Chiave commerciale Open-Meteo lato server, cache condivisa delle chiamate.
- Stazione SIR Toscana come dato osservato (tolto dalla v4 finché non c'è il server).

**P3 — prodotto**
- Più stabilimenti con soglie da ordinanza, logo, QR code per i bagnanti.
- Alba/tramonto e fine servizio; più posizioni salvate; registro giornaliero.

## 8. Manutenzione

- Soglie: in cima a `js/logica.js`. Dopo una modifica, `npm test`.
- Nuovo rilascio che cambia i file dell'app: incrementare `VERSIONE` in `sw.js`.
- Icona: modificare `icons/icona.svg` / `icona-maskable.svg` e rigenerare i PNG.
