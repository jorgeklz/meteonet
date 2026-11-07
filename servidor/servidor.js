/* =============================================================================
   UTM MeteoNet · servidor de referencia
   -----------------------------------------------------------------------------
   Implementación mínima y funcional de los cuatro servicios que `config.js`
   espera. Está pensada para leerse de principio a fin y adaptarse, no para
   desplegarse tal cual sin revisión.

   Resuelve los dos problemas que no se pueden resolver desde el navegador:

     1. El token de la API queda en el servidor, nunca en el código que
        descarga el visitante.
     2. Las lecturas se guardan en disco, de modo que el histórico es real y
        compartido, en lugar de vivir en el navegador de cada persona.

   Arranque:

       cd servidor
       npm install
       cp env.ejemplo.txt .env  # y rellenar METEONET_TOKEN y ADMIN_*
       npm start

   Requiere Node 18 o superior (usa fetch nativo).
   ============================================================================= */

import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import 'dotenv/config';

const PUERTO = Number(process.env.PUERTO || 3001);
const ORIGEN_API = process.env.ORIGEN_API || 'https://app.utm.edu.ec:3000/';
const TOKEN = process.env.METEONET_TOKEN || '';
const ORIGEN_PERMITIDO = process.env.ORIGEN_PERMITIDO || 'http://localhost:8080';
const MINUTOS_MUESTREO = Number(process.env.MINUTOS_MUESTREO || 10);
const CORREO_OBSERVATORIO = process.env.CORREO_OBSERVATORIO || 'meteonet@utm.edu.ec';

if (!TOKEN) {
  console.warn('AVISO: METEONET_TOKEN está vacío. Las llamadas a la API irán sin autenticar.');
}

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(cors({ origin: ORIGEN_PERMITIDO }));

/* -----------------------------------------------------------------------------
   Base de datos
   -------------------------------------------------------------------------- */
const db = new Database(process.env.BASE_DATOS || 'meteonet.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS lecturas (
    estacion    TEXT NOT NULL,
    momento     TEXT NOT NULL,
    temperatura REAL,
    humedad     REAL,
    precipitacion REAL,
    viento      REAL,
    direccion   REAL,
    radiacion   REAL,
    uv          REAL,
    presion     REAL,
    PRIMARY KEY (estacion, momento)
  );

  CREATE INDEX IF NOT EXISTS idx_lecturas_momento ON lecturas (estacion, momento DESC);

  CREATE TABLE IF NOT EXISTS solicitudes (
    id          TEXT PRIMARY KEY,
    creada      TEXT NOT NULL,
    documento   TEXT,
    nombre      TEXT,
    institucion TEXT,
    correo      TEXT,
    estacion    TEXT,
    variables   TEXT,
    desde       TEXT,
    hasta       TEXT,
    proposito   TEXT,
    estado      TEXT DEFAULT 'Recibida'
  );
`);

const guardarLectura = db.prepare(`
  INSERT OR IGNORE INTO lecturas
    (estacion, momento, temperatura, humedad, precipitacion, viento, direccion, radiacion, uv, presion)
  VALUES (@estacion, @momento, @temperatura, @humedad, @precipitacion, @viento, @direccion, @radiacion, @uv, @presion)
`);

const consultarLecturas = db.prepare(`
  SELECT * FROM lecturas
  WHERE estacion = ? AND momento >= ? AND momento <= ?
  ORDER BY momento DESC
  LIMIT 5000
`);

const guardarSolicitud = db.prepare(`
  INSERT INTO solicitudes
    (id, creada, documento, nombre, institucion, correo, estacion, variables, desde, hasta, proposito)
  VALUES (@id, @creada, @documento, @nombre, @institucion, @correo, @estacion, @variables, @desde, @hasta, @proposito)
