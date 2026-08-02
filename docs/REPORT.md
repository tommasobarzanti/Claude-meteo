# Vedetta — Report tecnico

**Progetto:** console meteo-mare per Assistenti Bagnanti · Follonica (GR)
**Data report:** 2 agosto 2026 · **Versione:** v3.1 (commit sul branch predefinito)
**Produzione:** https://tommasobarzanti.github.io/Claude-meteo/
**Repository:** github.com/tommasobarzanti/Claude-meteo

---

## 1. Sintesi

Applicazione web a **file singolo** (`index.html`, ~1.300 righe: CSS + JS inline,
zero dipendenze, zero build step) che aggrega previsioni atmosferiche e marine
per una postazione di salvataggio. Due viste: **Tecnica** (operatore) e
**Bagnino** (informazioni da comunicare ai bagnanti). Deploy automatico su
GitHub Pages via GitHub Actions. Dopo una settimana di uso reale sono stati
risolti i tre difetti principali emersi (avvio lento per colpa del GPS, dialog
posizione macchinoso, mancanza di fonti multiple) e riprogettata la vista
pubblica secondo il feedback dell'utente finale.

## 2. Architettura

```
index.html (unico deliverable)
├── CSS: design token su :root, tema chiaro/scuro via prefers-color-scheme
│        + data-theme override; pannello Bagnino SEMPRE chiaro (lettura al sole)
├── HTML: testata sticky → tab Tecnica/Bagnino → card
└── JS (vanilla, nessuna libreria)
    ├── Costanti operative (soglie bandiera, refresh, retry) — in cima, modificabili
    ├── Data layer: fetch parallele con Promise.allSettled + retry/backoff 2/4/8 s
    ├── Stato di sessione in oggetto `stato` + localStorage SOLO per la posizione
    │   (con guardia try/catch: si degrada dove lo storage non c'è, es. artifact)
    ├── Render: funzioni pure per card/tabella/grafici canvas DPR-aware
    └── Modalità demo etichettata (dati sintetici) quando la rete è bloccata
```

**Scelte deliberate:** niente framework né bundler (deploy = copia di un file);
canvas nativo per i grafici (CSP-safe, nessun CDN); tipografia di sistema
(niente webfont esterni, bloccabili); i colori serie dei grafici sono validati
per contrasto ≥3:1 e daltonismo (CVD ΔE) in entrambi i temi.

## 3. Fonti dati

| Fonte | Uso | Note |
|---|---|---|
| Open-Meteo Forecast (`best_match`) | pipeline principale 72 h | ECMWF IFS + DWD ICON, GFS a riempimento |
| Open-Meteo Marine | onde, swell, T mare | MFWAM / ECMWF WAM |
| RainViewer (embed) | card "Radar pioggia": mappa interattiva | radar osservato + nowcast a brevissimo termine, nessuna chiave |
| Open-Meteo Geocoding | ricerca luogo nel dialog posizione | |
| SIR Toscana | modulo opzionale, spento | serve un proxy proprio (niente CORS sul portale) |

**Confronto con 3BMeteo / IlMeteo (richiesta utente):** entrambe le testate
non espongono API pubbliche leggibili dal browser (3BMeteo vende un'API
commerciale; IlMeteo non ne ha; lo scraping è bloccato dal CORS e vietato dai
ToS). Come concordato, **nessun confronto numerico in pagina**: la card
"Seconda opinione" apre con un tocco la previsione della fonte originale
(3BMeteo, IlMeteo, MeteoAM, meteoblue) già puntata sulla zona. La precedente
card di confronto multi-modello è stata rimossa su feedback utente.

### ⚠ Licenze — punto critico per la monetizzazione
- **Open-Meteo API gratuita: solo uso NON commerciale.** Un prodotto a
  pagamento richiede il piano API commerciale (da ~29 €/mese) o un cambio di
  provider. Da budgetizzare PRIMA di qualsiasi vendita.
