# Vedetta — console meteo-mare

Dashboard meteo-marina per Assistenti Bagnanti (Follonica, litorale tirrenico).
Un unico file `index.html` senza dipendenze: HTML, CSS e JS inline.

- **Dati**: [Open-Meteo Forecast API](https://open-meteo.com/en/docs) (atmosfera,
  modello best_match: ECMWF IFS + DWD ICON, GFS a riempimento) e
  [Marine Weather API](https://open-meteo.com/en/docs/marine-weather-api)
  (onde e temperatura del mare, Météo-France MFWAM / ECMWF WAM). Nessuna API key.
- **Vista tecnica**: condizioni attuali, grafici 48 h con soglie bandiera,
  registro orario 72 h.
- **Pannello bagnanti**: bandiera verde/gialla/rossa calcolata da vento e onda
  (scale Beaufort/Douglas, soglie modificabili nelle costanti in cima allo
  script), sempre ad alto contrasto su fondo chiaro.
- **Posizione**: GPS con fallback su Follonica (42.92 N, 10.76 E), inserimento
  manuale o ricerca luogo.

## Uso

Apri `index.html` in un browser (doppio clic) oppure la versione pubblicata
con GitHub Pages da questo repository. Se la rete è bloccata la pagina offre
una modalità dimostrativa, sempre marcata "dati non reali".

La bandiera calcolata è un supporto: la decisione finale spetta sempre
all'Assistente Bagnanti in servizio secondo l'ordinanza balneare vigente.
