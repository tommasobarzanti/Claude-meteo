/* Prove dell'app in un vero browser (Chromium, via playwright-core).
   Il test avvia da solo un server locale e risponde alle chiamate Open-Meteo
   con i dati di prova di fixture.js: nessuna rete necessaria.
   Lancio:  npm run test:browser
   Screenshot di ogni prova in tests/.screenshot/ (non versionati). */
"use strict";
const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { generaFixture } = require("./fixture.js");

const RADICE = path.join(__dirname, "..");
const CARTELLA_SCREENSHOT = path.join(__dirname, ".screenshot");
const TIPI = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".svg":"image/svg+xml",
  ".png":"image/png", ".webmanifest":"application/manifest+json", ".json":"application/json" };
const TELEFONO = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    const percorso = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(RADICE, percorso.endsWith("/") ? percorso + "index.html" : percorso);
    if (!file.startsWith(RADICE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": TIPI[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port + "/";
  browser = await chromium.launch(process.env.VEDETTA_CHROMIUM ? { executablePath: process.env.VEDETTA_CHROMIUM } : {});
  fs.mkdirSync(CARTELLA_SCREENSHOT, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/* Contesto con rete simulata: Open-Meteo risponde con la fixture finché
   rete.accesa è true; il radar risponde con una pagina segnaposto. */
async function nuovoContesto(opzioni = {}){
  const ctx = await browser.newContext({ ...TELEFONO, ...opzioni });
  const rete = { accesa: true };
  await ctx.route(/open-meteo\.com/, route => {
    if (!rete.accesa) return route.abort("internetdisconnected");
    const url = route.request().url();
    if (url.includes("geocoding")) return route.fulfill({ json: { results: [] } });
    const f = generaFixture(new Date());
    return route.fulfill({ json: url.includes("marine") ? f.marine : f.meteo });
  });
  await ctx.route(/rainviewer\.com/, route => route.fulfill({ contentType: "text/html", body: "<body>radar</body>" }));
  return { ctx, rete };
}

async function apri(ctx){
  const pagina = await ctx.newPage();
  const errori = [];
  pagina.on("pageerror", e => errori.push(e.message));
  pagina.on("console", m => {
    if (m.type() === "error" && !/Failed to load resource|net::/.test(m.text())) errori.push(m.text());
  });
  await pagina.goto(base);
  return { pagina, errori };
}
const pronta = pagina => pagina.waitForSelector('body[data-stato="pronto"]', { timeout: 20000 });
const scatta = (pagina, nome, intera = false) =>
  pagina.screenshot({ path: path.join(CARTELLA_SCREENSHOT, nome + ".png"), fullPage: intera });

test("si apre con i dati: bandiera, strumenti, prossime 6 ore", async () => {
  const { ctx } = await nuovoContesto();
  const { pagina, errori } = await apri(ctx);
  await pronta(pagina);
  assert.match(await pagina.getAttribute("#costola-bandiera", "class"), /verde|gialla|rossa/);
  assert.notEqual((await pagina.textContent("#ad-vento")).trim(), "—");
  assert.equal(await pagina.locator("#prossime-ore .ora-card").count(), 6);
  assert.match(await pagina.textContent("#ultimo-agg"), /aggiornato alle/);
  await scatta(pagina, "previsione", true);
  assert.deepEqual(errori, []);
  await ctx.close();
});

test("allerta temporale visibile quando previsto nelle prossime ore", async () => {
  const { ctx } = await nuovoContesto();
  const { pagina } = await apri(ctx);
  await pronta(pagina);
  assert.equal(await pagina.isVisible("#allerta-temporale"), true);
  assert.match(await pagina.textContent("#allerta-temporale"), /Temporale previsto verso le/);
  await ctx.close();
});

test("le tre viste: Bagnino con sintesi, Radar centrato sulla posizione", async () => {
  const { ctx } = await nuovoContesto();
  const { pagina, errori } = await apri(ctx);
  await pronta(pagina);

  await pagina.click("#tab-bagnino");
  assert.equal(await pagina.isVisible("#vista-bagnino"), true);
  assert.equal(await pagina.isVisible("#vista-previsione"), false);
  assert.match(await pagina.textContent("#pp-nome"), /Bandiera (verde|gialla|rossa)/);
  assert.notEqual((await pagina.textContent("#pp-vento-sintesi")).trim(), "");
  assert.notEqual((await pagina.textContent("#pp-pioggia-sintesi")).trim(), "");
  await scatta(pagina, "bagnino", true);

  await pagina.click("#tab-radar");
  const src = await pagina.getAttribute("#radar-frame", "src");
  assert.match(src, /rainviewer\.com/);
  assert.match(src, /loc=42\.92,10\.76/);
  await scatta(pagina, "radar");
  assert.deepEqual(errori, []);
  await ctx.close();
});

test("la vista scelta resta tale alla riapertura", async () => {
  const { ctx } = await nuovoContesto();
  const { pagina } = await apri(ctx);
  await pronta(pagina);
  await pagina.click("#tab-bagnino");
  await pagina.reload();
  await pronta(pagina);
  assert.equal(await pagina.getAttribute("#tab-bagnino", "aria-selected"), "true");
  await ctx.close();
});

test("senza rete si riapre con gli ultimi dati salvati e lo dice", async () => {
  const { ctx, rete } = await nuovoContesto();
  const { pagina, errori } = await apri(ctx);
  await pronta(pagina);
  assert.equal(await pagina.evaluate(async () => !!(await navigator.serviceWorker.ready).active), true);

  rete.accesa = false;
  await ctx.setOffline(true);
  await pagina.reload();
  await pronta(pagina);
  await pagina.waitForSelector("#avviso-rete:not([hidden])", { timeout: 20000 });
  assert.match(await pagina.textContent("#testo-avviso-rete"), /Senza rete · dati delle/);
  assert.notEqual((await pagina.textContent("#ad-vento")).trim(), "—");
  await scatta(pagina, "offline");

  await pagina.click("#tab-radar");
  assert.equal(await pagina.isVisible("#radar-offline"), true);
  assert.deepEqual(errori, []);
  await ctx.close();
});

test("senza rete e senza dati salvati: nessun numero, errore chiaro", async () => {
  const { ctx, rete } = await nuovoContesto();
  rete.accesa = false;
  const { pagina } = await apri(ctx);
  await pagina.waitForSelector("#avviso-rete:not([hidden])", { timeout: 60000 });
  assert.equal(await pagina.getAttribute("body", "data-stato"), "vuoto");
  assert.match(await pagina.getAttribute("#avviso-rete", "class"), /rosso/);
  assert.equal(await pagina.isVisible("#ad-vento"), false);
  await scatta(pagina, "senza-dati");
  await ctx.close();
});

test("cambiando posizione non restano i numeri del posto precedente", async () => {
  const { ctx, rete } = await nuovoContesto();
  const { pagina } = await apri(ctx);
  await pronta(pagina);
  rete.accesa = false;     // il nuovo posto non si può scaricare
  await pagina.click("#btn-posizione");
  await pagina.click("details.coord-avanzate summary");
  await pagina.fill("#inp-lat", "42.76");
  await pagina.fill("#inp-lon", "10.88");
  await pagina.click("#dlg-salva");
  assert.equal(await pagina.getAttribute("body", "data-stato"), "vuoto");
  assert.equal(await pagina.textContent("#nome-luogo"), "punto personalizzato");
  await ctx.close();
});

test("tema scuro e schermo largo senza errori", async () => {
  for (const [nome, opzioni] of [["scuro", { colorScheme: "dark" }], ["desktop", { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }]]){
    const { ctx } = await nuovoContesto(opzioni);
    const { pagina, errori } = await apri(ctx);
    await pronta(pagina);
    await scatta(pagina, nome, true);
    assert.deepEqual(errori, [], nome);
    await ctx.close();
  }
});
