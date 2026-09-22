/* Dati di prova con la stessa forma delle risposte Open-Meteo (Forecast e
   Marine), per i test e per le prove dell'interfaccia senza rete.
   Scenario: giornata estiva con brezza termica pomeridiana, pioggia tra le
   13 e le 17 e un temporale fra ~5 ore. Le serie partono dalla mezzanotte
   locale di oggi, come l'API con timezone=auto. */
"use strict";

function isoLocale(d){
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "T" + p(d.getHours()) + ":00";
}

function generaFixture(adesso = new Date(), { temporale = true } = {}){
  const inizio = new Date(adesso); inizio.setHours(0, 0, 0, 0);
  const h = { time:[], temperature_2m:[], apparent_temperature:[], pressure_msl:[], surface_pressure:[],
    wind_speed_10m:[], wind_direction_10m:[], wind_gusts_10m:[], cloud_cover:[],
    precipitation_probability:[], precipitation:[], uv_index:[], weather_code:[] };
  const m = { time:[], wave_height:[], wave_direction:[], wave_period:[], wind_wave_height:[],
    wind_wave_direction:[], wind_wave_period:[], swell_wave_height:[], swell_wave_direction:[],
    swell_wave_period:[], sea_surface_temperature:[] };

  for (let i = 0; i < 72; i++){
    const d = new Date(inizio.getTime() + i * 3600e3);
    const ora = d.getHours();
    const sole = Math.max(0, Math.sin((ora - 6) / 14 * Math.PI));
    const brezza = Math.max(0, Math.sin((ora - 10) / 9 * Math.PI));
    const vento = 6 + 16 * brezza + Math.sin(i * 1.7) * 1.5;
    const piove = ora >= 13 && ora <= 17;
    h.time.push(isoLocale(d)); m.time.push(isoLocale(d));
    h.temperature_2m.push(+(23 + 6.5 * sole).toFixed(1));
    h.apparent_temperature.push(+(24 + 7.5 * sole).toFixed(1));
    h.pressure_msl.push(+(1014.5 + 2.2 * Math.sin(i / 24 * Math.PI) - i * 0.04).toFixed(1));
    h.surface_pressure.push(+(1013.2 + 2.2 * Math.sin(i / 24 * Math.PI) - i * 0.04).toFixed(1));
    h.wind_speed_10m.push(+vento.toFixed(1));
    h.wind_direction_10m.push(Math.round(brezza > 0.25 ? 300 : 45));
    h.wind_gusts_10m.push(+(vento * 1.55).toFixed(1));
    h.cloud_cover.push(piove ? 90 : 20);
    h.precipitation_probability.push(piove ? 55 + Math.round(20 * Math.sin((ora - 13) / 4 * Math.PI)) : (ora >= 11 && ora <= 19 ? 25 : 5));
    h.precipitation.push(piove ? 1.5 : 0);
    h.uv_index.push(+(9.5 * Math.pow(sole, 1.6)).toFixed(1));
    h.weather_code.push(piove ? 80 : (sole > 0 ? 1 : 0));
    const onda = 0.15 + 0.45 * brezza;
    m.wave_height.push(+onda.toFixed(2)); m.wave_direction.push(290); m.wave_period.push(+(3.2 + onda * 2).toFixed(1));
    m.wind_wave_height.push(+onda.toFixed(2)); m.wind_wave_direction.push(290); m.wind_wave_period.push(3.5);
    m.swell_wave_height.push(0.15); m.swell_wave_direction.push(225); m.swell_wave_period.push(5.5);
    m.sea_surface_temperature.push(26.4);
  }
  if (temporale){
    const k = adesso.getHours() + 5;
    h.weather_code[k] = 95; h.precipitation_probability[k] = 85; h.precipitation[k] = 4;
  }
  const i0 = adesso.getHours();
  const meteo = {
    latitude: 42.92, longitude: 10.76, timezone: "Europe/Rome",
    current: { time: h.time[i0], temperature_2m: h.temperature_2m[i0], apparent_temperature: h.apparent_temperature[i0],
      pressure_msl: h.pressure_msl[i0], surface_pressure: h.surface_pressure[i0],
      wind_speed_10m: h.wind_speed_10m[i0], wind_direction_10m: h.wind_direction_10m[i0],
      wind_gusts_10m: h.wind_gusts_10m[i0], cloud_cover: h.cloud_cover[i0], precipitation: 0,
      weather_code: h.weather_code[i0] },
    hourly: h
  };
  const marine = {
    latitude: 42.92, longitude: 10.76, timezone: "Europe/Rome",
    current: { time: m.time[i0], wave_height: m.wave_height[i0], wave_direction: m.wave_direction[i0],
      wave_period: m.wave_period[i0], sea_surface_temperature: m.sea_surface_temperature[i0] },
    hourly: m
  };
  return { meteo, marine };
}

module.exports = { generaFixture, isoLocale };