`);

/* -----------------------------------------------------------------------------
   1. Proxy del servicio de estaciones
   -----------------------------------------------------------------------------
   El navegador llama a /api/get_stations y /api/get_station_info, sin token.
   Este servidor añade la credencial y reenvía.
   -------------------------------------------------------------------------- */
const RUTAS_PERMITIDAS = new Set(['get_stations', 'get_station_info']);

app.get('/api/:ruta', async (req, res) => {
  if (!RUTAS_PERMITIDAS.has(req.params.ruta)) {
    return res.status(404).json({ error: 'Ruta no permitida' });
  }
  try {
    const url = new URL(req.params.ruta, ORIGEN_API);
    for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
    const r = await fetch(url, { headers: TOKEN ? { 'access-token': TOKEN } : {} });
    const datos = await r.json();
    res.status(r.status).json(datos);
  } catch (err) {
    res.status(502).json({ error: 'No se pudo consultar el servicio de estaciones' });
  }
});

/* -----------------------------------------------------------------------------
   2. Histórico
   -----------------------------------------------------------------------------
   GET /api/get_station_history?stationId=<id>&desde=<ISO>&hasta=<ISO>

   Devuelve los mismos nombres de campo que el servicio de estaciones, para que
   el cliente pueda reutilizar `estaciones.campos` sin configurar nada aparte.
   Las lecturas se guardan ya convertidas, así que aquí no hay conversión: en
   `config.js` el bloque `historico` debe declarar las mismas unidades de
   destino (C, hPa, ms, mm).
   -------------------------------------------------------------------------- */
app.get('/api/get_station_history', (req, res) => {
  const estacion = String(req.query.stationId || '');
  if (!estacion) return res.status(400).json({ error: 'Falta stationId' });

  const hasta = String(req.query.hasta || new Date().toISOString());
  const desde = String(req.query.desde || new Date(Date.now() - 30 * 86400000).toISOString());

  const filas = consultarLecturas.all(estacion, desde, hasta).map((f) => ({
    iso_date: f.momento,
    temp: f.temperatura,
    hum: f.humedad,
    rain_rate_last_mm: f.precipitacion,
    wind_speed_last: f.viento,
    wind_dir_last: f.direccion,
    solar_rad: f.radiacion,
    uv_index: f.uv,
    bar_sea_level: f.presion,
  }));

  res.json({ data: filas });
});

/* -----------------------------------------------------------------------------
   Correo
   -----------------------------------------------------------------------------
   Las solicitudes se avisan a meteonet@utm.edu.ec. Si no hay SMTP configurado
   la solicitud se guarda igual y queda registro en consola, para no perderla.
   -------------------------------------------------------------------------- */
const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PUERTO || 587),
      secure: String(process.env.SMTP_SEGURO || 'false') === 'true',
      auth: process.env.SMTP_USUARIO
        ? { user: process.env.SMTP_USUARIO, pass: process.env.SMTP_CLAVE }
        : undefined,
    })
  : null;

function cuerpoSolicitud(s) {
  return [
    'Nueva solicitud de datos meteorologicos',
    '',
    `Solicitante:  ${s.fullName}`,
    `Documento:    ${s.document || '-'}`,
    `Institucion:  ${s.institution || '-'}`,
    `Correo:       ${s.email}`,
    '',
    `Estacion:     ${s.stationId === 'all' ? 'Todas las estaciones' : s.stationId}`,
    `Variables:    ${(s.variables || []).join(', ') || '-'}`,
    `Periodo:      ${s.startDate} a ${s.endDate}`,
    '',
    'Proposito:',
    s.purpose || '-',
    '',
    `Recibida:     ${s.createdAt || new Date().toISOString()}`,
    '',
    '-- ',
    'UTM MeteoNet, observatorio meteorologico de la Universidad Tecnica de Manabi',
  ].join('\n');
}

async function avisarSolicitud(solicitud) {
  const destino = solicitud.destino || CORREO_OBSERVATORIO;
  if (!transporte) {
    console.log('[solicitud sin SMTP] destinataria:', destino, '\n' + cuerpoSolicitud(solicitud));
    return false;
  }
  try {
    await transporte.sendMail({
      from: process.env.SMTP_REMITENTE || destino,
      to: destino,
      replyTo: solicitud.email,
      subject: `Solicitud de datos \u00b7 ${solicitud.fullName} (${solicitud.institution || 'sin institucion'})`,
      text: cuerpoSolicitud(solicitud),
    });
    return true;
  } catch (err) {
    console.error('No se pudo enviar el aviso de solicitud:', err.message);
    return false;
  }
}

/* -----------------------------------------------------------------------------
   3. Solicitudes de datos
   -------------------------------------------------------------------------- */
app.post('/api/solicitudes', async (req, res) => {
  const s = req.body || {};
  if (!s.email || !s.fullName) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  try {
    guardarSolicitud.run({
      id: s.id || crypto.randomUUID(),
      creada: s.createdAt || new Date().toISOString(),
      documento: s.document || '',
      nombre: s.fullName,
      institucion: s.institution || '',
      correo: s.email,
      estacion: s.stationId || 'all',
      variables: JSON.stringify(s.variables || []),
      desde: s.startDate || '',
      hasta: s.endDate || '',
      proposito: s.purpose || '',
    });
    /* La solicitud ya esta guardada: si el correo falla no se pierde, y el
       equipo la ve igualmente en la tabla `solicitudes`. */
    const avisado = await avisarSolicitud(s);
    res.json({ ok: true, avisado });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo registrar la solicitud' });
  }
});

/* -----------------------------------------------------------------------------
   4. Acceso de administración
   -----------------------------------------------------------------------------
   La clave se guarda como hash bcrypt en la variable de entorno ADMIN_HASH.
   Para generarlo:  node -e "console.log(require('bcryptjs').hashSync('tuClave',10))"
   -------------------------------------------------------------------------- */
const sesiones = new Map(); // token -> { usuario, expira }
const DURACION_SESION_MS = 8 * 3600 * 1000;

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  const usuarioOk = usuario === process.env.ADMIN_USUARIO;
  const claveOk = usuarioOk && process.env.ADMIN_HASH && bcrypt.compareSync(String(clave || ''), process.env.ADMIN_HASH);

  if (!usuarioOk || !claveOk) {
    return res.status(401).json({ ok: false });
  }

  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, { usuario, expira: Date.now() + DURACION_SESION_MS });
  res.json({ ok: true, rol: 'admin', token });
});

/* Middleware para proteger lo que deba estar protegido */
export function requiereAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const sesion = sesiones.get(token);
  if (!sesion || sesion.expira < Date.now()) {
    sesiones.delete(token);
    return res.status(401).json({ error: 'Sesión no válida' });
  }
  next();
}

/* -----------------------------------------------------------------------------
   5. Muestreo periódico
   -----------------------------------------------------------------------------
   Esto es lo que convierte el histórico en algo real: cada N minutos se
   consultan todas las estaciones y se guarda la lectura. Sin este paso, la
   tabla `lecturas` nunca se llena.
   -------------------------------------------------------------------------- */
const F_A_C = (v) => (v == null ? null : ((v - 32) * 5) / 9);
const INHG_A_HPA = (v) => (v == null ? null : v * 33.8638866667);

async function muestrear() {
  try {
    const r = await fetch(new URL('get_stations', ORIGEN_API), {
      headers: TOKEN ? { 'access-token': TOKEN } : {},
    });
    const { data: estaciones = [] } = await r.json();

    for (const est of estaciones) {
      try {
        const url = new URL('get_station_info', ORIGEN_API);
        url.searchParams.set('stationId', est.stationId);
        const ri = await fetch(url, { headers: TOKEN ? { 'access-token': TOKEN } : {} });
        const { data: [registro] = [] } = await ri.json();
        if (!registro) continue;

        const m = registro.meteorological?.[0] || {};
        const b = registro.barometer?.[0] || {};

        guardarLectura.run({
          estacion: est.stationId,
          momento: registro.iso_date || new Date().toISOString(),
          temperatura: F_A_C(m.temp),
          humedad: m.hum ?? null,
          precipitacion: m.rain_rate_last_mm ?? null,
          viento: m.wind_speed_last ?? null,
          direccion: m.wind_dir_last ?? null,
          radiacion: m.solar_rad ?? null,
          uv: m.uv_index ?? null,
          presion: INHG_A_HPA(b.bar_sea_level),
        });
      } catch (err) {
        console.error('Muestreo fallido para', est.stationId, err.message);
      }
    }
    console.log(new Date().toISOString(), 'muestreo completado:', estaciones.length, 'estaciones');
  } catch (err) {
    console.error('No se pudo listar estaciones:', err.message);
  }
}

setInterval(muestrear, MINUTOS_MUESTREO * 60000);
muestrear();

app.listen(PUERTO, () => {
  console.log(`UTM MeteoNet · servidor en http://localhost:${PUERTO}`);
  console.log(`Muestreo cada ${MINUTOS_MUESTREO} min · origen ${ORIGEN_API}`);
});
