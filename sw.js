/* Service worker di Vedetta: rende l'app apribile anche senza rete.
   Solo i file dell'app (stesso dominio), con strategia "prima la rete":
   online si vede sempre l'ultima versione pubblicata, offline quella salvata.
   I dati meteo non passano di qui: li salva l'app (vedi caricaDatiSalvati).
   A ogni rilascio che cambia i file, incrementare VERSIONE. */
const VERSIONE = "vedetta-v4";
const FILE_APP = [
  "./", "./index.html", "./css/vedetta.css", "./js/logica.js", "./js/app.js",
  "./manifest.webmanifest", "./icons/icona.svg", "./icons/icona-192.png", "./icons/icona-512.png"
];

self.addEventListener("install", evento => {
  evento.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE_APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(chiavi => Promise.all(chiavi.filter(k => k !== VERSIONE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", evento => {
  const richiesta = evento.request;
  if (richiesta.method !== "GET" || new URL(richiesta.url).origin !== self.location.origin) return;
  evento.respondWith(
    fetch(richiesta)
      .then(risposta => {
        if (risposta.ok){
          const copia = risposta.clone();
          caches.open(VERSIONE).then(c => c.put(richiesta, copia));
        }
        return risposta;
      })
      .catch(() => caches.match(richiesta, { ignoreSearch: true })
        .then(salvata => salvata || (richiesta.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