- **MET Norway:** gratuita anche per uso commerciale ma richiede attribuzione
  (presente nel footer) e User-Agent identificativo sul traffico intenso; con
  un backend proprio si risolve pulitamente.
- GitHub Pages vieta siti commerciali "primarily" transazionali; per un
  prodotto vero servirà un hosting dedicato (Cloudflare Pages/Netlify, ~0 €).

## 4. Qualità e test

**Coperto:** sintassi JS verificata a ogni build (`node --check`); smoke test
Playwright/Chromium su 5 scenari (mobile chiaro/scuro, desktop, hover grafici,
vista Bagnino) con cattura degli errori console — zero errori JS; palette
grafici validata con validatore CVD/contrasto in entrambi i temi; percorso di
errore rete testato realmente (l'ambiente di sviluppo bloccava le API: il
banner e la modalità demo nascono da lì).

**Non coperto (rischi residui):**
1. Blocco `current=` dell'API Marine mai testato con rete vera — se un
   parametro fosse invalido l'errore compare nel banner rosso ed esiste già il
   fallback sulla serie oraria. **Da verificare alla prima apertura.**
2. Parametri dell'URL embed RainViewer da conoscenza, non verificabili live
   dall'ambiente di sviluppo: la mappa tollera parametri ignoti (carica con i
   default), quindi il rischio è solo di zoom/centratura non ottimali.
3. Nessun test automatico di regressione sul calcolo bandiera (v. backlog).

## 5. Problemi noti risolti in v3 (feedback settimana di prova)

| Feedback | Intervento |
|---|---|
| «GPS laborioso, graficamente scarso» | Avvio **istantaneo**: si parte con l'ultima posizione ricordata (localStorage) o Follonica, senza aspettare il fix; prompt GPS solo alla prima visita; dialog ridisegnato con scorciatoie (GPS / Follonica), ricerca che si applica al tocco, coordinate manuali nascoste sotto "avanzate" |
| «Più dati da altre fonti» | Scheda Confronto modelli (3 modelli + MET Norway) con indicatore di accordo |
| «"Bagnanti" → "Bagnino", vento della giornata» | Tab rinominato; nel pannello: barre orarie 6–21 colorate con le soglie bandiera + sintesi "si alza alle X · massimo Y km/h alle Z · cala dopo le W"; dopo le 21 passa da solo a domani |
| Push su `main` annullava il deploy buono | Trigger del workflow ristretto al branch predefinito (l'ambiente `github-pages` rifiuta gli altri) |

## 6. Backlog prioritizzato

**P1 — prossima iterazione**
- Verifica live dei 3 punti in §4 e correzione eventuale (10 minuti con rete vera).
- PWA: manifest + service worker → icona home "vera", cache offline dell'ultimo
  dato (in postazione il segnale va e viene).
- Test unitari del calcolo bandiera e della sintesi vento (i due algoritmi con
  responsabilità di sicurezza) — estraibili in modulo puro testabile.

**P2 — valore operativo**
- Multi-spot: elenco posizioni salvate (stabilimento, boa, spot surf) con
  switch a un tocco.
- Allerta visiva quando la previsione supererà le soglie bandiera nelle
  prossime N ore ("alle 14 previsto ingresso in zona gialla").
- Pressione: mini-grafico 24 h al posto della sola freccia.

**P3 — prodotto**
- Backend leggero (Cloudflare Worker): cache condivisa delle chiamate API
  (una sola fetch per tutti gli utenti), chiavi commerciali server-side,
  proxy SIR Toscana.
- Multi-tenant per stabilimenti (logo, soglie da ordinanza locale, QR code da
  esporre in spiaggia per i bagnanti).
- Storico condizioni + export (registro giornaliero del bagnino).

## 7. Nota di manutenzione

Se il branch predefinito del repo verrà cambiato in `main`, aggiornare la
riga `branches:` in `.github/workflows/pages.yml` (commento già nel file).
Le soglie bandiera sono in `BANDIERA_SOGLIE`; qualsiasi taratura
dall'ordinanza della Capitaneria si fa lì, senza toccare la logica.
