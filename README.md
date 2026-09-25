# Vedetta — console meteo-mare

App web per Assistenti Bagnanti (Follonica, litorale tirrenico): bandiera
calcolata, vento, onde, pioggia, allerta temporale e radar. Si installa sul
telefono come un'app e mostra gli ultimi dati reali anche senza rete.

**Apri:** https://tommasobarzanti.github.io/Claude-meteo/ — poi "Aggiungi a
schermata Home" (Safari) o "Installa app" (Chrome).

## Viste

- **Previsione** — condizioni attuali con bandiera, prossime 6 ore, grafici
  48 h di vento, onda e pioggia con le soglie bandiera, registro orario 72 h,
  link "seconda opinione" (3BMeteo, IlMeteo, MeteoAM, meteoblue).
- **Bagnino** — pannello da mostrare ai bagnanti, sempre ad alto contrasto:
  bandiera, aria e cielo, mare, UV, onde, vento e pioggia della giornata.
- **Radar** — radar pioggia RainViewer a tutto schermo.

## Dati

[Open-Meteo](https://open-meteo.com) Forecast e Marine (CC BY 4.0, nessuna
chiave) e radar [RainViewer](https://www.rainviewer.com). L'API gratuita di
Open-Meteo è solo per uso non commerciale.

## Sviluppo

Nessun framework e nessun build step. Le soglie operative (bandiera, pioggia,
temporale) sono in cima a `js/logica.js`.

```
npm install              # una volta: scarica playwright-core
npm test                 # test della logica (bandiera, sintesi, allerte)
npm run test:browser     # prove dell'app in Chromium, senza rete
npm run test:tutto       # entrambi
```

Le prove nel browser servono l'app da un server locale e rispondono alle
chiamate Open-Meteo con i dati di prova di `tests/fixture.js`; gli screenshot
di ogni prova finiscono in `tests/.screenshot/`. Se Chromium non viene
trovato: `npx playwright-core install chromium`, oppure indicare un Chromium
già installato con la variabile `VEDETTA_CHROMIUM`.

Il deploy su GitHub Pages parte a ogni push sul branch predefinito, solo se
entrambi i gruppi di test passano. Dettagli e backlog in [docs/REPORT.md](docs/REPORT.md).

La bandiera calcolata è un supporto: la decisione finale spetta sempre
all'Assistente Bagnanti in servizio secondo l'ordinanza balneare vigente.
