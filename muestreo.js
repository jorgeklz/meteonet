#!/usr/bin/env node
/* =============================================================================
   UTM MeteoNet · muestreo de estaciones
   -----------------------------------------------------------------------------
   Consulta las estaciones cada N minutos y añade una lectura de cada una a
   `muestreo.json`, junto al sitio. La aplicación lee ese archivo al arrancar y
   lo fusiona con lo que ya tenga el navegador, así que el histórico y el
   patrón de 24 horas se llenan solos.

   Es la alternativa ligera al servidor completo de `servidor/`: sin
   dependencias, sin base de datos, un solo archivo.

       node muestreo.js                # cada 10 minutos, hasta que se corte
       node muestreo.js --cada 5       # cada 5 minutos
       node muestreo.js --una-vez      # una sola lectura y termina
       node muestreo.js --hasta "2026-11-08T12:00"   # para a esa hora local

   Requiere Node 18 o superior. Déjalo corriendo en una terminal; con
   Ctrl+C termina y el archivo queda con todo lo acumulado.

   SOBRE LA UBICACION DEL VISITANTE
   --------------------------------
   Este script no interviene ahi, y no puede. La ubicacion la pide el
   navegador de cada persona que visita el sitio, con su propio permiso, y
   ningun programa externo puede concederlo en su nombre: es una barrera de
   seguridad del navegador, no una opcion que se pueda desactivar.

   Lo que hace el sitio, en `app.js`, es pedirla al cargar y abrir en la
   estacion mas cercana. El visitante responde una vez y el navegador
   recuerda su respuesta para las siguientes visitas. Si la niega, el sitio
   abre en la estacion por defecto y ofrece el boton "Mi ubicacion" en el
   mapa por si cambia de idea.

   Dos condiciones para que funcione:
     - El sitio debe servirse por HTTPS o desde localhost. Abierto como
       archivo o por IP en claro, el navegador rechaza la peticion.
     - El administrador debe dejar activa la casilla correspondiente en la
       pagina de Configuracion.

   El token no va en este archivo
   ------------------------------
   Se lee de la variable de entorno METEONET_TOKEN, para que no quede escrito
   en el disco ni acabe en un repositorio por descuido:

       export METEONET_TOKEN='...'    # una vez por terminal
       node muestreo.js

   ============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(AQUI, 'muestreo.json');
const ORIGEN = 'https://app.utm.edu.ec:3000/';

const TOKEN = process.env.METEONET_TOKEN || '';

if (!TOKEN) {
  console.error('Falta el token de la API.\n');
  console.error('  export METEONET_TOKEN=\'<el token>\'');
  console.error('  node muestreo.js\n');
  console.error('Lo encuentras en el codigo del sitio original, en la cabecera');
  console.error('access-token de las llamadas a app.utm.edu.ec.');
  process.exit(1);
}

/* ---------- argumentos ---------- */
const args = process.argv.slice(2);
const valor = (nombre, def) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const UNA_VEZ = args.includes('--una-vez');
const MINUTOS = Number(valor('--cada', 10));
const HASTA = valor('--hasta', null);
const LIMITE = HASTA ? new Date(HASTA).getTime() : null;

/* ---------- conversión a Sistema Internacional ---------- */
const F_A_C = (f) => (f == null ? null : Math.round(((f - 32) * 5) / 9 * 10) / 10);
const INHG_A_HPA = (v) => (v == null ? null : Math.round(v * 33.8638866667 * 10) / 10);
const onulo = (v) => (v == null || v === -1 ? null : Number(v));

function leerArchivo() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  } catch {
    return {};
  }
}

function escribirArchivo(datos) {
  /* Escritura atómica: primero a un temporal, después se renombra. Así un
     corte a medias nunca deja el JSON roto. */
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 1));
  fs.renameSync(tmp, ARCHIVO);
}

async function pedir(ruta, params = {}) {
  const url = new URL(ruta, ORIGEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'access-token': TOKEN } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' en ' + ruta);
  return res.json();
}

async function muestrear() {
  const sello = new Date().toLocaleTimeString('es-EC');
  let estaciones;
  try {
    ({ data: estaciones = [] } = await pedir('get_stations'));
  } catch (err) {
    console.error(`[${sello}] no se pudo listar estaciones: ${err.message}`);
    return;
  }

  const datos = leerArchivo();
  let nuevas = 0;

  for (const est of estaciones) {
    try {
      const { data: [registro] = [] } = await pedir('get_station_info', { stationId: est.stationId });
      if (!registro) continue;
      const m = registro.meteorological?.[0] || {};
      const b = registro.barometer?.[0] || {};

      const lectura = {
        t: registro.iso_date || new Date().toISOString(),
        temp: F_A_C(m.temp),
        hum: onulo(m.hum),
        prec: onulo(m.rain_rate_last_mm),
        vel: onulo(m.wind_speed_last),
        dir: onulo(m.wind_dir_last),
        rad: onulo(m.solar_rad),
        uv: onulo(m.uv_index),
        pres: INHG_A_HPA(b.bar_sea_level),
      };

      const serie = datos[est.stationId] || [];
      /* La API puede repetir la misma marca de tiempo entre consultas */
      if (serie.some((r) => r.t === lectura.t)) continue;
      serie.push(lectura);
      datos[est.stationId] = serie;
      nuevas += 1;
    } catch (err) {
      console.error(`[${sello}] ${est.location}: ${err.message}`);
    }
  }

  if (nuevas) escribirArchivo(datos);

  const resumen = Object.entries(datos)
    .map(([id, serie]) => {
      const nombre = estaciones.find((e) => e.stationId === id)?.location || id.slice(0, 8);
      return `${nombre} ${serie.length}`;
    })
    .join(' · ');
  console.log(`[${sello}] +${nuevas} lecturas · acumulado: ${resumen}`);
}

/* ---------- arranque ---------- */
console.log('UTM MeteoNet · muestreo');
console.log('  archivo:', ARCHIVO);
if (UNA_VEZ) {
  await muestrear();
  process.exit(0);
}
console.log(`  cada ${MINUTOS} min${LIMITE ? ' hasta ' + new Date(LIMITE).toLocaleString('es-EC') : ''}`);
console.log('  Ctrl+C para terminar\n');

await muestrear();
const reloj = setInterval(async () => {
  if (LIMITE && Date.now() >= LIMITE) {
    clearInterval(reloj);
    console.log('\nHora límite alcanzada. Muestreo terminado.');
    process.exit(0);
  }
  await muestrear();
}, MINUTOS * 60000);

process.on('SIGINT', () => {
  console.log('\nMuestreo detenido. El archivo conserva todo lo acumulado.');
  process.exit(0);
});
