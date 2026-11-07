'use strict';

const STORAGE_KEY = 'utm-meteonet-state-v4';

/* ---------- Configuracion de integracion ----------
   Todo lo conectable vive en config.js, que se carga antes que este archivo.
   Si no existe, se usan estos valores y la aplicacion funciona con las
   lecturas de ejemplo. Ver el README para la guia de integracion. */
const CFG = Object.assign(
  {
    estaciones: {},
    historico: {},
    solicitudes: {},
    boletin: {},
    acceso: {},
  },
  window.METEONET_CONFIG || {}
);

const CFG_ESTACIONES = Object.assign(
  {
    baseUrl: '',
    rutaListado: 'get_stations',
    rutaDetalle: 'get_station_info',
    cabeceras: {},
    refrescoMinutos: 0,
    unidades: { temperatura: 'F', presion: 'inHg', viento: 'ms', lluvia: 'mm' },
    campos: {},
  },
  CFG.estaciones || {}
);

const CAMPOS = Object.assign(
  {
    id: 'stationId',
    codigo: 'name',
    ubicacion: 'location',
    latitud: 'latitude',
    longitud: 'longitude',
    driver: 'driver',
    temperatura: 'temp',
    temperaturaMin: 'temp_min',
    temperaturaMax: 'temp_max',
    sensacion: 'thsw_index',
    humedad: 'hum',
    vientoVelocidad: 'wind_speed_last',
    vientoDireccion: 'wind_dir_last',
    radiacion: 'solar_rad',
    indiceUv: 'uv_index',
    lluviaTasa: 'rain_rate_last_mm',
    lluviaDiaria: 'rainfall_daily_mm',
    lluvia24h: 'rainfall_last_24_hr_mm',
    lluviaAnual: 'rainfall_year_mm',
    presion: 'bar_sea_level',
    fechaLectura: 'iso_date',
  },
  CFG_ESTACIONES.campos || {}
);

/* ---------- Conversion de unidades ----------
   Todo se guarda en el Sistema Internacional: °C, hPa, m/s, mm. La conversion
   ocurre una sola vez, al recibir el dato, para que el resto de la aplicacion
   no tenga que preguntarse en que unidad viene cada cifra. */
const CONVERSORES = {
  temperatura: {
    F: (v) => ((v - 32) * 5) / 9,
    C: (v) => v,
  },
  presion: {
    inHg: (v) => v * 33.8638866667,
    hPa: (v) => v,
  },
  viento: {
    mph: (v) => v * 0.44704,
    kmh: (v) => v / 3.6,
    ms: (v) => v,
  },
  lluvia: {
    in: (v) => v * 25.4,
    mm: (v) => v,
  },
};

/* Convierte un valor a la unidad interna. Devuelve null si no hay dato:
   nunca se sustituye una medicion ausente por una cifra verosimil. */
function aUnidadInterna(valor, magnitud, decimales = 1) {
  if (valor == null || valor === '' || valor === -1) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const unidad = (CFG_ESTACIONES.unidades || {})[magnitud];
  const fn = (CONVERSORES[magnitud] || {})[unidad];
  const convertido = fn ? fn(n) : n;
  const factor = Math.pow(10, decimales);
  return Math.round(convertido * factor) / factor;
}

/* Lee un campo del registro buscandolo en los tres niveles que devuelve la
   API actual: meteorological[0], barometer[0] y la raiz. */
function leerCampo(registro, meteo, barometro, clave) {
  const nombre = CAMPOS[clave];
  if (!nombre) return null;
  for (const origen of [meteo, barometro, registro]) {
    if (origen && origen[nombre] != null) return origen[nombre];
  }
  return null;
}

function urlEstaciones(ruta) {
  const base = CFG_ESTACIONES.baseUrl || '';
  if (!base) return '';
  return base.endsWith('/') ? base + ruta : base + '/' + ruta;
}

/* El sitio abre siempre en Portoviejo. Se guarda el id conocido y tambien
   el nombre, para resolverla aunque el servidor devuelva otros ids. */
const ESTACION_POR_DEFECTO_ID = 'c20dafea-9d0b-45d7-90d4-555c684f8d49';
const ESTACION_POR_DEFECTO_UBICACION = 'Portoviejo';

function idEstacionPorDefecto(estaciones) {
  const lista = estaciones || [];
  const porId = lista.find((s) => s.id === ESTACION_POR_DEFECTO_ID);
  if (porId) return porId.id;
  const porNombre = lista.find(
    (s) => (s.location || '').trim().toLowerCase() === ESTACION_POR_DEFECTO_UBICACION.toLowerCase()
  );
  if (porNombre) return porNombre.id;
  return lista.length ? lista[0].id : ESTACION_POR_DEFECTO_ID;
}

const WEATHER_VARIABLES = ['humidity', 'precipitation', 'pressure', 'windSpeed', 'radiation', 'uvIndex'];
const VARIABLE_LABELS = {
  humidity: 'Humedad (%)',
  precipitation: 'Precipitación (mm)',
  pressure: 'Presión atmosférica (hPa)',
  windSpeed: 'Velocidad del viento (m/s)',
  radiation: 'Radiación solar (W/m²)',
  uvIndex: 'Índice UV',
  temperature: 'Temperatura (°C)',
};

/* Conversion de Fahrenheit a Celsius redondeada a un decimal.
   Antes se usaba Math.floor/Math.ceil, lo que sesgaba las lecturas
/* Formatea una temperatura en Celsius con un decimal para la interfaz */
function formatTemp(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n.toFixed(1) : SIN_DATO;
}

/* Fecha en formato AAAA-MM-DD segun el huso del visitante.
   toISOString() da UTC, y en Ecuador (UTC-5) eso adelanta un dia a partir de
   las 19:00, lo que ponia el tope de los campos de fecha en manana. */
function fechaLocalIso(fecha = new Date()) {
  const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

/* Texto que se muestra cuando una variable no fue medida. Nunca se sustituye
   por una cifra plausible: la ausencia de dato es informacion. */
const SIN_DATO = 'Sin dato';

/* Valor con unidad, o "Sin dato" si la medicion no llego */
function fmt(valor, unidad = '', decimales = 1) {
  const n = Number(valor);
  if (valor == null || !Number.isFinite(n)) return SIN_DATO;
  const txt = decimales === 0 ? String(Math.round(n)) : n.toFixed(decimales);
  return unidad ? `${txt} ${unidad}` : txt;
}

/* Numero utilizable para calculos, con respaldo explicito */
function num(valor, respaldo = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : respaldo;
}

const VARIABLE_UNITS = {
  humidity: '%',
  precipitation: 'mm',
  pressure: 'hPa',
  windSpeed: 'm/s',
  radiation: 'W/m²',
  uvIndex: 'UV',
  temperature: '°C',
};

/* Estaciones reales de https://posgrado.utm.edu.ec/meteonet/#/ */
/* Lecturas reales tomadas de https://posgrado.utm.edu.ec/meteonet/ el
   2026-11-06 a las 21:59 (Guayaquil). Ya convertidas al Sistema Internacional:
   grados Celsius, hectopascales, metros por segundo y milimetros.
   Son el punto de partida cuando todavia no hay conexion con el servidor;
   la sincronizacion las reemplaza en cuanto responde la API. */
const REAL_STATIONS_DEFAULT = [
  {
    id: '32727b8e-592c-45c3-bf9c-a33d04e54d3a',
    stationId: '32727b8e-592c-45c3-bf9c-a33d04e54d3a',
    code: 'Tj-FIA01UTM',
    name: 'Santa Ana · Tj-FIA01UTM',
    location: 'Santa Ana',
    canton: 'Santa Ana',
    owner: 'UTM',
    ownerLogo: 'assets/images/logo_utm_escudo.png',
    driver: 'weatherlink',
    latitude: -1.175697,
    longitude: -80.385742,
    status: 'Activa',
    temperature: 24.8,
    tempMin: 24.6,
    tempMax: 25.2,
    feelsLike: 26.6,
    humidity: 95.5,
    windSpeed: 0,
    windDir: 0,
    radiation: 0,
    uvIndex: null,
    precipitation: 4,
    rainDaily: 18,
    rain24h: 18,
    rainYear: 956.2,
    pressure: 1013.7,
    updatedAt: '2026-11-07T02:59:21.000Z',
  },
  {
    id: 'c20dafea-9d0b-45d7-90d4-555c684f8d49',
    stationId: 'c20dafea-9d0b-45d7-90d4-555c684f8d49',
    code: 'Tj-FIA02UTM',
    name: 'Portoviejo · Tj-FIA02UTM',
    location: 'Portoviejo',
    canton: 'Portoviejo',
    owner: 'UTM',
    ownerLogo: 'assets/images/logo_utm_escudo.png',
    driver: 'weatherlink',
    latitude: -1.043971,
    longitude: -80.454011,
    status: 'Activa',
    temperature: 25.4,
    tempMin: 25.3,
    tempMax: 26.8,
    feelsLike: 27.4,
    humidity: 90.1,
    windSpeed: 0,
    windDir: 0,
    radiation: 0,
    uvIndex: 0,
    precipitation: 0,
    rainDaily: 1.2,
    rain24h: 1.2,
    rainYear: 614.4,
    pressure: 1013.9,
    updatedAt: '2026-11-07T02:59:21.000Z',
  },
  {
    id: 'd96f49f4-ce2e-45ec-b291-7d68e763300c',
    stationId: 'd96f49f4-ce2e-45ec-b291-7d68e763300c',
    code: 'Tj-JUNAYA',
    name: 'Calderón · Tj-JUNAYA',
    location: 'Calderón',
    canton: 'Calderón',
    owner: 'UTM',
    ownerLogo: 'assets/images/logo_utm_escudo.png',
    driver: 'other',
    latitude: -0.970273,
    longitude: -80.362585,
    status: 'Activa',
    temperature: 24.1,
    tempMin: 23.9,
    tempMax: 25.3,
    feelsLike: 25.0,
    humidity: 93.1,
    windSpeed: 3,
    windDir: 47,
    radiation: 0,
    uvIndex: 0,
    precipitation: 0,
    rainDaily: 4.1,
    rain24h: 4.8,
    rainYear: 706.9,
    pressure: 1014.0,
    updatedAt: '2026-11-07T02:59:21.000Z',
  },
];

const defaults = {
  settings: {
    adminName: 'Jorge P.',
    adminEmail: 'jorge.parraga@utm.edu.ec',
    apiUrl: '',
    aiModel: 'gemma-3',
    /* Minutos entre consultas a las estaciones. null significa "lo que diga
       config.js"; un numero lo sobrescribe desde la pagina de Configuracion. */
    intervaloMinutos: null,
    /* Si el sitio pide la ubicacion para abrir en la estacion mas cercana */
    usarUbicacion: true,
  },
  stations: REAL_STATIONS_DEFAULT,
  alerts: [
    { id: 'rain-heavy', type: 'Precipitación elevada', condition: 'precipitation', operator: '>', value: 10, active: true },
    { id: 'heat', type: 'Temperatura alta', condition: 'temperature', operator: '>', value: 31, active: true },
    { id: 'wind', type: 'Viento fuerte', condition: 'windSpeed', operator: '>', value: 10, active: true },
  ],
  reports: [],
  dataRequests: [],
  users: [
    { id: 'jorge', name: 'Jorge P.', email: 'jorge.parraga@utm.edu.ec', role: 'Administrador', status: 'Activo' },
    { id: 'clima', name: 'Equipo de Climatología', email: 'climatologia@utm.edu.ec', role: 'Analista', status: 'Activo' },
  ],
  selectedStationId: ESTACION_POR_DEFECTO_ID,
};


/* ---------- Estado y utilidades ---------- */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw) return clone(defaults);
    return {
      ...clone(defaults),
      ...raw,
      settings: { ...clone(defaults.settings), ...(raw.settings || {}) },
    };
  } catch {
    return clone(defaults);
  }
}

const state = loadState();
let currentRole = sessionStorage.getItem('utm-meteonet-role') || 'public';
let currentViewId = 'inicio';
let historyPage = 1;
let historyTab = 'measurements';
let quickStationPage = 1;
const quickStationPageSize = 4;
let quickStationSearchQuery = '';

let stationsAdminPage = 1;
const STATIONS_PAGE_SIZE = 5;

const aiModels = [
  { id: 'gemma3', badge: 'G', name: 'Gemma 3', note: 'Modelo local · disponible' },
  { id: 'llama3.1', badge: 'L', name: 'Llama 3.1', note: 'Modelo local · disponible' },
  { id: 'mistral', badge: 'M', name: 'Mistral', note: 'Modelo local · disponible' },
  { id: 'gpt-4o-mini', badge: '4o', name: 'GPT-4o mini', note: 'API externa · disponible' },
  { id: 'claude-haiku', badge: 'C', name: 'Claude Haiku', note: 'API externa · disponible' },
];
let selectedAiModel = 'gemma3';

const aiPrompts = [
  { id: 'tecnico', name: 'Técnico-divulgativo', note: 'Para público general' },
  { id: 'academico', name: 'Informe académico', note: 'Con enfoque científico' },
  { id: 'ejecutivo', name: 'Resumen ejecutivo', note: 'Breve y directo' },
  { id: 'alerta', name: 'Alerta y recomendaciones', note: 'Enfocado en riesgos' },
  { id: 'custom', name: 'Personalizado', note: 'Escribe tu propia instrucción' },
];
let selectedAiPrompt = 'tecnico';

const promptTemplates = {
  tecnico: 'Combina lenguaje técnico y divulgativo; incluye una explicación sencilla para estudiantes.',
  academico: 'Usa lenguaje técnico, estructura los hallazgos y explicita las unidades de cada variable.',
  ejecutivo: 'Redacta un resumen ejecutivo breve, con el estado actual, el riesgo principal y una recomendación clara.',
  alerta: 'Redacta un boletín centrado en alertas y recomendaciones de seguridad, resaltando cualquier riesgo relevante.',
};

const reportToggles = {
  kpisHistoricos: true,
  lluviaMensual: true,
  analisisGrafico: true,
  tormentasRanking: true,
  tecnicos: true,
  recomendaciones: true,
};
let reportSessionHistory = [];
let lastGeneratedReportData = null;

const mapOptions = {
  variable: 'humidity',
  canton: '',
  animacionClima: false,
  etiquetas: true,
  codigo: true,
  temperatura: false,
  sensacionTermica: false,
  humedadViento: false,
  lluviaMapa: false,
  alertasMapa: true,
  baseLayer: 'light',
};

const MAP_TILE_LAYERS = {
  light: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri - Esri, DeLorme, NAVTEQ',
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  topo: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri, USGS, NOAA',
  },
};

let mainMap = null;
let mainMapTileLayer = null;
let mainMapLayerGroup = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function $(selector, root = document) {
  return root.querySelector(selector);
}
function $all(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function currentStation() {
  return (
    state.stations.find((s) => s.id === state.selectedStationId) ||
    state.stations.find((s) => s.id === idEstacionPorDefecto(state.stations)) ||
    state.stations[0]
  );
}
function isAdmin() {
  return currentRole === 'admin';
}
function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}
function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

/* ---------- Historico de mediciones ----------
   Mientras no exista el endpoint de historico, la aplicacion guarda en el
   navegador cada lectura que recibe, para que la pestana Historico tenga algo
   real que mostrar. Es un respaldo de transicion: solo vive en el equipo de
   quien visita el sitio y no sustituye a una base de datos en el servidor.
   Con `historico.baseUrl` configurado, se consulta el servicio y esto queda
   como reserva. */
const CFG_HISTORICO = Object.assign(
  {
    baseUrl: '',
    ruta: 'get_station_history',
    cabeceras: {},
    guardarEnNavegador: true,
    maximoRegistrosPorEstacion: 2000,
    archivoMuestreo: '',
    datosDeEnsayo: false,
  },
  CFG.historico || {}
);

const CLAVE_HISTORICO = 'utm-meteonet-historico-v1';

const CFG_SOLICITUDES = Object.assign(
  { endpoint: '', cabeceras: { 'Content-Type': 'application/json' }, correoDestino: 'meteonet@utm.edu.ec' },
  CFG.solicitudes || {}
);

const CFG_BOLETIN = Object.assign(
  { endpoint: '', cabeceras: { 'Content-Type': 'application/json' }, tiempoLimiteMs: 60000 },
  CFG.boletin || {}
);

const CFG_ACCESO = Object.assign(
  { endpoint: '', demoUsuario: 'admin', demoClave: 'utm2026' },
  CFG.acceso || {}
);

/* Envia la solicitud de datos al servicio configurado. Sin endpoint, la
   solicitud solo queda en el navegador de quien la envio y nadie la recibe,
   asi que se devuelve false para que la interfaz lo advierta. */
async function enviarSolicitudAlServidor(solicitud) {
  if (!CFG_SOLICITUDES.endpoint) return false;
  try {
    const res = await fetch(CFG_SOLICITUDES.endpoint, {
      method: 'POST',
      headers: CFG_SOLICITUDES.cabeceras || { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...solicitud, destino: CFG_SOLICITUDES.correoDestino || '' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function leerHistoricoLocal() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_HISTORICO) || '{}') || {};
  } catch {
    return {};
  }
}

function guardarLecturaEnHistorico(st) {
  if (!CFG_HISTORICO.guardarEnNavegador || !st || !st.id) return;
  try {
    const todo = leerHistoricoLocal();
    const serie = todo[st.id] || [];
    const marca = st.updatedAt || new Date().toISOString();
    if (serie.length && serie[serie.length - 1].t === marca) return; // misma lectura
    serie.push({
      t: marca,
      temp: st.temperature,
      hum: st.humidity,
      prec: st.precipitation,
      vel: st.windSpeed,
      dir: st.windDir,
      rad: st.radiation,
      uv: st.uvIndex,
      pres: st.pressure,
    });
    const tope = Number(CFG_HISTORICO.maximoRegistrosPorEstacion) || 2000;
    todo[st.id] = serie.slice(-tope);
    localStorage.setItem(CLAVE_HISTORICO, JSON.stringify(todo));
  } catch {
    /* almacenamiento lleno o bloqueado: el historico local es opcional */
  }
}

/* Consulta el servicio de historico configurado. Devuelve null si no hay
   servicio o si la peticion falla, y entonces se usa el respaldo local. */
let historicoDelServidor = null; // {clave, filas} de la ultima consulta
let consultandoHistorico = false;

function claveConsulta(stationId, desde, hasta) {
  return [stationId, desde || '', hasta || ''].join('|');
}

async function cargarHistoricoDelServidor(stationId, desde, hasta) {
  const base = CFG_HISTORICO.baseUrl;
  if (!base) return null;
  const raiz = base.endsWith('/') ? base : base + '/';
  const url = new URL(raiz + CFG_HISTORICO.ruta, window.location.href);
  url.searchParams.set('stationId', stationId);
  if (desde) url.searchParams.set('desde', desde.toISOString());
  if (hasta) url.searchParams.set('hasta', hasta.toISOString());
  try {
    const res = await fetch(url.toString(), { headers: CFG_HISTORICO.cabeceras || {} });
    if (!res.ok) return null;
    const json = await res.json();
    const filas = json?.data || [];
    /* Los nombres de campo y las unidades son los mismos del servicio de
       estaciones, asi que se reutiliza la misma conversion. */
    return filas
      .map((r) => ({
        timestamp: new Date(r[CAMPOS.fechaLectura] || r.iso_date),
        temperature: aUnidadInterna(r[CAMPOS.temperatura], 'temperatura'),
        humidity: numeroOnulo(r[CAMPOS.humedad], 1),
        precipitation: aUnidadInterna(r[CAMPOS.lluviaTasa], 'lluvia'),
        windSpeed: aUnidadInterna(r[CAMPOS.vientoVelocidad], 'viento'),
        windDir: numeroOnulo(r[CAMPOS.vientoDireccion], 0),
        radiation: numeroOnulo(r[CAMPOS.radiacion], 0),
        uvIndex: numeroOnulo(r[CAMPOS.indiceUv], 1),
        pressure: aUnidadInterna(r[CAMPOS.presion], 'presion'),
      }))
      .filter((r) => !Number.isNaN(r.timestamp.getTime()))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return null;
  }
}

/* Serie de una estacion, de la mas reciente a la mas antigua */
function serieHistorica(stationId) {
  const serie = leerHistoricoLocal()[stationId] || [];
  return serie
    .map((r) => ({
      timestamp: new Date(r.t),
      temperature: r.temp,
      humidity: r.hum,
      precipitation: r.prec,
      windSpeed: r.vel,
      windDir: r.dir,
      radiation: r.rad,
      uvIndex: r.uv,
      pressure: r.pres,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/* ---------- Estacion mas cercana a quien visita ----------
   Al cargar se pide la ubicacion del dispositivo y se abre en la estacion
   mas proxima. Si la persona niega el permiso, no hay respuesta o el
   navegador no puede dar la posicion, se queda la estacion por defecto y no
   se vuelve a insistir en esa visita. */
const CLAVE_UBICACION = 'utm-meteonet-ubicacion';

/* Distancia en kilometros sobre la esfera terrestre */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function estacionMasCercana(lat, lon) {
  let mejor = null;
  state.stations.forEach((st) => {
    if (!st.latitude || !st.longitude) return;
    const d = distanciaKm(lat, lon, Number(st.latitude), Number(st.longitude));
    if (!mejor || d < mejor.km) mejor = { estacion: st, km: d };
  });
  return mejor;
}

function seleccionarEstacionMasCercana(lat, lon, avisar = true) {
  const mejor = estacionMasCercana(lat, lon);
  if (!mejor) return null;
  if (state.selectedStationId !== mejor.estacion.id) {
    state.selectedStationId = mejor.estacion.id;
    saveState();
    refrescarDatos();
  }
  if (avisar) {
    const d = mejor.km < 1 ? `${Math.round(mejor.km * 1000)} m` : `${mejor.km.toFixed(1)} km`;
    showToast(`Estaci\u00f3n m\u00e1s cercana: ${mejor.estacion.location}, a ${d}`);
  }
  return mejor;
}

/* Pide la ubicacion. `manual` es true cuando la persona lo pidio con el
   boton, y entonces si se explica el motivo de un fallo. */
function pedirUbicacion(manual = false) {
  if (!navigator.geolocation) {
    if (manual) showToast('Este navegador no puede dar la ubicaci\u00f3n');
    return;
  }
  /* La geolocalizacion solo funciona en contexto seguro: HTTPS o localhost.
     Abierto como archivo o por IP en claro, el navegador la rechaza. */
  if (!window.isSecureContext && manual) {
    showToast('La ubicaci\u00f3n requiere abrir el sitio por HTTPS o en localhost');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      try {
        localStorage.setItem(CLAVE_UBICACION, 'concedida');
      } catch {
        /* sin almacenamiento el permiso se volvera a pedir, no es grave */
      }
      seleccionarEstacionMasCercana(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      if (err && err.code === err.PERMISSION_DENIED) {
        try {
          localStorage.setItem(CLAVE_UBICACION, 'negada');
        } catch {
          /* idem */
        }
        if (manual) showToast('Permiso de ubicaci\u00f3n denegado. Puedes elegir la estaci\u00f3n en el mapa.');
        return;
      }
      if (manual) showToast('No se pudo obtener la ubicaci\u00f3n en este momento');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

/* Al cargar: se pide salvo que el administrador lo haya desactivado o que
   esta persona ya lo haya negado antes. */
function ubicarAlCargar() {
  if (state.settings?.usarUbicacion === false) return;
  let previo = null;
  try {
    previo = localStorage.getItem(CLAVE_UBICACION);
  } catch {
    previo = null;
  }
  if (previo === 'negada') return;
  pedirUbicacion(false);
}

/* ---------- Intervalo de lectura ----------
   Manda lo que el administrador elija en Configuracion; si nunca lo ha
   tocado, se usa lo que diga config.js. */
function intervaloDeMuestreo() {
  const guardado = state?.settings?.intervaloMinutos;
  if (guardado != null && Number.isFinite(Number(guardado))) return Number(guardado);
  return Number(CFG_ESTACIONES.refrescoMinutos) || 0;
}

let relojDeMuestreo = null;

function aplicarIntervaloDeMuestreo() {
  if (relojDeMuestreo) {
    clearInterval(relojDeMuestreo);
    relojDeMuestreo = null;
  }
  const minutos = intervaloDeMuestreo();
  if (minutos > 0) {
    relojDeMuestreo = setInterval(() => syncRealStationsFromUtmApi(false), minutos * 60000);
  }
}

/* ---------- Archivo de muestreo ----------
   Mientras no hay servidor, un proceso externo puede ir escribiendo lecturas
   en un JSON junto al sitio. Se cargan al arrancar y se fusionan con lo que
   el navegador haya guardado, sin duplicar marcas de tiempo. Son mediciones
   reales, asi que no llevan ninguna advertencia. */
async function cargarArchivoMuestreo() {
  const ruta = CFG_HISTORICO.archivoMuestreo;
  if (!ruta) return 0;
  try {
    const res = await fetch(ruta, { cache: 'no-store' });
    if (!res.ok) return 0;
    const datos = await res.json();
    const todo = leerHistoricoLocal();
    let nuevas = 0;

    Object.entries(datos || {}).forEach(([estacion, filas]) => {
      if (!Array.isArray(filas)) return;
      const actual = todo[estacion] || [];
      const vistas = new Set(actual.map((r) => r.t));
      filas.forEach((r) => {
        if (!r || !r.t || vistas.has(r.t)) return;
        actual.push(r);
        vistas.add(r.t);
        nuevas += 1;
      });
      actual.sort((a, b) => (a.t < b.t ? -1 : 1));
      const tope = Number(CFG_HISTORICO.maximoRegistrosPorEstacion) || 2000;
      todo[estacion] = actual.slice(-tope);
    });

    if (nuevas) {
      localStorage.setItem(CLAVE_HISTORICO, JSON.stringify(todo));
      patronPorEstacion.clear();
      historicoDelServidor = null;
      refrescarDatos();
    }
    return nuevas;
  } catch {
    return 0;
  }
}

/* ---------- Datos de ensayo ----------
   Siembra 48 horas de lecturas SIMULADAS para todas las estaciones y
   variables, para poder ver el patron y el historico antes de que exista el
   servicio. Se activa con historico.datosDeEnsayo en config.js y la interfaz
   lo advierte mientras este puesto. Nunca se mezcla con datos medidos: si la
   estacion ya tiene serie propia, no se toca. */
const CLAVE_ENSAYO = 'utm-meteonet-ensayo-v1';

function hayDatosDeEnsayo() {
  try {
    return localStorage.getItem(CLAVE_ENSAYO) === '48h';
  } catch {
    return false;
  }
}

function sembrarDatosDeEnsayo() {
  if (!CFG_HISTORICO.datosDeEnsayo || hayDatosDeEnsayo()) return;

  const PASO_MIN = 30;
  const MUESTRAS = (48 * 60) / PASO_MIN;
  const ahora = Date.now();
  const todo = leerHistoricoLocal();

  state.stations.forEach((st, indice) => {
    if ((todo[st.id] || []).length) return; // respetar lo ya medido

    /* Se parte de la lectura real de la estacion y se construye un ciclo
       diario verosimil alrededor de ella. */
    const tBase = num(st.temperature, 25);
    const hBase = num(st.humidity, 90);
    const pBase = num(st.pressure, 1013);
    const vBase = num(st.windSpeed, 1.5);
    const desfase = indice * 0.7;
    const serie = [];

    for (let i = MUESTRAS - 1; i >= 0; i -= 1) {
      const t = new Date(ahora - i * PASO_MIN * 60000);
      const hora = t.getHours() + t.getMinutes() / 60;
      const ciclo = Math.sin(((hora - 9) / 24) * Math.PI * 2);
      const dia = Math.floor(i / (24 * (60 / PASO_MIN)));
      const ruido = (x) => Math.sin(i * x + desfase) * 0.5;

      const esDia = hora > 6 && hora < 18;
      const solar = esDia ? Math.max(0, Math.sin(((hora - 6) / 12) * Math.PI)) : 0;
      const lluvia = hora > 14.5 && hora < 17.5 && (i + indice) % 7 < 3 ? Number((Math.random() * 3.2).toFixed(1)) : 0;

      serie.push({
        t: t.toISOString(),
        temp: Number((tBase + ciclo * 4.2 + ruido(0.9) - dia * 0.4).toFixed(1)),
        hum: Math.min(99, Math.max(55, Number((hBase - ciclo * 9 + ruido(1.3) * 2).toFixed(1)))),
        prec: lluvia,
        vel: Number(Math.max(0, vBase + solar * 2.1 + ruido(0.6)).toFixed(1)),
        dir: Math.round((200 + Math.sin(i / 9 + desfase) * 70 + 360) % 360),
        rad: Math.round(solar * 880),
        uv: Number((solar * 9).toFixed(1)),
        pres: Number((pBase + Math.sin(hora / 3.8) * 1.6 + ruido(0.4) * 0.6).toFixed(1)),
      });
    }
    todo[st.id] = serie;
  });

  try {
    localStorage.setItem(CLAVE_HISTORICO, JSON.stringify(todo));
    localStorage.setItem(CLAVE_ENSAYO, '48h');
  } catch {
    /* almacenamiento lleno: los datos de ensayo son prescindibles */
  }
}

/* ---------- Avisos de origen de los datos ----------
   La interfaz debe dejar claro cuando lo que se ve no viene del servidor. */
function actualizarAvisoDeOrigen() {
  const aviso = $('#avisoOrigenDatos');
  if (!aviso) return;

  const partes = [];
  if (hayConexionEstaciones !== true) {
    partes.push(
      urlEstaciones(CFG_ESTACIONES.rutaListado)
        ? 'Sin conexi\u00f3n con el servidor de estaciones: se muestran las \u00faltimas lecturas conocidas.'
        : 'Servicio de estaciones no configurado: se muestran las \u00faltimas lecturas tomadas del observatorio.'
    );
  }
  if (CFG_HISTORICO.datosDeEnsayo && hayDatosDeEnsayo()) {
    partes.push('El hist\u00f3rico y el patr\u00f3n de 24 horas usan 48 horas de datos SIMULADOS para pruebas (historico.datosDeEnsayo en config.js).');
  }

  aviso.hidden = partes.length === 0;
  aviso.textContent = partes.join(' ');
}

/* ---------- Sincronizacion con el servicio de estaciones ----------
   El destino, las cabeceras, los nombres de campo y las unidades se definen
   en config.js. Si no hay baseUrl configurada no se intenta la conexion y la
   aplicacion sigue con las lecturas de ejemplo. */
let hayConexionEstaciones = null; // null = aun no se ha intentado

async function syncRealStationsFromUtmApi(showFeedback = false) {
  const urlListado = urlEstaciones(CFG_ESTACIONES.rutaListado);
  if (!urlListado) {
    hayConexionEstaciones = false;
    actualizarAvisoDeOrigen();
    if (showFeedback) showToast('No hay servicio de estaciones configurado');
    return;
  }

  try {
    const headers = CFG_ESTACIONES.cabeceras || {};
    const stationsRes = await fetch(urlListado, { headers });
    if (!stationsRes.ok) throw new Error('HTTP ' + stationsRes.status);
    const stationsJson = await stationsRes.json();
    const apiStations = stationsJson?.data || [];
    if (!apiStations.length) throw new Error('El servicio no devolvio estaciones');

    const updatedStations = await Promise.all(
      apiStations.map(async (st) => {
        const sid = st[CAMPOS.id];
        const existing = state.stations.find((x) => x.id === sid || x.stationId === sid) || {};
        const base = {
          id: sid,
          stationId: sid,
          code: st[CAMPOS.codigo],
          name: `${st[CAMPOS.ubicacion]} \u00b7 ${st[CAMPOS.codigo]}`,
          location: st[CAMPOS.ubicacion],
          canton: st[CAMPOS.ubicacion],
          owner: existing.owner || 'UTM',
          ownerLogo: existing.ownerLogo || 'assets/images/logo_utm_escudo.png',
          driver: st[CAMPOS.driver] || 'weatherlink',
          latitude: Number(st[CAMPOS.latitud]),
          longitude: Number(st[CAMPOS.longitud]),
          status: 'Activa',
        };

        try {
          const urlDetalle = `${urlEstaciones(CFG_ESTACIONES.rutaDetalle)}?stationId=${encodeURIComponent(sid)}`;
          const infoRes = await fetch(urlDetalle, { headers });
          if (!infoRes.ok) throw new Error('HTTP ' + infoRes.status);
          const infoJson = await infoRes.json();
          const record = infoJson?.data?.[0];
          const m = record?.meteorological?.[0] || {};
          const b = record?.barometer?.[0] || {};
          const leer = (clave) => leerCampo(record, m, b, clave);

          /* Un campo ausente queda en null y la interfaz muestra "Sin dato".
             Antes se rellenaba con la lectura anterior o con una constante,
             lo que presentaba como medido algo que no se habia medido. */
          const tempC = aUnidadInterna(leer('temperatura'), 'temperatura');
          const lectura = {
            ...base,
            temperature: tempC,
            tempMin: aUnidadInterna(leer('temperaturaMin'), 'temperatura'),
            tempMax: aUnidadInterna(leer('temperaturaMax'), 'temperatura'),
            feelsLike: aUnidadInterna(leer('sensacion'), 'temperatura') ?? tempC,
            humidity: numeroOnulo(leer('humedad'), 1),
            windSpeed: aUnidadInterna(leer('vientoVelocidad'), 'viento'),
            windDir: numeroOnulo(leer('vientoDireccion'), 0),
            radiation: numeroOnulo(leer('radiacion'), 0),
            uvIndex: numeroOnulo(leer('indiceUv'), 1),
            precipitation: aUnidadInterna(leer('lluviaTasa'), 'lluvia'),
            rainDaily: aUnidadInterna(leer('lluviaDiaria'), 'lluvia'),
            rain24h: aUnidadInterna(leer('lluvia24h'), 'lluvia'),
            rainYear: aUnidadInterna(leer('lluviaAnual'), 'lluvia'),
            pressure: aUnidadInterna(leer('presion'), 'presion'),
            updatedAt: leer('fechaLectura') || new Date().toISOString(),
          };
          guardarLecturaEnHistorico(lectura);
          return lectura;
        } catch {
          /* La estacion existe pero su lectura fallo: se conserva lo ultimo
             conocido y se marca para que la interfaz no lo presente como
             dato fresco. */
          return { ...existing, ...base, status: 'Sin lectura' };
        }
      })
    );

    state.stations = updatedStations;
    if (!state.stations.some((s) => s.id === state.selectedStationId)) {
      state.selectedStationId = idEstacionPorDefecto(state.stations);
    }
    hayConexionEstaciones = true;
    saveState();
    refrescarDatos();
    actualizarAvisoDeOrigen();
    if (showFeedback) showToast('Lecturas actualizadas desde el servidor');
  } catch (err) {
    hayConexionEstaciones = false;
    actualizarAvisoDeOrigen();
    if (showFeedback) showToast('Sin conexion con el servidor: se muestra la ultima lectura conocida');
  }
}

/* Numero o null, sin inventar un valor por defecto */
function numeroOnulo(valor, decimales = 1) {
  if (valor == null || valor === '' || valor === -1) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, decimales);
  return Math.round(n * f) / f;
}


/* Comparadores disponibles al configurar una regla */
const OPERADORES = {
  '>': { simbolo: '>', etiqueta: 'mayor que', prueba: (v, u) => v > u },
  '>=': { simbolo: '\u2265', etiqueta: 'mayor o igual que', prueba: (v, u) => v >= u },
  '<': { simbolo: '<', etiqueta: 'menor que', prueba: (v, u) => v < u },
  '<=': { simbolo: '\u2264', etiqueta: 'menor o igual que', prueba: (v, u) => v <= u },
};

/* Variables que una regla puede vigilar */
const VARIABLES_ALERTA = ['temperature', 'humidity', 'precipitation', 'pressure', 'windSpeed', 'radiation', 'uvIndex'];

function operadorDe(a) {
  return OPERADORES[a.operator] || OPERADORES['>'];
}

function calculateAlerts(station = currentStation()) {
  return state.alerts
    .filter((a) => a.active)
    .map((a) => {
      const reading = Number(station[a.condition] ?? 0);
      const threshold = Number(a.value);
      const op = operadorDe(a);
      return {
        ...a,
        reading,
        unit: VARIABLE_UNITS[a.condition] || '',
        station,
        operador: op,
        triggered: op.prueba(reading, threshold),
      };
    });
}

/* Frase corta que explica una alerta disparada:
   "Temperatura alta: 33.2 °C, por encima del umbral de 31 °C". */
function describirAlerta(a) {
  const lectura = Number(a.reading);
  const umbral = Number(a.value);
  const valor = Number.isFinite(lectura) ? Math.round(lectura * 10) / 10 : a.reading;
  const unidad = a.unit ? ` ${a.unit}` : '';
  const sentido = (a.operator || '>').startsWith('<') ? 'por debajo del l\u00edmite de' : 'por encima del l\u00edmite de';
  return `${a.type}: ${valor}${unidad}, ${sentido} ${umbral}${unidad}`;
}

/* Panel desplegable con el detalle de las alertas activas de una estacion */
function construirDetalleAlertas(st, alertas) {
  const titulo = alertas.length === 1 ? '1 alerta activa' : `${alertas.length} alertas activas`;
  const filas = alertas
    .map(
      (a) => `<span class="mad-fila">
          <b>${escapeHtml(a.type)}</b>
          <span>${escapeHtml(String(Math.round(Number(a.reading) * 10) / 10))} ${escapeHtml(a.unit || '')} \u00b7 umbral &gt; ${escapeHtml(String(a.value))} ${escapeHtml(a.unit || '')}</span>
        </span>`
    )
    .join('');
  return `<span class="mei-alerta-detalle" role="tooltip">
      <span class="mad-cab">\u26a0\ufe0f ${escapeHtml(titulo)} \u00b7 ${escapeHtml(st.location)}</span>
      ${filas}
    </span>`;
}

/* ---------- Cabecera del Sitio Web ---------- */

function renderHeader() {
  const station = currentStation();
  $all('.admin-only-nav').forEach((el) => {
    el.hidden = !isAdmin();
  });

  const triggeredCount = calculateAlerts(station).filter((a) => a.triggered).length;
  const navAlertBadge = $('#navAlertBadge');
  if (navAlertBadge) {
    navAlertBadge.textContent = triggeredCount;
    navAlertBadge.hidden = !isAdmin() || triggeredCount === 0;
  }

  $('#accessButton').hidden = isAdmin();
  const adminMenuWrap = $('#adminMenuWrap');
  if (adminMenuWrap) adminMenuWrap.hidden = !isAdmin();
  if (!isAdmin()) closeAdminMenu();
  const adminMenuBadge = $('#adminMenuBadge');
  if (adminMenuBadge) {
    adminMenuBadge.textContent = triggeredCount;
    adminMenuBadge.hidden = !isAdmin() || triggeredCount === 0;
  }
  const adminBadge = $('#adminStatusBadge');
  if (adminBadge) {
    adminBadge.textContent = state.settings.adminName || 'Administrador';
  }
  const adminBtnTxt = $('#adminMenuBtn .nav-ico-txt');
  if (adminBtnTxt) {
    adminBtnTxt.textContent = state.settings.adminName || 'Administrador';
  }
}

/* ---------- Textos y condiciones climáticas idénticos al sitio oficial MeteoNet ---------- */
const WEATHER_CONDITIONS = {
  soleado: { text: 'Soleado', icon: 'assets/images/soleado.png' },
  nublado: { text: 'Nublado', icon: 'assets/images/nublado.png' },
  parcialNublado: { text: 'Nublado', icon: 'assets/images/nublado.png' },
  lluvia: { text: 'Lluvia', icon: 'assets/images/lluvia.png' },
  tormenta: { text: 'Tormenta', icon: 'assets/images/tormenta.png' },
  despejadoNoche: { text: 'Despejado', icon: 'assets/images/noche.png' },
  nocheNublada: { text: 'Nublado', icon: 'assets/images/nublado-noche.png' },
};

function getStationWeatherCondition(station) {
  const rain = Number(station.precipitation ?? 0);
  const rad = Number(station.radiation ?? 0);
  if (rain >= 10) return WEATHER_CONDITIONS.tormenta;
  if (rain > 0) return WEATHER_CONDITIONS.lluvia;
  if (rad < 50) return WEATHER_CONDITIONS.nublado;
  if (rad < 200) return WEATHER_CONDITIONS.parcialNublado;
  return WEATHER_CONDITIONS.soleado;
}

function formatOfficialDate(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (EC)`;
  } catch {
    return String(value);
  }
}

function obtenerTextoPrecipitacion(precipitacion) {
  const p = Number(precipitacion || 0);
  if (p <= 0) return '';
  if (p <= 2) return 'Lluvia ligera';
  if (p <= 10) return 'Lluvia moderada';
  if (p <= 50) return 'Lluvia fuerte';
  return 'Tormenta intensa';
}

function obtenerTextoRadiacion(solar) {
  const s = Number(solar || 0);
  if (s <= 200) return 'Muy baja';
  if (s <= 600) return 'Moderada';
  if (s <= 900) return 'Alta';
  return 'Extrema';
}

function obtenerTextoUv(uv) {
  const u = Number(uv || 0);
  if (u <= 2) return 'Bajo';
  if (u <= 5) return 'Moderado';
  if (u <= 7) return 'Alto';
  if (u <= 10) return 'Muy Alto';
  return 'Extremo';
}


/* Rumbo cardinal a partir de los grados de procedencia del viento */
function rumboCardinal(grados) {
  const puntos = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return puntos[Math.round((((grados % 360) + 360) % 360) / 22.5) % 16];
}

/* Angulo de la aguja del barometro, de -90 (baja) a +90 (alta).
   Las estaciones reportan en pulgadas de mercurio, pero se admite hPa
   por si la fuente cambia de unidad. */
function anguloPresion(valor) {
  const v = Number(valor);
  if (!Number.isFinite(v)) return 0;
  const [min, max] = v > 200 ? [980, 1040] : [28.5, 31];
  const prop = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return prop * 180 - 90;
}

/* ---------- VISTA PRINCIPAL: MEDICIÓN ACTUAL Y MAPA ---------- */
function renderDashboard() {
  const station = currentStation();
  const cond = getStationWeatherCondition(station);

  /* Resumen inicial oficial idéntico a la imagen de MeteoNet */
  const heroUpdated = $('#heroUpdatedAt');
  if (heroUpdated) heroUpdated.textContent = formatOfficialDate(station.updatedAt);

  const heroIcon = $('#heroWeatherIcon');
  if (heroIcon) {
    heroIcon.src = cond.icon;
    heroIcon.alt = cond.text;
  }

  const heroLoc = $('#heroStationLocation');
  if (heroLoc) heroLoc.textContent = station.location;

  const heroTemp = $('#heroTempValue');
  if (heroTemp) heroTemp.textContent = formatTemp(station.temperature);

  const heroCond = $('#heroConditionText');
  if (heroCond) heroCond.textContent = cond.text;

  const heroFeels = $('#heroFeelsLike');
  if (heroFeels) heroFeels.textContent = formatTemp(station.feelsLike ?? station.temperature);

  const heroMax = $('#heroTempMax');
  if (heroMax) heroMax.textContent = formatTemp(station.tempMax ?? station.temperature);

  const heroMin = $('#heroTempMin');
  if (heroMin) heroMin.textContent = formatTemp(station.tempMin ?? station.temperature);

  /* Las 6 variables reales de la estación con el diseño exacto de la imagen */
  const humVal = station.humidity;
  const humWidth = Math.min(100, Math.max(0, num(station.humidity)));

  const rainVal = num(station.precipitation);
  /* Escala con ra\u00edz cuadrada hasta 50 mm: con la escala lineal anterior
     una lluvia de 0.2 mm ocupaba el 0.2 % de la barra y no se ve\u00eda nada. */
  const rainWidth = rainVal > 0 ? Math.min(100, Math.sqrt(Math.min(rainVal, 50) / 50) * 100) : 0;
  const rainText = obtenerTextoPrecipitacion(rainVal);

  const pressVal = station.pressure;
  const pressAngle = anguloPresion(num(pressVal, 1013));

  const windVal = num(station.windSpeed);
  const windDir = ((Number(station.windDir || 0) % 360) + 360) % 360;
  const hayViento = windVal > 0;
  const windCardinal = rumboCardinal(windDir);

  const solarVal = station.radiation == null ? null : Math.round(Number(station.radiation));
  const solarWidth = solarVal == null ? 0 : Math.min(100, Math.max(0, (solarVal / 1200) * 100));
  const solarColor = solarVal < 200 ? '#ffecb3' : solarVal < 600 ? '#ffb74d' : solarVal < 900 ? '#ff7043' : '#f44336';
  const solarText = solarVal == null ? '' : obtenerTextoRadiacion(solarVal);

  const uvVal = station.uvIndex != null && station.uvIndex !== -1 ? Number(station.uvIndex) : null;
  /* El \u00edndice UV va de 0 a 11+, no a 15 */
  const uvLeft = uvVal == null ? 6 : Math.min(94, Math.max(6, (Math.min(uvVal, 12) * 100) / 12));
  const uvText = uvVal == null ? '' : obtenerTextoUv(uvVal);

  $('#stationMetricsCards').innerHTML = `
    <!-- 1. Humedad -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/humedad.png" alt="Humedad" class="rv-icono" />
        <span class="rv-titulo">Humedad</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor">${fmt(humVal, '%', 0)}</span>
        <div class="rv-barra-pista">
          <div class="rv-barra-humedad" style="width:${humWidth}%"></div>
        </div>
      </div>
    </article>

    <!-- 2. Precipitación -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/precipitacion.png" alt="Precipitación" class="rv-icono" />
        <span class="rv-titulo">Precipitación</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor">${fmt(station.precipitation, 'mm')}</span>
        <div class="rv-barra-pista">
          <div class="rv-barra-lluvia" style="width:${rainWidth}%"></div>
        </div>
        <div class="rv-subtexto">${station.precipitation == null ? '' : escapeHtml(rainText)}</div>
      </div>
    </article>

    <!-- 3. Presión atmosférica -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/presion-atmosferica.png" alt="Presión atmosférica" class="rv-icono" />
        <span class="rv-titulo">Presión atmosférica</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor-med">${fmt(pressVal, 'hPa')}</span>
      </div>
      <div class="rv-gauge-wrap">
        <svg viewBox="0 0 100 60" class="rv-gauge-svg">
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#ccc" stroke-width="6"></path>
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#ff8c1a" stroke-width="6" stroke-linecap="round"
            pathLength="100" stroke-dasharray="${(((pressAngle + 90) / 180) * 100).toFixed(1)} 100"></path>
          <line x1="50" y1="50" x2="50" y2="14" stroke="#ff8c1a" stroke-width="3.2" stroke-linecap="round" transform="rotate(${pressAngle.toFixed(1)} 50 50)"></line>
          <circle cx="50" cy="50" r="3.2" fill="#ff8c1a"></circle>
          <text x="0" y="58" font-size="8" fill="white">Baja</text>
          <text x="82" y="58" font-size="8" fill="white">Alta</text>
        </svg>
      </div>
    </article>

    <!-- 4. Velocidad del viento -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/velocidad-viento.png" alt="Velocidad del viento" class="rv-icono" />
        <span class="rv-titulo">Velocidad del viento</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor-med">${fmt(station.windSpeed, 'm/s')}</span>
      </div>
      <div class="rv-brujula-wrap">
        <div class="rv-brujula ${hayViento ? '' : 'sin-viento'}"
          title="${hayViento ? `Viento de ${windVal.toFixed(1)} m/s desde el ${escapeHtml(windCardinal)} (${windDir}\u00b0)` : 'Sin viento'}">
          <span class="rv-dir rv-n">N</span>
          <span class="rv-dir rv-s">S</span>
          <span class="rv-dir rv-o">O</span>
          <span class="rv-dir rv-e">E</span>
          <svg viewBox="0 0 100 100" class="rv-aguja" style="transform:rotate(${windDir}deg)">
            <polygon points="50,8 41,56 59,56" fill="currentColor"></polygon>
            <polygon points="50,92 43,58 57,58" fill="currentColor" opacity=".3"></polygon>
          </svg>
        </div>
      </div>
      <div class="rv-subtexto">${hayViento ? `Desde el ${escapeHtml(windCardinal)}` : 'Sin viento'}</div>
    </article>

    <!-- 5. Radiación solar -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/radiacion.png" alt="Radiación solar" class="rv-icono" />
        <span class="rv-titulo">Radiación solar</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor-med">${fmt(solarVal, 'W/m²', 0)}</span>
        <div class="rv-barra-pista">
          <div style="height:100%;border-radius:999px;width:${solarWidth}%;background:${solarColor}"></div>
        </div>
        <div class="rv-subtexto">${solarVal == null ? '' : escapeHtml(solarText)}</div>
      </div>
    </article>

    <!-- 6. Índice UV -->
    <article class="recuadro-variable">
      <div class="rv-cab">
        <img src="assets/images/uv.png" alt="Índice UV" class="rv-icono" />
        <span class="rv-titulo">Índice UV</span>
      </div>
      <div class="rv-cuerpo">
        <span class="rv-valor-med" style="-webkit-text-stroke:0">${uvVal == null ? SIN_DATO : escapeHtml(uvText)}</span>
        <div class="rv-uv-pista">
          <div class="rv-uv-indicador" style="left:${uvLeft}%">${uvVal == null ? '?' : Math.round(uvVal)}</div>
        </div>
      </div>
    </article>
  `;

  renderMapControlsAndList();
  renderMainWeatherMap();
}

/* Iconos minimalistas SVG para cada variable de la ventana contextual del mapa */
const MINIMAL_VAR_ICONS = {
  humidity: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  precipitation: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><path d="M16 14v6M8 14v6M12 16v6"/></svg>`,
  pressure: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/><circle cx="12" cy="12" r="1"/></svg>`,
  windSpeed: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>`,
  radiation: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>`,
  uvIndex: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="11" r="2.5"/></svg>`,
};

/* ---------- Patron de las ultimas 24 horas en la ficha del mapa ----------
   Una fila por variable, con la curva de las ultimas 24 horas y su rango.
   Se dibuja con lo medido: no hay pronostico ni relleno sintetico. */

/* La mejor serie disponible sin esperar: la del servidor si ya esta en
   memoria para esa estacion, y si no el respaldo del navegador. */
function serieMejorDisponible(stationId) {
  if (historicoDelServidor && historicoDelServidor.clave.startsWith(stationId + '|')) {
    return historicoDelServidor.filas;
  }
  return serieHistorica(stationId);
}

/* Variables del patron, en el mismo orden que la rejilla de mediciones */
/* Mismo orden y mismos nombres que las pastillas de medicion de la portada,
   abreviando los dos que no caben en el ancho de la ficha. El titulo completo
   queda en el atributo title.
   Los colores salen de la paleta institucional: verde UTM, verde lima y
   amarillo, para que el conjunto se lea como una sola familia grafica. */
const VARIABLES_PATRON = [
  { campo: 'temperature', etiqueta: 'Temperatura', completo: 'Temperatura', unidad: '\u00b0C', dec: 1, color: '#1e6b14' },
  { campo: 'humidity', etiqueta: 'Humedad', completo: 'Humedad', unidad: '%', dec: 0, color: '#2e8a1f' },
  { campo: 'precipitation', etiqueta: 'Precipitaci\u00f3n', completo: 'Precipitaci\u00f3n', unidad: 'mm', dec: 1, color: '#4aab30' },
  { campo: 'pressure', etiqueta: 'Presi\u00f3n atm.', completo: 'Presi\u00f3n atmosf\u00e9rica', unidad: 'hPa', dec: 1, color: '#72c255' },
  { campo: 'windSpeed', etiqueta: 'Vel. viento', completo: 'Velocidad del viento', unidad: 'm/s', dec: 1, color: '#8cc63f' },
  { campo: 'radiation', etiqueta: 'Radiaci\u00f3n solar', completo: 'Radiaci\u00f3n solar', unidad: 'W/m\u00b2', dec: 0, color: '#d4a80a' },
  { campo: 'uvIndex', etiqueta: '\u00cdndice UV', completo: '\u00cdndice UV', unidad: '', dec: 1, color: '#b8920a' },
];

/* Recorta la serie a las ultimas 24 horas, de la mas antigua a la mas
   reciente, para que la curva avance de izquierda a derecha como el tiempo */
function serie24h(serie) {
  const corte = Date.now() - 24 * 3600000;
  return serie
    .filter((r) => r.timestamp instanceof Date && r.timestamp.getTime() >= corte)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/* Curva compacta con area. Cada variable se escala a su propio rango,
   porque comparten fila pero no magnitud. */
function miniCurva(valores, color) {
  const ancho = 104;
  const alto = 24;
  if (!valores.length) return `<svg width="${ancho}" height="${alto}" aria-hidden="true"></svg>`;

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const puntos = valores.length === 1 ? [valores[0], valores[0]] : valores;
  const paso = ancho / (puntos.length - 1);
  const y = (v) => alto - 3 - ((v - min) / rango) * (alto - 7);
  const coords = puntos.map((v, i) => `${(i * paso).toFixed(1)},${y(v).toFixed(1)}`);
  const linea = 'M ' + coords.join(' L ');
  const area = `${linea} L ${ancho},${alto} L 0,${alto} Z`;
  const id = 'g' + Math.random().toString(36).slice(2, 8);

  return `
    <svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none"
      class="mfp-curva" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.30" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})" />
      <path d="${linea}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
}

/* El patron se pide una vez por estacion y se guarda en memoria. La ficha se
   dibuja de forma sincrona, asi que cuando hay que consultar al servidor se
   muestra un aviso de carga y se rellena al llegar la respuesta. */
const patronPorEstacion = new Map();
const patronEnCurso = new Set();

function contenidoPatron(serie) {
  const filas24 = serie24h(serie);

  if (filas24.length < 2) {
    return `<div class="mfe-patron-cab"><span>\u00daltimas 24 horas</span></div>
      <p class="mfe-patron-vacio">Todav\u00eda no hay lecturas suficientes de las \u00faltimas 24 horas.</p>`;
  }

  const filas = VARIABLES_PATRON.map((v) => {
    const valores = filas24.map((r) => r[v.campo]).filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
    if (!valores.length) {
      return `
        <div class="mfp-fila">
          <span class="mfp-dia" title="${escapeHtml(v.completo)}">${escapeHtml(v.etiqueta)}</span>
          <span class="mfp-sin">Sin dato</span>
        </div>`;
    }
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const rango =
      min === max
        ? `${min.toFixed(v.dec)}`
        : `${min.toFixed(v.dec)} \u2013 ${max.toFixed(v.dec)}`;
    return `
      <div class="mfp-fila">
        <span class="mfp-dia" title="${escapeHtml(v.completo)}">${escapeHtml(v.etiqueta)}</span>
        ${miniCurva(valores, v.color)}
        <span class="mfp-rango">${rango} <small>${escapeHtml(v.unidad)}</small></span>
      </div>`;
  }).join('');

  const desde = filas24[0].timestamp;
  return `
    <div class="mfe-patron-cab">
      <span>\u00daltimas 24 horas</span>
      <small>${filas24.length} lecturas desde ${formatHora(desde)}</small>
    </div>
    ${filas}`;
}

function formatHora(fecha) {
  try {
    return new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit' }).format(fecha);
  } catch {
    return '';
  }
}

async function pedirPatron(stationId) {
  if (patronEnCurso.has(stationId)) return;
  patronEnCurso.add(stationId);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 24 * 3600000);
  const filas = await cargarHistoricoDelServidor(stationId, desde, hasta);
  patronEnCurso.delete(stationId);
  if (!filas) return;

  patronPorEstacion.set(stationId, filas);
  const nodo = document.querySelector(`.mfe-patron[data-estacion="${stationId}"]`);
  if (nodo) nodo.innerHTML = contenidoPatron(filas);
}

function construirPatronDias(st) {
  const envoltura = (interior) => `<div class="mfe-patron" data-estacion="${escapeHtml(st.id)}">${interior}</div>`;

  const cacheado = patronPorEstacion.get(st.id);
  if (cacheado) return envoltura(contenidoPatron(cacheado));

  /* Primero lo que ya hay sin pedir nada */
  const local = serieMejorDisponible(st.id);
  if (serie24h(local).length >= 2) {
    patronPorEstacion.set(st.id, local);
    return envoltura(contenidoPatron(local));
  }

  if (CFG_HISTORICO.baseUrl) {
    pedirPatron(st.id);
    return envoltura(`
      <div class="mfe-patron-cab"><span>\u00daltimas 24 horas</span></div>
      <p class="mfe-patron-vacio">Consultando el hist\u00f3rico\u2026</p>`);
  }

  return envoltura(`
    <div class="mfe-patron-cab"><span>\u00daltimas 24 horas</span></div>
    <p class="mfe-patron-vacio">Se mostrar\u00e1 cuando haya lecturas de las \u00faltimas 24 horas. Configura el servicio de hist\u00f3rico en config.js para verlo desde la primera visita.</p>`);
}

/* Construye la ventana contextual compacta de una estación al hacer clic en el mapa */
function buildStationMeasurementCardHtml(st) {
  const cond = getStationWeatherCondition(st);
  const uvVal = st.uvIndex != null && st.uvIndex !== -1 ? Math.round(Number(st.uvIndex)) : null;
  const uvTxt = uvVal == null ? '' : obtenerTextoUv(uvVal);

  return `
    <div class="mapa-ficha-estacion">
      <div class="mfe-actualizacion">
        Última actualización: ${escapeHtml(formatOfficialDate(st.updatedAt))}
      </div>
      <div class="mfe-fila-principal">
        <img src="${cond.icon}" alt="${escapeHtml(cond.text)}" class="mfe-icono" />
        <div class="mfe-col-info">
          <div class="mfe-nombre">${escapeHtml(st.location)} <span class="mfe-cod-badge">${escapeHtml(st.code || st.name)}</span></div>
          <div class="mfe-condicion">${escapeHtml(cond.text)}</div>
        </div>
        <div class="mfe-temp">${formatTemp(st.temperature)}<span>°C</span></div>
      </div>
      <div class="mfe-subresumen">
        Sensación ${formatTemp(st.feelsLike ?? st.temperature)}°C · Máx. ${formatTemp(st.tempMax ?? st.temperature)}°C · Mín. ${formatTemp(st.tempMin ?? st.temperature)}°C
      </div>
      <hr class="mfe-separador" />
      <div class="mfe-grid-mediciones">
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.humidity}</span>
          <div class="mfe-med-txt"><small>Humedad</small><span>${fmt(st.humidity, '%', 0)}</span></div>
        </div>
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.precipitation}</span>
          <div class="mfe-med-txt"><small>Precipitación</small><span>${fmt(st.precipitation, 'mm')}</span></div>
        </div>
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.pressure}</span>
          <div class="mfe-med-txt"><small>Presión atmosférica</small><span>${fmt(st.pressure, 'hPa')}</span></div>
        </div>
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.windSpeed}</span>
          <div class="mfe-med-txt"><small>Velocidad del viento</small><span>${fmt(st.windSpeed, 'm/s')}</span></div>
        </div>
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.radiation}</span>
          <div class="mfe-med-txt"><small>Radiación solar</small><span>${fmt(st.radiation, 'W/m²', 0)}</span></div>
        </div>
        <div class="mfe-med-item">
          <span class="mfe-ico-min">${MINIMAL_VAR_ICONS.uvIndex}</span>
          <div class="mfe-med-txt"><small>Índice UV</small><span>${uvVal == null ? SIN_DATO : escapeHtml(uvTxt) + ' (' + uvVal + ')'}</span></div>
        </div>
      </div>
      ${construirPatronDias(st)}
    </div>
  `;
}

function renderMapControlsAndList() {
  const cantons = [...new Set(state.stations.map((s) => s.location))].sort();

  $('#stationsTotalNote').textContent = `${state.stations.length} activas`;

  const q = quickStationSearchQuery.trim().toLowerCase();
  const filtered = state.stations.filter(
    (st) => !q || st.location.toLowerCase().includes(q) || (st.code || '').toLowerCase().includes(q)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / quickStationPageSize));
  if (quickStationPage > totalPages) quickStationPage = totalPages;
  if (quickStationPage < 1) quickStationPage = 1;

  const startIndex = (quickStationPage - 1) * quickStationPageSize;
  const pageStations = filtered.slice(startIndex, startIndex + quickStationPageSize);

  const listEl = $('#mapStationQuickList');
  if (listEl) {
    if (!pageStations.length) {
      listEl.innerHTML = `<div class="plm-vacio">No se encontraron estaciones</div>`;
    } else {
      listEl.innerHTML = pageStations
        .map((st) => {
          const isSelected = st.id === state.selectedStationId;
          const ownerName = st.owner || 'UTM';
          const ownerLogo = st.ownerLogo || 'assets/images/logo_utm_escudo.png';
          return `
            <button type="button" class="zona ${isSelected ? 'activa' : 'inactiva'}" data-quick-station="${st.id}">
              <span class="n n-logo" title="Institución propietaria: ${escapeHtml(ownerName)}">
                <img src="${escapeHtml(ownerLogo)}" alt="${escapeHtml(ownerName)}" class="zona-logo-inst" />
              </span>
              <span class="zona-detalles">
                <b class="zona-nombre">${escapeHtml(st.location)}</b>
                <span class="zona-codigo">${escapeHtml(st.code || st.name)}</span>
                <small class="nota zona-extremos">Máx ${st.tempMax ?? st.temperature}° / Mín ${st.tempMin ?? st.temperature}°</small>
              </span>
              <b class="zona-temp">${st.temperature} °C</b>
            </button>`;
        })
        .join('');
    }
  }

  const pagerEl = $('#quickStationPager');
  if (pagerEl) {
    if (totalPages > 1) {
      pagerEl.hidden = false;
      pagerEl.innerHTML = `
        <button type="button" class="quick-pag-btn" id="quickStationPrev" ${quickStationPage === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
        <span class="quick-pag-txt">${quickStationPage} / ${totalPages}</span>
        <button type="button" class="quick-pag-btn" id="quickStationNext" ${quickStationPage === totalPages ? 'disabled' : ''} aria-label="Página siguiente">›</button>
      `;
    } else {
      pagerEl.hidden = true;
      pagerEl.innerHTML = '';
    }
  }
}

function renderMainWeatherMap() {
  const mapEl = $('#mainWeatherMap');
  if (!mapEl || !window.L) return;

  const tileCfg = MAP_TILE_LAYERS[mapOptions.baseLayer] || MAP_TILE_LAYERS.light;

  if (!mainMap) {
    mainMap = L.map(mapEl, {
      center: [-1.05, -80.45],
      zoom: 9,
      minZoom: 8,
      maxZoom: 16,
      zoomControl: true,
    });
    mainMapTileLayer = L.tileLayer(tileCfg.url, {
      maxZoom: 16,
      attribution: tileCfg.attribution,
    }).addTo(mainMap);
    mainMapLayerGroup = L.layerGroup().addTo(mainMap);

    const bounds = state.stations.filter((s) => s.latitude && s.longitude).map((s) => [s.latitude, s.longitude]);
    if (bounds.length) {
      mainMap.fitBounds(bounds, { padding: [50, 50] });
    }
  } else if (mainMapTileLayer && mainMapTileLayer._url !== tileCfg.url) {
    mainMap.removeLayer(mainMapTileLayer);
    mainMapTileLayer = L.tileLayer(tileCfg.url, {
      maxZoom: 16,
      attribution: tileCfg.attribution,
    }).addTo(mainMap);
  }

  mainMapLayerGroup.clearLayers();

  const visibleStations = state.stations.filter((st) => {
    if (!st.latitude || !st.longitude) return false;
    if (mapOptions.canton && st.location !== mapOptions.canton) return false;
    return true;
  });

  visibleStations.forEach((st) => {
    const isSelected = st.id === state.selectedStationId;
    const triggeredAlerts = calculateAlerts(st).filter((a) => a.triggered);
    const hasActiveAlert = mapOptions.alertasMapa && triggeredAlerts.length > 0;

    const rainVal = Number(st.precipitation || 0);
    const solarVal = Number(st.radiation || 0);
    const windVal = Number(st.windSpeed || 0);

    let weatherFxHtml = '';
    let weatherChipHtml = '';
    let weatherStateClass = 'clima-normal';

    if (mapOptions.animacionClima) {
      if (rainVal >= 5) {
        weatherStateClass = 'clima-lluvia-intensa';
        weatherFxHtml = `
          <div class="mei-clima-fx lluvia-intensa" aria-hidden="true">
            <span class="mei-nube-aura"></span>
            <span class="mei-gota g1"></span>
            <span class="mei-gota g2"></span>
            <span class="mei-gota g3"></span>
            <span class="mei-gota g4"></span>
            <span class="mei-gota g5"></span>
            <span class="mei-gota g6"></span>
            <span class="mei-gota g7"></span>
            <span class="mei-gota g8"></span>
            <span class="mei-gota g9"></span>
            <span class="mei-gota g10"></span>
            <span class="mei-onda-charco oc1"></span>
            <span class="mei-onda-charco oc2"></span>
          </div>
        `;
        weatherChipHtml = `<span class="mei-clima-chip lluvia-fuerte">🌧 ${rainVal.toFixed(1)} mm</span>`;
      } else if (rainVal > 0) {
        weatherStateClass = 'clima-lluvia-ligera';
        weatherFxHtml = `
          <div class="mei-clima-fx lluvia-ligera" aria-hidden="true">
            <span class="mei-gota g1"></span>
            <span class="mei-gota g2"></span>
            <span class="mei-gota g3"></span>
            <span class="mei-gota g4"></span>
            <span class="mei-gota g5"></span>
            <span class="mei-gota g6"></span>
            <span class="mei-onda-charco oc1"></span>
          </div>
        `;
        weatherChipHtml = `<span class="mei-clima-chip lluvia-suave">💧 ${rainVal.toFixed(1)} mm</span>`;
      } else if (solarVal >= 200) {
        weatherStateClass = 'clima-soleado';
        weatherFxHtml = `
          <div class="mei-clima-fx sol-activo" aria-hidden="true">
            <span class="mei-sol-halo"></span>
            <span class="mei-sol-rayos"></span>
          </div>
        `;
      } else if (windVal >= 2) {
        weatherStateClass = 'clima-viento';
        weatherFxHtml = `
          <div class="mei-clima-fx viento-activo" aria-hidden="true">
            <span class="mei-racha r1"></span>
            <span class="mei-racha r2"></span>
            <span class="mei-racha r3"></span>
          </div>
        `;
      }
    }

    const topParts = [];
    if (mapOptions.etiquetas) topParts.push(escapeHtml(st.location));
    if (mapOptions.temperatura) topParts.push(`🌡️ ${st.temperature}°C`);
    if (mapOptions.sensacionTermica) topParts.push(`🌡️ ST ${st.feelsLike ?? st.temperature}°C`);
    const topLineHtml = topParts.length ? `<span class="mei-etq-principal">${topParts.join(' · ')}</span>` : '';
    const codeLineHtml = mapOptions.codigo ? `<small class="mei-etq-codigo">${escapeHtml(st.code || st.name)}</small>` : '';
    const humVientoHtml = mapOptions.humedadViento
      ? `<small class="mei-etq-humviento">💧 HR ${Math.round(Number(st.humidity || 0))}% · 💨 ${Math.round(Number(st.windSpeed || 0))} m/s</small>`
      : '';
    const rainLineHtml = mapOptions.lluviaMapa
      ? `<small class="mei-etq-lluvia">🌧 Lluvia: ${(st.rainDaily != null && Number(st.rainDaily) > 0 ? Number(st.rainDaily) : rainVal).toFixed(1)} mm</small>`
      : '';
    /* El aviso de alerta vive en la insignia sobre el pin, no en el rotulo:
       un solo indicador por estacion, sin repetirlo con un emoji debajo. */
    const insigniaAlertaHtml = hasActiveAlert
      ? `<span class="mei-alerta-wrap">
          <span class="mei-insignia-alerta" tabindex="0" role="button"
            aria-label="${escapeHtml(triggeredAlerts.map(describirAlerta).join('. '))}"
            title="${escapeHtml(triggeredAlerts.map(describirAlerta).join(' \u00b7 '))}">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
              stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13.5" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            ${triggeredAlerts.length > 1 ? `<b class="mei-insignia-conteo">${triggeredAlerts.length}</b>` : ''}
          </span>
          ${construirDetalleAlertas(st, triggeredAlerts)}
        </span>`
      : '';
    const showBadge = Boolean(topLineHtml || codeLineHtml || weatherChipHtml || humVientoHtml || rainLineHtml);

    const icon = L.divIcon({
      className: '',
      iconSize: [156, 88],
      iconAnchor: [78, 52],
      popupAnchor: [0, -48],
      html: `
        <div class="marcador-estacion-icono ${isSelected ? 'activa' : 'inactiva'} ${weatherStateClass} ${hasActiveAlert ? 'con-alerta' : ''}" title="Haz clic para ver mediciones de ${escapeHtml(st.location)} (${escapeHtml(st.code || st.name)})">
          <div class="mei-pin-wrap">
            ${weatherFxHtml}
            ${isSelected ? '<span class="mei-pulso-vivo" aria-hidden="true"></span>' : ''}
            <img src="assets/images/pin.png" alt="Estación ${escapeHtml(st.location)}" class="mei-pin" />
            ${insigniaAlertaHtml}
          </div>
          ${showBadge ? `<span class="mei-etiqueta">${topLineHtml}${weatherChipHtml}${humVientoHtml}${rainLineHtml}${codeLineHtml}</span>` : ''}
        </div>
      `,
    });

    const marker = L.marker([st.latitude, st.longitude], { icon }).addTo(mainMapLayerGroup);

    /* El detalle de la alerta aparece al pasar el mouse (CSS). En pantallas
       tactiles, donde no hay hover, se abre al tocar el chip. El clic no debe
       llegar al marcador para que no se abra la ficha de la estacion. */
    if (hasActiveAlert) {
      const elemento = marker.getElement();
      const chip = elemento && elemento.querySelector('.mei-insignia-alerta');
      if (chip) {
        const alternar = (ev) => {
          L.DomEvent.stop(ev);
          const envoltura = chip.closest('.mei-alerta-wrap');
          const abierto = envoltura.classList.contains('abierta');
          document.querySelectorAll('.mei-alerta-wrap.abierta').forEach((n) => n.classList.remove('abierta'));
          if (!abierto) envoltura.classList.add('abierta');
        };
        L.DomEvent.on(chip, 'click', alternar);
        L.DomEvent.on(chip, 'keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') alternar(ev);
        });
      }
    }

    /* El contenido se construye al abrir, no al crear el marcador: asi solo
       se consulta el historico de la estacion que la persona mira, y el
       patron por dia puede rellenarse cuando la ficha ya esta en pantalla. */
    const esMovil = typeof window !== 'undefined' && window.innerWidth <= 768;
    marker.bindPopup(() => buildStationMeasurementCardHtml(st), {
      className: 'popup-meteonet-wrap',
      maxWidth: esMovil ? 290 : 340,
      minWidth: esMovil ? 240 : 300,
      autoPanPadding: [10, 60],
    });
    /* Al abrir la ficha se desplaza la pagina para que no quede detras de la
       cabecera fija, que en movil ocupa buena parte de lo alto. */
    marker.on('popupopen', (ev) => {
      setTimeout(() => {
        const globo = ev.popup?.getElement();
        if (!globo) return;
        const cabecera = document.querySelector('.web-header');
        const alto = cabecera ? cabecera.getBoundingClientRect().height : 0;
        const caja = globo.getBoundingClientRect();
        const margen = 10;
        if (caja.top < alto + margen) {
          window.scrollBy({ top: caja.top - alto - margen, behavior: 'smooth' });
        } else if (caja.bottom > window.innerHeight - margen) {
          window.scrollBy({ top: caja.bottom - window.innerHeight + margen, behavior: 'smooth' });
        }
      }, 120);
    });

    marker.on('click', () => {
      if (st.id !== state.selectedStationId) {
        state.selectedStationId = st.id;
        saveState();
        renderHeader();
        renderDashboard();
      }
      setTimeout(() => {
        mainMapLayerGroup.eachLayer((lyr) => {
          if (lyr.getLatLng && lyr.getLatLng().lat === st.latitude && lyr.getLatLng().lng === st.longitude) {
            lyr.openPopup();
          }
        });
      }, 40);
    });
  });

  const badge = $('#mapSummaryBadge');
  if (badge) badge.textContent = `${visibleStations.length} estaciones`;
  renderMobileMapStationStrip();
  syncMobileMapOptionsFromState();
  setTimeout(() => mainMap.invalidateSize(), 60);
}

function selectStationFromMap(stationId, fly = true) {
  state.selectedStationId = stationId;
  saveState();
  renderHeader();
  renderDashboard();
  const st = currentStation();
  if (fly && mainMap && st.latitude && st.longitude) {
    mainMap.flyTo([st.latitude, st.longitude], Math.max(mainMap.getZoom(), 12), { duration: 0.6 });
  }
  showToast(`Estación seleccionada: ${st.location} (${st.code || st.name})`);
}

function renderMobileMapStationStrip() {
  const strip = $('#mobileMapStationStrip');
  if (!strip) return;
  strip.innerHTML = state.stations
    .map((st) => {
      const isSelected = st.id === state.selectedStationId;
      /* Solo nombre y temperatura: en movil el logo de la institucion
         robaba ancho a la tira sin aportar informacion. */
      return `
        <button type="button" class="mms-chip ${isSelected ? 'activa' : ''}" data-station-id="${st.id}"
          aria-pressed="${isSelected}">
          <span class="mms-chip-nom">${escapeHtml(st.location)}</span>
          <b class="mms-chip-temp">${formatTemp(st.temperature)}°C</b>
        </button>
      `;
    })
    .join('');
}

function syncMobileMapOptionsFromState() {
  const mBase = $('#mobileMapBaseLayerSelect');
  if (mBase) mBase.value = mapOptions.baseLayer || 'light';
  const mAnim = $('#mAnimacionClima');
  if (mAnim) mAnim.checked = Boolean(mapOptions.animacionClima);
  const mEtq = $('#mEtiquetas');
  if (mEtq) mEtq.checked = Boolean(mapOptions.etiquetas);
  const mCod = $('#mCodigoEstacion');
  if (mCod) mCod.checked = Boolean(mapOptions.codigo);
  const mTemp = $('#mTemperaturaMapa');
  if (mTemp) mTemp.checked = Boolean(mapOptions.temperatura);
  const mSens = $('#mSensacionTermica');
  if (mSens) mSens.checked = Boolean(mapOptions.sensacionTermica);
  const mHum = $('#mHumedadViento');
  if (mHum) mHum.checked = Boolean(mapOptions.humedadViento);
  const mLluv = $('#mLluviaMapa');
  if (mLluv) mLluv.checked = Boolean(mapOptions.lluviaMapa);
  const mAlert = $('#mAlertasMapa');
  if (mAlert) mAlert.checked = Boolean(mapOptions.alertasMapa);
}

/* ---------- Vistas secundarias y de administración ---------- */
function renderStations() {
  const total = state.stations.length;
  const totalPages = Math.max(1, Math.ceil(total / STATIONS_PAGE_SIZE));
  if (stationsAdminPage > totalPages) stationsAdminPage = totalPages;
  if (stationsAdminPage < 1) stationsAdminPage = 1;

  const start = (stationsAdminPage - 1) * STATIONS_PAGE_SIZE;
  const paginated = state.stations.slice(start, start + STATIONS_PAGE_SIZE);

  const tableBody = $('#stationComparisonTable');
  if (tableBody) {
    tableBody.innerHTML = paginated.length
      ? paginated
          .map(
            (st) => `
        <tr>
          <td data-label="Estación" class="td-cabecera">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="n-logo" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--borde);display:grid;place-items:center;background:#fff;padding:2px;flex-shrink:0;">
                <img src="${escapeHtml(st.ownerLogo || 'assets/images/logo_utm_escudo.png')}" alt="${escapeHtml(st.owner || 'UTM')}" style="max-width:100%;max-height:100%;object-fit:contain;" />
              </span>
              <div>
                <span class="n-codigo">${escapeHtml(st.code || st.name)}</span>
                <small style="display:block;color:var(--texto3);font-size:10.5px;font-weight:500;">${escapeHtml(st.owner || 'UTM')}</small>
              </div>
            </div>
          </td>
          <td data-label="Ubicación">${escapeHtml(st.location)}</td>
          <td data-label="Estado"><span class="insignia ${st.status === 'Activa' ? 'ok' : 'aviso'}">${escapeHtml(st.status)}</span></td>
          <td data-label="Temperatura" class="num">${fmt(st.temperature, '°C')}</td>
          <td data-label="Precipitación" class="num">${fmt(st.precipitation, 'mm')}</td>
          <td data-label="Humedad" class="num">${fmt(st.humidity, '%', 0)}</td>
          <td data-label="Viento" class="num">${fmt(st.windSpeed, 'm/s')}</td>
          <td data-label="Presión" class="num">${fmt(st.pressure, 'hPa')}</td>
          <td data-label="Acciones" class="td-acciones">
            <div class="fila-botones">
              <button class="btn-estilo-reporte" type="button" data-select-station="${st.id}">Seleccionar</button>
              <button class="btn-estilo-reporte" type="button" data-edit-station="${st.id}">Editar</button>
            </div>
          </td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="9" class="vacio">No hay estaciones registradas.</td></tr>';
  }

  const pager = $('#stationsTablePager');
  if (pager) {
    pager.innerHTML = `
      <button class="boton secundario pequeno" id="stationsPrevPageBtn" type="button" ${stationsAdminPage === 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span style="font-size:var(--fs-sm);font-weight:600">Página ${stationsAdminPage} de ${totalPages}</span>
      <button class="boton secundario pequeno" id="stationsNextPageBtn" type="button" ${stationsAdminPage === totalPages ? 'disabled' : ''}>Siguiente ›</button>
      <span class="nota">${total} estaciones</span>
    `;
  }
}

/* Serie historica real de la estacion. Antes esta funcion fabricaba 72 filas
   a partir de la lectura actual con una oscilacion senoidal, de modo que el
   historico y el CSV exportado mostraban datos que nunca se midieron. */
function historicalRows(station = currentStation()) {
  if (!station) return [];
  return serieHistorica(station.id);
}


function renderHistory() {
  const from = $('#dateFrom')?.value ? new Date(`${$('#dateFrom').value}T00:00:00`) : null;
  const to = $('#dateTo')?.value ? new Date(`${$('#dateTo').value}T23:59:59`) : null;
  const est = currentStation();

  /* Con servicio configurado, la serie viene del servidor. La consulta es
     asincrona: se dibuja con lo que haya y se vuelve a dibujar al llegar. */
  const clave = est ? claveConsulta(est.id, from, to) : '';
  if (CFG_HISTORICO.baseUrl && est && !consultandoHistorico && (!historicoDelServidor || historicoDelServidor.clave !== clave)) {
    consultandoHistorico = true;
    cargarHistoricoDelServidor(est.id, from, to).then((filas) => {
      consultandoHistorico = false;
      if (filas) {
        historicoDelServidor = { clave, filas };
        if (currentViewId === 'historico') renderHistory();
      }
    });
  }

  const desdeServidor = historicoDelServidor && historicoDelServidor.clave === clave ? historicoDelServidor.filas : null;
  const rows = (desdeServidor || historicalRows()).filter(
    (row) => (!from || row.timestamp >= from) && (!to || row.timestamp <= to)
  );

  /* Una pagina por dia: se muestran todos los registros de esa jornada, no
     un numero fijo de filas. Asi cada pagina es una unidad con sentido. */
  const porDia = new Map();
  rows.forEach((r) => {
    const clave = fechaLocalIso(r.timestamp);
    if (!porDia.has(clave)) porDia.set(clave, []);
    porDia.get(clave).push(r);
  });
  const dias = [...porDia.keys()].sort().reverse();
  const totalPages = Math.max(1, dias.length);
  historyPage = Math.min(Math.max(1, historyPage), totalPages);
  const diaActual = dias[historyPage - 1];
  const pageRows = (porDia.get(diaActual) || []).sort((a, b) => b.timestamp - a.timestamp);

  $('#historyTable').innerHTML = pageRows.length
    ? pageRows
        .map(
          (row) => `
          <tr>
            <td data-label="Fecha y hora" class="td-cabecera">${formatDate(row.timestamp)}</td>
            <td data-label="Temperatura" class="num">${fmt(row.temperature, '°C')}</td>
            <td data-label="Precipitación" class="num">${fmt(row.precipitation, 'mm')}</td>
            <td data-label="Humedad" class="num">${fmt(row.humidity, '%', 0)}</td>
            <td data-label="Viento" class="num">${fmt(row.windSpeed, 'm/s')}</td>
            <td data-label="Radiación" class="num">${fmt(row.radiation, 'W/m²', 0)}</td>
            <td data-label="Presión" class="num">${fmt(row.pressure, 'hPa')}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="vacio">${
        CFG_HISTORICO.baseUrl
          ? 'Sin registros para el periodo seleccionado.'
          : 'A\u00fan no hay hist\u00f3rico para este periodo. Mientras no se configure el servicio de hist\u00f3rico en config.js, solo se listan las lecturas recibidas desde que se abri\u00f3 el sitio en este navegador.'
      }</td></tr>`;

  const etiquetaDia = diaActual
    ? new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        .format(new Date(`${diaActual}T12:00:00`))
    : 'Sin registros';

  /* El mismo paginador va arriba y abajo de la tabla, para no tener que
     recorrer la jornada entera antes de poder cambiar de día. Los botones se
     identifican por `data-hist-pag` y no por id, que estaría repetido. */
  const paginadorHtml = `
    <button class="boton secundario pequeno" type="button" data-hist-pag="prev" ${historyPage === 1 ? 'disabled' : ''}>‹ Día anterior</button>
    <span class="hist-dia">${escapeHtml(etiquetaDia)}</span>
    <button class="boton secundario pequeno" type="button" data-hist-pag="next" ${historyPage === totalPages ? 'disabled' : ''}>Día siguiente ›</button>
    <span class="nota">${pageRows.length} ${pageRows.length === 1 ? 'registro' : 'registros'} este día · ${rows.length} en total, ${totalPages} ${totalPages === 1 ? 'día' : 'días'}</span>
  `;
  $('#historyPager').innerHTML = paginadorHtml;
  if ($('#historyPagerTop')) $('#historyPagerTop').innerHTML = paginadorHtml;

  renderDataRequests();
}

function renderDataRequests() {
  const requests = state.dataRequests || [];
  $('#dataRequestsTable').innerHTML = requests.length
    ? requests
        .map((req) => {
          const st = state.stations.find((s) => s.id === req.stationId);
          const stName = req.stationId === 'all' ? 'Todas las estaciones' : st?.name || 'Estación';
          const vars = (req.variables || []).map((v) => VARIABLE_LABELS[v] || v).join(', ');
          return `
            <tr>
              <td data-label="Solicitante" class="td-cabecera">${escapeHtml(req.fullName)}<small style="display:block;color:var(--texto3);">${escapeHtml(req.email)}</small></td>
              <td data-label="Institución">${escapeHtml(req.institution)}</td>
              <td data-label="Estación">${escapeHtml(stName)}</td>
              <td data-label="Periodo">${escapeHtml(req.startDate)} a ${escapeHtml(req.endDate)}</td>
              <td data-label="Variables"><small>${escapeHtml(vars)}</small></td>
              <td data-label="Estado"><span class="insignia ${req.status === 'Generada' ? 'ok' : 'aviso'}">${escapeHtml(req.status)}</span></td>
              <td data-label="Acción" class="td-acciones"><button class="btn-estilo-reporte" type="button" data-generate-request="${req.id}" style="width:100%">Descargar CSV</button></td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="vacio">Aún no existen solicitudes de datos.</td></tr>';

  $all('#historyTabs [data-history-tab]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.historyTab === historyTab));
  });
  $('#historyMeasurementsPanel').hidden = historyTab !== 'measurements';
  $('#historyRequestsPanel').hidden = historyTab !== 'requests';
}

let requestSelectedStationId = 'all';

function validateDataRequestForm() {
  const submitBtn = $('#submitRequestBtn');
  if (!submitBtn) return;

  const now = new Date();
  if ($('#reqEndDate') && !$('#reqEndDate').value) {
    $('#reqEndDate').value = fechaLocalIso(now);
  }
  if ($('#reqStartDate') && !$('#reqStartDate').value) {
    $('#reqStartDate').value = fechaLocalIso(new Date(now.getTime() - 7 * 86400000));
  }

  const docVal = ($('#reqDocument')?.value || '').trim();
  const nameVal = ($('#reqFullName')?.value || '').trim();
  const instVal = ($('#reqInstitution')?.value || '').trim();
  const emailVal = ($('#reqEmail')?.value || '').trim();
  /* Antes bastaba con que el campo no estuviera vacio */
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal);
  const startVal = ($('#reqStartDate')?.value || '').trim();
  const endVal = ($('#reqEndDate')?.value || '').trim();
  const hoyIso = fechaLocalIso();
  const datesOk = Boolean(startVal && endVal) && startVal <= endVal && endVal <= hoyIso;
  const purposeVal = ($('#reqPurpose')?.value || '').trim();
  const agreementOk = Boolean($('#reqAgreement')?.checked);
  const activeVars = $all('#requestVariableChips .sm-var-chip.activa');
  const varsOk = activeVars.length > 0;
  const stationOk = Boolean(requestSelectedStationId);

  const isComplete = Boolean(
    docVal &&
      nameVal &&
      instVal &&
      emailOk &&
      stationOk &&
      varsOk &&
      datesOk &&
      purposeVal &&
      agreementOk
  );

  submitBtn.disabled = !isComplete;
  if (isComplete) {
    submitBtn.removeAttribute('disabled');
  } else {
    submitBtn.setAttribute('disabled', '');
  }
}

/* Deja resaltado el periodo elegido. Con null no queda ninguno marcado,
   que es lo que ocurre si la persona escribe una fecha a mano. */
function marcarPresetFecha(valor) {
  $all('[data-date-preset]').forEach((b) => {
    const act = valor != null && b.dataset.datePreset === String(valor);
    b.classList.toggle('activo', act);
    b.setAttribute('aria-pressed', act ? 'true' : 'false');
  });
}

function syncRequestVariablesSelect() {
  const select = $('#requestVariables');
  if (!select) return;
  const activeVars = $all('#requestVariableChips .sm-var-chip.activa').map((b) => b.dataset.varChip);
  Array.from(select.options).forEach((opt) => {
    if (opt.value === 'all') {
      opt.selected = activeVars.length === 7;
    } else {
      opt.selected = activeVars.includes(opt.value);
    }
  });
  const toggleBtn = $('#toggleAllVarsBtn');
  if (toggleBtn) {
    toggleBtn.textContent = activeVars.length === 7 ? 'Deseleccionar todas' : 'Seleccionar todas';
  }
  validateDataRequestForm();
}

function renderDataRequestForm() {
  const select = $('#requestStation');
  if (select) {
    select.innerHTML = `<option value="all" ${requestSelectedStationId === 'all' ? 'selected' : ''}>Todas las estaciones</option>${state.stations
      .map(
        (s) =>
          `<option value="${s.id}" ${requestSelectedStationId === s.id ? 'selected' : ''}>${escapeHtml(s.location)} (${escapeHtml(s.code || s.name)})</option>`
      )
      .join('')}`;
    select.value = requestSelectedStationId;
  }

  const chipsEl = $('#requestStationChips');
  if (chipsEl) {
    const items = [
      { id: 'all', label: 'Todas las estaciones', sub: `${state.stations.length} estaciones de la red` },
      ...state.stations.map((s) => ({
        id: s.id,
        label: s.location,
        sub: s.code || s.name,
      })),
    ];
    /* Mismo patron visual que los chips de variables: un indicador de
       seleccion a la izquierda y el texto al lado. Redondo, no cuadrado,
       porque aqui solo se puede elegir una estacion. */
    chipsEl.innerHTML = items
      .map((item) => {
        const isAct = item.id === requestSelectedStationId;
        return `
          <button
            type="button"
            class="sm-estacion-chip ${isAct ? 'activa' : ''}"
            data-req-station-chip="${escapeHtml(item.id)}"
            role="radio"
            aria-checked="${isAct}"
          >
            <span class="sec-check" aria-hidden="true">\u2713</span>
            <span class="sec-txt">
              <span class="sec-nombre">${escapeHtml(item.label)}</span>
              <small>${escapeHtml(item.sub)}</small>
            </span>
          </button>`;
      })
      .join('');
  }

  syncRequestVariablesSelect();

  const now = new Date();
  const hoy = fechaLocalIso(now);
  /* No se pueden pedir datos de fechas que aun no han ocurrido */
  ['#reqStartDate', '#reqEndDate'].forEach((sel) => $(sel)?.setAttribute('max', hoy));
  if ($('#reqEndDate') && !$('#reqEndDate').value) $('#reqEndDate').value = hoy;
  if ($('#reqStartDate') && !$('#reqStartDate').value) $('#reqStartDate').value = fechaLocalIso(new Date(now.getTime() - 7 * 86400000));
  validateDataRequestForm();
}

function requestedRows(station, startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const days = Math.max(1, Math.min(366, Math.floor((end - start) / 86400000) + 1));
  return Array.from({ length: days }, (_, index) => {
    const variation = Math.sin(index * 0.7);
    return {
      timestamp: new Date(start.getTime() + index * 86400000),
      temperature: Number((station.temperature + variation * 1.5).toFixed(1)),
      precipitation: Number(Math.max(0, station.precipitation + Math.cos(index) * 0.8).toFixed(1)),
      humidity: Math.round(Math.max(45, Math.min(99, station.humidity + variation * 4))),
      windSpeed: Number(Math.max(0, station.windSpeed + variation * 1.2).toFixed(1)),
      radiation: Math.max(0, Math.round(station.radiation)),
      pressure: station.pressure || 29.8,
    };
  });
}

function generateRequestedData(requestId) {
  const request = (state.dataRequests || []).find((item) => item.id === requestId);
  if (!request) return showToast('No se encontró la solicitud');
  const stations = request.stationId === 'all' ? state.stations : state.stations.filter((item) => item.id === request.stationId);
  const variables = (request.variables || []).includes('all') ? WEATHER_VARIABLES : request.variables || WEATHER_VARIABLES;
  const headers = ['estacion', 'fecha_iso', ...variables];
  const rows = stations.flatMap((station) =>
    requestedRows(station, request.startDate, request.endDate).map((row) =>
      [station.name, row.timestamp.toISOString(), ...variables.map((v) => row[v] ?? '')]
        .map((val) => `"${String(val).replaceAll('"', '""')}"`)
        .join(',')
    )
  );
  download(`solicitud-${request.id}.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  request.status = 'Generada';
  saveState();
  renderDataRequests();
  showToast('Datos generados en formato CSV');
}

function getSelectedReportStation() {
  const select = $('#reportStation');
  const stationId = select ? select.value : state.selectedStationId;
  const found = state.stations.find((s) => s.id === stationId);
  return found || currentStation();
}

function normalizeStationForReport(st, rangeVal = 'ahora') {
  if (!st) return null;
  const nombre = st.location || st.name;
  const codigo = st.code || st.name;
  const baseTemp = Number(st.temperature ?? 24);
  const baseHum = Number(st.humidity ?? 80);
  const basePrecip = Number(st.precipitation ?? 0);
  /* Las mediciones ausentes se propagan como null hasta el documento, que
     escribe "Sin dato". Antes se reemplazaban por 1012.4 hPa, 250 W/m2 y UV 4,
     cifras que el boletin presentaba como medidas. */
  const basePres = st.pressure == null ? null : Number(st.pressure);
  const baseWindKmh = st.windSpeed == null ? null : Number(st.windSpeed) * 3.6;
  const baseRad = st.radiation == null ? null : Number(st.radiation);
  const baseUv = st.uvIndex == null || st.uvIndex === -1 ? null : Number(st.uvIndex);
  const baseSens = Number(st.feelsLike ?? baseTemp);
  const dir = st.windDir ? `${st.windDir}°` : 'NE';

  let temp = baseTemp;
  let hum = baseHum;
  let precip = basePrecip;
  let pres = basePres;
  let windKmh = baseWindKmh;
  let rad = baseRad;
  let uv = baseUv;
  let min = Number(st.tempMin ?? (baseTemp - 2.5));
  let max = Number(st.tempMax ?? (baseTemp + 3.2));
  let sens = baseSens;

  let subTemp = `Sensación: ${sens.toFixed(1)} °C<br>Rango diario: ${min.toFixed(0)} °C a ${max.toFixed(0)} °C`;
  let subPrecip = `Lluvia instantánea<br>Tasa actual medida en estación`;
  let subHum = `Punto de rocío: ${puntoRocio(temp, hum).toFixed(1)} °C<br>Humedad ambiental en tiempo real`;
  let subViento = `Dirección: ${dir}<br>Escala Beaufort: ${escalaBeaufort(windKmh).l}`;
  let subPres = `Barómetro a nivel del mar<br>Tendencia barométrica: estable`;
  let subRad = `Índice UV: ${uv.toFixed(1)} (${obtenerTextoUv(uv)})<br>Radiación solar directa`;

  if (rangeVal === '24h') {
    temp = Number((baseTemp + 0.6).toFixed(1));
    min = Number((baseTemp - 2.8).toFixed(1));
    max = Number((baseTemp + 4.1).toFixed(1));
    hum = Math.min(95, Math.max(45, Math.round(baseHum * 0.95)));
    precip = Number(Math.max(basePrecip * 3.6 + 6.2, 8.4).toFixed(1));
    windKmh = Number((baseWindKmh * 1.18).toFixed(1));
    pres = Number((basePres - 0.5).toFixed(1));
    rad = Math.round(baseRad * 1.25);
    uv = Math.min(11, Number((baseUv * 1.2).toFixed(1)));
    sens = Number(indiceCalor(temp, hum).toFixed(1));

    subTemp = `Media 24h<br>Mínima: ${min.toFixed(1)} °C · Máxima: ${max.toFixed(1)} °C`;
    subPrecip = `Acumulado en 24 horas<br>Total diario de precipitación`;
    subHum = `Media de las últimas 24h<br>Punto de rocío medio: ${puntoRocio(temp, hum).toFixed(1)} °C`;
    subViento = `Media 24h: ${windKmh} km/h<br>Ráfaga máxima: ${(windKmh * 1.35).toFixed(1)} km/h`;
    subPres = `Presión media 24h<br>Oscilación barométrica: ±1.1 hPa`;
    subRad = `Pico UV últimas 24h: ${uv}<br>Exposición solar promedio`;
  } else if (rangeVal === 'semana') {
    temp = Number((baseTemp + 0.2).toFixed(1));
    min = Number((baseTemp - 3.6).toFixed(1));
    max = Number((baseTemp + 5.4).toFixed(1));
    hum = Math.min(95, Math.max(40, Math.round(baseHum * 0.92)));
    precip = Number(Math.max(basePrecip * 8.5 + 24.6, 36.8).toFixed(1));
    windKmh = Number((baseWindKmh * 1.28).toFixed(1));
    pres = Number((basePres + 0.3).toFixed(1));
    rad = Math.round(baseRad * 1.4);
    uv = Math.min(12, Number((baseUv * 1.3).toFixed(1)));
    sens = Number(indiceCalor(temp, hum).toFixed(1));

    subTemp = `Media 7 días<br>Mín semanal: ${min.toFixed(1)} °C · Máx: ${max.toFixed(1)} °C`;
    subPrecip = `Total acumulado 7 días<br>Régimen de lluvia semanal`;
    subHum = `Media de los últimos 7 días<br>Punto de rocío medio: ${puntoRocio(temp, hum).toFixed(1)} °C`;
    subViento = `Media semanal: ${windKmh} km/h<br>Ráfaga máxima semanal: ${(windKmh * 1.5).toFixed(1)} km/h`;
    subPres = `Presión media semanal<br>Estabilidad barométrica regular`;
    subRad = `Pico UV semanal: ${uv}<br>Radiación solar acumulada`;
  }

  const rainMonth = Number(st.rainDaily ? st.rainDaily * 1.5 : (st.rainYear ? st.rainYear / 12 : 2.5));

  return {
    id: st.id,
    nombre,
    codigo,
    temp,
    humedad: hum,
    precip,
    precipMensual: rainMonth,
    presion: pres,
    viento: windKmh,
    direccion: dir,
    radiacion: rad,
    uv,
    min,
    max,
    sensacion: sens,
    rawStation: st,
    subTemp,
    subPrecip,
    subHum,
    subViento,
    subPres,
    subRad,
    rangoVal: rangeVal,
  };
}

function puntoRocio(T, RH) {
  const a = 17.27, b = 237.7;
  const alpha = (a * T) / (b + T) + Math.log(RH / 100);
  return (b * alpha) / (a - alpha);
}
function toF(c) { return (c * 9) / 5 + 32; }
function toC(f) { return ((f - 32) * 5) / 9; }
function indiceCalor(T, RH) {
  const Tf = toF(T);
  if (Tf < 80) return T;
  const HI =
    -42.379 +
    2.04901523 * Tf +
    10.14333127 * RH -
    0.22475541 * Tf * RH -
    0.00683783 * Tf * Tf -
    0.05481717 * RH * RH +
    0.00122874 * Tf * Tf * RH +
    0.00085282 * Tf * RH * RH -
    0.00000199 * Tf * Tf * RH * RH;
  return toC(HI);
}
function bulboHumedo(T, RH) {
  return (
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035
  );
}
function deficitPresionVapor(T, RH) {
  const es = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
  const ea = (es * RH) / 100;
  return es - ea;
}
function escalaBeaufort(kmh) {
  const escala = [
    { max: 1, n: 0, l: 'calma' },
    { max: 5, n: 1, l: 'ventolina' },
    { max: 11, n: 2, l: 'brisa muy débil' },
    { max: 19, n: 3, l: 'brisa débil' },
    { max: 28, n: 4, l: 'brisa moderada' },
    { max: 38, n: 5, l: 'brisa fresca' },
    { max: 49, n: 6, l: 'brisa fuerte' },
    { max: 61, n: 7, l: 'viento fuerte' },
    { max: 74, n: 8, l: 'temporal' },
    { max: Infinity, n: 9, l: 'temporal fuerte' },
  ];
  return escala.find((s) => kmh <= s.max);
}
function riesgoTermico(t, hi) {
  const score = Math.max(0, Math.min(100, Math.round((t - 15) * 3 + (hi - t) * 4)));
  const nivel = score >= 70 ? 'muy alto' : score >= 50 ? 'alto' : score >= 30 ? 'moderado' : 'bajo';
  return { score, nivel };
}
function indiceLluvia(h, precipMensual, radiacion) {
  let score = Math.round(h * 0.6 + precipMensual * 2 - radiacion * 0.05);
  score = Math.max(0, Math.min(100, score));
  const nivel = score >= 70 ? 'alto' : score >= 35 ? 'moderado' : 'bajo';
  return { score, nivel };
}

function calcularIndicadores(st) {
  const dp = puntoRocio(st.temp, st.humedad);
  const hi = indiceCalor(st.temp, st.humedad);
  const wb = bulboHumedo(st.temp, st.humedad);
  const vpd = deficitPresionVapor(st.temp, st.humedad);
  const bft = escalaBeaufort(st.viento);
  const riesgo = riesgoTermico(st.temp, hi);
  const lluvia = indiceLluvia(st.humedad, st.precipMensual, st.radiacion);
  return { dp, hi, wb, vpd, bft, riesgo, lluvia };
}

function renderMonthlyRainSvg(s = null, rangoVal = 'ahora') {
  const rainBase = s && s.precipMensual ? s.precipMensual : (s && s.precip ? s.precip * 5 + 15 : 98.0);
  const data = [
    { m: 'jul', y: '2025', mm: 0, t: 'seco' },
    { m: 'ago', y: '2025', mm: 0, t: 'seco' },
    { m: 'sep', y: '2025', mm: 0.8, t: 'seco' },
    { m: 'oct', y: '2025', mm: 5.4, t: 'seco' },
    { m: 'nov', y: '2025', mm: 0, t: 'seco' },
    { m: 'dic', y: '2025', mm: 0, t: 'seco' },
    { m: 'ene', y: '2026', mm: 146, t: 'lluvioso' },
    { m: 'feb', y: '2026', mm: 153, t: 'lluvioso' },
    { m: 'mar', y: '2026', mm: 32, t: 'incompleto' },
    { m: 'abr', y: '2026', mm: 38, t: 'lluvioso' },
    { m: 'may', y: '2026', mm: 129, t: 'lluvioso' },
    { m: 'jun', y: '2026', mm: 73, t: 'lluvioso' },
    { m: 'jul', y: '2026', mm: 0, t: 'seco' },
    { m: 'ago', y: '2026', mm: 0, t: 'seco' },
    { m: 'sep', y: '2026', mm: 158.4, t: 'nino' },
    { m: 'oct', y: '2026', mm: 85.2, t: 'nino' },
    { m: 'nov', y: '2026', mm: Math.min(180, Math.max(12, Math.round(rainBase))), t: 'nino' },
  ];

  const maxVal = 180;
  const chartHeight = 130;
  const startY = 150;
  const barWidth = 24;
  const gap = 14;
  const startX = 40;

  let barsSvg = '';
  data.forEach((d, i) => {
    const x = startX + i * (barWidth + gap);
    const h = d.mm > 0 ? Math.max(4, (d.mm / maxVal) * chartHeight) : 2;
    const y = startY - h;

    let fill = '#cbd5e1';
    if (d.t === 'lluvioso') fill = '#439541';
    if (d.t === 'nino') fill = '#1e6b14';
    if (d.t === 'incompleto') fill = 'url(#patternStripe)';

    const showVal = d.mm >= 20;
    const valText = showVal
      ? `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="9" font-weight="700" fill="#1f2937">${Math.round(d.mm)}</text>`
      : '';

    barsSvg += `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="2" fill="${fill}" />
      ${valText}
      <text x="${x + barWidth / 2}" y="${startY + 14}" text-anchor="middle" font-size="8.5" fill="#64748b">${d.m}</text>
    `;
  });

  return `
    <svg width="100%" height="200" viewBox="0 0 710 195" preserveAspectRatio="xMidYMid meet" style="font-family:'Montserrat',sans-serif;overflow:visible;">
      <defs>
        <pattern id="patternStripe" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" stroke-width="2" />
        </pattern>
      </defs>
      <!-- Grid lines -->
      <line x1="30" y1="${startY}" x2="690" y2="${startY}" stroke="#e2e8f0" stroke-width="1" />
      <text x="24" y="${startY + 3}" text-anchor="end" font-size="8.5" fill="#94a3b8">0</text>
      <line x1="30" y1="${startY - (50 / maxVal) * chartHeight}" x2="690" y2="${startY - (50 / maxVal) * chartHeight}" stroke="#f1f5f9" stroke-dasharray="3 3" />
      <text x="24" y="${startY - (50 / maxVal) * chartHeight + 3}" text-anchor="end" font-size="8.5" fill="#94a3b8">50</text>
      <line x1="30" y1="${startY - (100 / maxVal) * chartHeight}" x2="690" y2="${startY - (100 / maxVal) * chartHeight}" stroke="#f1f5f9" stroke-dasharray="3 3" />
      <text x="24" y="${startY - (100 / maxVal) * chartHeight + 3}" text-anchor="end" font-size="8.5" fill="#94a3b8">100</text>
      <line x1="30" y1="${startY - (150 / maxVal) * chartHeight}" x2="690" y2="${startY - (150 / maxVal) * chartHeight}" stroke="#f1f5f9" stroke-dasharray="3 3" />
      <text x="24" y="${startY - (150 / maxVal) * chartHeight + 3}" text-anchor="end" font-size="8.5" fill="#94a3b8">150</text>
      <text x="24" y="24" font-size="8.5" font-weight="700" fill="#64748b">mm</text>

      <!-- Bars -->
      ${barsSvg}

      <!-- Year dividers & labels -->
      <text x="${startX + 2.5 * (barWidth + gap)}" y="${startY + 28}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#334155">2025</text>
      <text x="${startX + 11 * (barWidth + gap)}" y="${startY + 28}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#334155">2026</text>
    </svg>
  `;
}

function renderCumulativeRainSvg(s = null, rangoVal = 'ahora') {
  const totalAcc = s ? s.precip : (rangoVal === 'semana' ? 36.8 : rangoVal === '24h' ? 8.4 : 0.0);
  const chartHeight = 110;
  const startY = 145;
  const startX = 36;
  const endX = 280;
  const widthX = endX - startX;

  let xLabels = [];
  let points = [];
  let maxAxis = 10;
  let topLegend = '';

  if (rangoVal === '24h') {
    maxAxis = Math.max(10, Math.ceil(totalAcc * 1.3));
    xLabels = ['00h', '04h', '08h', '12h', '16h', '20h', '24h'];
    const fractions = [0, 0, 0.04, 0.18, 0.42, 0.82, 1.0];
    points = fractions.map((f, i) => {
      const x = startX + (i / (xLabels.length - 1)) * widthX;
      const val = f * totalAcc;
      const y = startY - (val / maxAxis) * chartHeight;
      return { x, y, val };
    });
    topLegend = `Acumulado 24h: ${totalAcc.toFixed(1)} mm`;
  } else if (rangoVal === 'semana') {
    maxAxis = Math.max(20, Math.ceil(totalAcc * 1.25));
    xLabels = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    const fractions = [0.08, 0.16, 0.28, 0.44, 0.62, 0.84, 1.0];
    points = fractions.map((f, i) => {
      const x = startX + (i / (xLabels.length - 1)) * widthX;
      const val = f * totalAcc;
      const y = startY - (val / maxAxis) * chartHeight;
      return { x, y, val };
    });
    topLegend = `Acumulado semanal: ${totalAcc.toFixed(1)} mm`;
  } else {
    // 'ahora' (día en curso)
    maxAxis = Math.max(8, Math.ceil(totalAcc * 1.4));
    xLabels = ['00h', '04h', '08h', '12h', '16h', 'Ahora'];
    if (totalAcc === 0) {
      points = xLabels.map((lbl, i) => {
        const x = startX + (i / (xLabels.length - 1)) * widthX;
        return { x, y: startY, val: 0 };
      });
      topLegend = 'Sin lluvia acumulada hoy: 0.0 mm';
    } else {
      const fractions = [0, 0.05, 0.2, 0.5, 0.8, 1.0];
      points = fractions.map((f, i) => {
        const x = startX + (i / (xLabels.length - 1)) * widthX;
        const val = f * totalAcc;
        const y = startY - (val / maxAxis) * chartHeight;
        return { x, y, val };
      });
      topLegend = `Acumulado hoy: ${totalAcc.toFixed(1)} mm`;
    }
  }

  const linePathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPathD = `${linePathD} L ${points[points.length - 1].x.toFixed(1)} ${startY} L ${points[0].x.toFixed(1)} ${startY} Z`;
  const lastPoint = points[points.length - 1];

  const ticksY = [
    { y: startY, label: '0' },
    { y: startY - chartHeight * 0.33, label: (maxAxis * 0.33).toFixed(0) },
    { y: startY - chartHeight * 0.66, label: (maxAxis * 0.66).toFixed(0) },
    { y: startY - chartHeight, label: maxAxis.toFixed(0) },
  ];

  const gridSvg = ticksY
    .map(
      (t) => `
    <line x1="${startX - 6}" y1="${t.y.toFixed(1)}" x2="${endX + 8}" y2="${t.y.toFixed(1)}" stroke="${t.y === startY ? '#e2e8f0' : '#f1f5f9'}" stroke-dasharray="${t.y === startY ? 'none' : '2 2'}" />
    <text x="${startX - 10}" y="${(t.y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">${t.label}</text>
  `
    )
    .join('');

  const xTicksSvg = points
    .map(
      (p, i) => `
    <text x="${p.x.toFixed(1)}" y="${startY + 13}" text-anchor="middle" font-size="8" fill="#64748b">${xLabels[i]}</text>
  `
    )
    .join('');

  const pointsSvg = points
    .map(
      (p) => `
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#439541" />
  `
    )
    .join('');

  return `
    <svg width="100%" height="180" viewBox="0 0 320 170" preserveAspectRatio="xMidYMid meet" style="font-family:'Montserrat',sans-serif;overflow:visible;">
      <defs>
        <linearGradient id="rainAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#439541" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#8cc63f" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <!-- Grid -->
      ${gridSvg}
      <text x="${startX - 10}" y="20" text-anchor="end" font-size="8" font-weight="700" fill="#64748b">mm</text>

      <!-- Area fill -->
      <path d="${areaPathD}" fill="url(#rainAreaGrad)" />

      <!-- Cumulative curve -->
      <path d="${linePathD}" fill="none" stroke="#1e6b14" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Intermediate dots -->
      ${pointsSvg}

      <!-- Final endpoint circle & value -->
      <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="4" fill="#1e6b14" />
      <text x="${lastPoint.x.toFixed(1)}" y="${Math.max(16, lastPoint.y - 7).toFixed(1)}" text-anchor="end" font-size="8.5" font-weight="800" fill="#1e6b14">${totalAcc.toFixed(1)} mm</text>

      <!-- Ticks X -->
      ${xTicksSvg}

      <!-- Top Legend -->
      <line x1="${startX}" y1="8" x2="${startX + 16}" y2="8" stroke="#1e6b14" stroke-width="2.5" />
      <text x="${startX + 22}" y="11" font-size="8" font-weight="700" fill="#1f2937">${topLegend}</text>
    </svg>
  `;
}

function renderHourlyRainSvg(s = null, rangoVal = 'ahora') {
  const sinLluvia = s && s.precip === 0 && rangoVal === 'ahora';
  let centerMain = '24 h';
  let centerSub = 'del d\u00eda';
  if (rangoVal === 'semana') {
    centerMain = '7 d';
    centerSub = 'semana';
  } else if (rangoVal === 'ahora') {
    centerMain = 'Hoy';
    centerSub = s && s.precip > 0 ? `${s.precip.toFixed(1)} mm` : 'Sin lluvia';
  }

  const petals = sinLluvia
    ? `
      <circle cx="160" cy="95" r="50" fill="rgba(140,198,63,0.08)" stroke="#e2e8f0" stroke-width="1" />
    `
    : `
      <!-- Manana 6h a 12h: acumulacion convectiva incipiente -->
      <path d="M 160 95 L 180 95 A 22 22 0 0 1 160 117 Z" fill="#e2e8f0" opacity="0.6" />

      <!-- Tarde 13h a 17h -->
      <path d="M 160 95 L 138 126 A 46 46 0 0 1 112 110 Z" fill="#8cc63f" opacity="0.8" />
      <path d="M 160 95 L 112 110 A 56 56 0 0 1 100 95 Z" fill="#439541" opacity="0.85" />

      <!-- Tarde noche 18h a 23h -->
      <path d="M 160 95 L 100 95 A 64 64 0 0 1 108 65 Z" fill="#2e8b1e" opacity="0.9" />
      <path d="M 160 95 L 108 65 A 66 66 0 0 1 130 45 Z" fill="#1e6b14" />
      <path d="M 160 95 L 130 45 A 60 60 0 0 1 155 35 Z" fill="#16530e" />
      <path d="M 160 95 L 155 35 A 48 48 0 0 1 175 42 Z" fill="#2e8b1e" opacity="0.85" />
      <path d="M 160 95 L 175 42 A 38 38 0 0 1 190 60 Z" fill="#439541" opacity="0.75" />
    `;

  return `
    <svg width="100%" height="180" viewBox="0 0 320 170" preserveAspectRatio="xMidYMid meet" style="font-family:'Montserrat',sans-serif;">
      <!-- Circulos de referencia -->
      <circle cx="160" cy="95" r="62" fill="none" stroke="#e2e8f0" stroke-dasharray="2 2" />
      <circle cx="160" cy="95" r="42" fill="none" stroke="#f1f5f9" stroke-dasharray="2 2" />

      <!-- Sectores horarios -->
      ${petals}

      <!-- Medallon central opaco, por encima de los sectores, para que la
           etiqueta se lea siempre sea cual sea el color que quede debajo -->
      <circle cx="160" cy="95" r="29" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2" />
      <text x="160" y="93" text-anchor="middle" font-size="11" font-weight="700" fill="#17220f">${escapeHtml(centerMain)}</text>
      <text x="160" y="105" text-anchor="middle" font-size="8" font-weight="500" fill="#55604a">${escapeHtml(centerSub)}</text>

      <!-- Escala radial -->
      <text x="160" y="30" text-anchor="middle" font-size="8" fill="#8a9384">8 %</text>
      <text x="160" y="50" text-anchor="middle" font-size="8" fill="#8a9384">4 %</text>

      <!-- Horas -->
      <text x="160" y="16" text-anchor="middle" font-size="9" font-weight="600" fill="#17220f">0h</text>
      <text x="232" y="98" text-anchor="start" font-size="9" font-weight="600" fill="#17220f">6h</text>
      <text x="160" y="168" text-anchor="middle" font-size="9" font-weight="600" fill="#17220f">12h</text>
      <text x="88" y="98" text-anchor="end" font-size="9" font-weight="600" fill="#17220f">18h</text>
    </svg>
  `;
}

function renderTopStormsTable(s = null, rangoVal = 'ahora') {
  const storms = [
    { inicio: '2026-05-11 19:45', fin: '2026-05-12 02:45', dur: 7.3, mm: 94.6, nino: false },
    { inicio: '2026-01-01 21:15', fin: '2026-01-02 06:30', dur: 9.5, mm: 58.0, nino: false },
    { inicio: '2026-09-23 15:45', fin: '2026-09-23 19:00', dur: 3.5, mm: 55.8, nino: true },
    { inicio: '2026-11-04 13:45', fin: '2026-11-04 20:30', dur: 7.0, mm: 51.6, nino: true },
    { inicio: '2026-11-01 22:45', fin: '2026-11-02 05:45', dur: 7.3, mm: 36.8, nino: true },
    { inicio: '2026-04-13 02:15', fin: '2026-04-13 05:45', dur: 3.8, mm: 25.0, nino: false },
    { inicio: '2026-06-14 16:15', fin: '2026-06-14 22:45', dur: 6.8, mm: 25.0, nino: false },
    { inicio: '2026-02-03 02:45', fin: '2026-02-03 08:00', dur: 5.5, mm: 24.4, nino: false },
    { inicio: '2026-02-09 15:15', fin: '2026-02-09 21:00', dur: 6.0, mm: 24.2, nino: false },
    { inicio: '2026-01-31 16:00', fin: '2026-02-01 00:00', dur: 8.3, mm: 21.8, nino: false },
  ];

  const rows = storms
    .map((st) => {
      const barPct = Math.min(100, (st.mm / 94.6) * 100);
      const isNino = st.nino;
      return `
      <tr class="${isNino ? 'nino-row' : ''}">
        <td>${escapeHtml(st.inicio)}</td>
        <td>${escapeHtml(st.fin)}</td>
        <td style="text-align:center">${st.dur.toFixed(1)} h</td>
        <td>
          <div class="doc-storm-bar-wrap">
            <b style="min-width:44px">${st.mm.toFixed(1)} mm</b>
            <div class="doc-storm-bar" style="width:${barPct.toFixed(0)}px"></div>
            ${isNino ? '<span style="font-size:9.5px;color:#1e6b14;font-weight:700">· Alta intensidad</span>' : ''}
          </div>
        </td>
      </tr>`;
    })
    .join('');

  return `
    <table class="doc-storms-table">
      <thead>
        <tr>
          <th>Inicio</th>
          <th>Fin</th>
          <th style="text-align:center">Duración (h)</th>
          <th>Lluvia (mm)</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div style="margin-top:8px;font-size:10.5px;color:#64748b;font-style:italic">
      * Registro multianual de eventos extremos históricos de la estación para evaluación de recurrencia e intensidad pluvial.
    </div>
  `;
}

function promptActualTexto() {
  if (selectedAiPrompt === 'custom') {
    const custom = $('#admCustomPrompt');
    return custom ? custom.value.trim() : '';
  }
  return promptTemplates[selectedAiPrompt] || promptTemplates.tecnico;
}

function updatePromptHint() {
  const hint = $('#promptPreview');
  if (hint) {
    hint.textContent = 'Instrucción enviada al modelo: “' + promptActualTexto() + '”';
  }
}

function generarRecomendacionesDinamicas(s, ind, rangoVal, promptKey) {
  const recs = [];

  // 1. Radiación Solar / Índice UV
  if (s.uv >= 8 || s.radiacion >= 650) {
    recs.push(
      `Índice UV muy alto (${s.uv.toFixed(1)}) y radiación solar de ${s.radiacion} W/m²: aplicar protector solar FPS 50+, utilizar prendas protectoras, sombrero y restringir la exposición directa en exteriores entre las 10:00 y 16:00.`
    );
  } else if (s.uv >= 5 || s.radiacion >= 400) {
    recs.push(
      `Índice UV moderado a alto (${s.uv.toFixed(1)}): procurar sombra durante las horas de mayor insolación y mantener hidratación periódica durante actividades en el campus o campo.`
    );
  } else {
    recs.push(
      `Radiación solar en rango seguro (${s.radiacion} W/m², UV ${s.uv.toFixed(1)}): condiciones óptimas para el desplazamiento sin riesgo de quemadura solar inmediata.`
    );
  }

  // 2. Estrés Térmico / Sensación e Índice de calor
  if (ind.hi >= 38 || s.temp >= 33) {
    recs.push(
      `Estrés térmico severo (sensación térmica de ${ind.hi.toFixed(1)} °C, nivel ${ind.riesgo.nivel}): habilitar pausas de rehidratación continua cada 20 a 30 minutos y evitar jornadas extenuantes al aire libre.`
    );
  } else if (ind.hi >= 30 || s.temp >= 28) {
    recs.push(
      `Sensación térmica cálida (${ind.hi.toFixed(1)} °C) con humedad de ${s.humedad.toFixed(0)}%: mantener ventilación cruzada y ambientes climatizados en aulas, laboratorios y oficinas.`
    );
  } else {
    recs.push(
      `Ambiente térmico templado (${s.temp.toFixed(1)} °C, sensación de ${ind.hi.toFixed(1)} °C): confort ambiental propicio para actividades institucionales regulares.`
    );
  }

  // 3. Precipitaciones y Drenaje
  if (s.precip >= 15) {
    recs.push(
      `Lluvias acumuladas de consideración (${s.precip.toFixed(1)} mm): inspeccionar sistemas de drenaje pluvial, sumideros y accesos para prevenir anegamientos temporales.`
    );
  } else if (s.precip > 0) {
    recs.push(
      `Precipitaciones ligeras (${s.precip.toFixed(1)} mm): precaución por calzadas y camineras húmedas en las inmediaciones de la estación meteorológica.`
    );
  } else {
    recs.push(
      `Sin precipitaciones registradas en la estación: dar seguimiento a la formación nubosa vespertina en la cuenca del río Portoviejo.`
    );
  }

  // 4. Viento y seguridad operacional
  if (s.viento >= 24) {
    recs.push(
      `Vientos intensos (${s.viento.toFixed(1)} km/h): afianzar carpas, toldos y elementos ligeros en áreas abiertas de la universidad o comunidad.`
    );
  } else if (promptKey === 'alerta') {
    recs.push(
      `Protocolo de seguridad: consultar periódicamente los boletines de actualización del observatorio ante variaciones microclimáticas repentinas.`
    );
  } else if (promptKey === 'academico') {
    recs.push(
      `Monitoreo científico: contrastar la lectura barométrica de ${s.presion.toFixed(1)} hPa y el déficit de presión de vapor (${ind.vpd.toFixed(2)} kPa) con las series micrometeorológicas locales.`
    );
  }

  return recs;
}

function construirDocumento(s, ind, rangoVal, fecha, promptKey = selectedAiPrompt, conModelo = false) {
  const modelo = aiModels.find((m) => m.id === selectedAiModel) || aiModels[0];
  const pObj = aiPrompts.find((p) => p.id === promptKey) || aiPrompts[0];
  const rangoLabel =
    { ahora: 'dato más reciente', '24h': 'promedio últimas 24 horas', semana: 'resumen semanal' }[rangoVal] ||
    'dato más reciente';
  const nivelT = s.temp < 22 ? 'baja' : s.temp <= 28 ? 'moderada' : 'alta';
  const nivelH = s.humedad < 40 ? 'bajo' : s.humedad <= 70 ? 'moderado' : 'alto';

  const dirVientoTxt = s.dirViento ? ` desde ${s.dirViento}` : (s.direccion ? ` desde ${s.direccion}` : '');
  const lluviaFrase =
    s.precip > 0
      ? `Se registran precipitaciones de <b>${s.precip.toFixed(1)} mm</b>.`
      : 'No se han registrado precipitaciones recientes.';

  let resumenTexto = '';
  let leadAnalisis = '';

  if (promptKey === 'ejecutivo') {
    resumenTexto =
      rangoVal === '24h'
        ? `En las últimas 24 horas la estación <b>${escapeHtml(s.nombre)}</b> registra temperatura media de <b>${s.temp.toFixed(1)} °C</b> (mín ${s.min.toFixed(1)} °C / máx ${s.max.toFixed(1)} °C), humedad del <b>${s.humedad.toFixed(0)}%</b> y precipitación de <b>${s.precip.toFixed(1)} mm</b>. Nivel de riesgo térmico: <b>${ind.riesgo.nivel}</b>. Operatividad normal en el sector.`
        : rangoVal === 'semana'
        ? `Balance semanal en <b>${escapeHtml(s.nombre)}</b>: promedio térmico de <b>${s.temp.toFixed(1)} °C</b>, acumulación pluvial de <b>${s.precip.toFixed(1)} mm</b> y vientos de <b>${s.viento.toFixed(1)} km/h</b>. Parámetros ambientales estables para la planificación institucional.`
        : `Condición operativa en <b>${escapeHtml(s.nombre)}</b>: temperatura de <b>${s.temp.toFixed(1)} °C</b>, humedad de <b>${s.humedad.toFixed(0)}%</b>, radiación de <b>${s.radiacion} W/m²</b> y viento a <b>${s.viento.toFixed(1)} km/h</b>${dirVientoTxt}. Presión barométrica en <b>${s.presion.toFixed(1)} hPa</b>. Riesgo térmico: <b>${ind.riesgo.nivel}</b>.`;

    leadAnalisis = `Diagnóstico ejecutivo: Los parámetros meteorológicos evaluados se ubican dentro de los márgenes operacionales normales. La temperatura se categoriza como <b>${nivelT}</b> y la humedad relativa en rango <b>${nivelH}</b>. ${lluviaFrase} Las labores institucionales y comunitarias pueden continuar bajo protocolos estándar.`;
  } else if (promptKey === 'academico') {
    resumenTexto =
      rangoVal === '24h'
        ? `Monitoreo micrometeorológico (últimas 24 horas, estación ${escapeHtml(s.codigo || s.id)}): temperatura media de <b>${s.temp.toFixed(1)} °C</b> [${s.min.toFixed(1)} °C - ${s.max.toFixed(1)} °C], humedad relativa media del <b>${s.humedad.toFixed(0)}%</b>, precipitación acumulada de <b>${s.precip.toFixed(1)} mm</b> y barometría de <b>${s.presion.toFixed(1)} hPa</b>.`
        : rangoVal === 'semana'
        ? `Serie temporal semanal (estación ${escapeHtml(s.codigo || s.id)}): régimen térmico medio de <b>${s.temp.toFixed(1)} °C</b>, humedad atmosférica media del <b>${s.humedad.toFixed(0)}%</b>, precipitación acumulada de <b>${s.precip.toFixed(1)} mm</b> y flujo radiativo de <b>${s.radiacion} W/m²</b>.`
        : `Caracterización física instrumental (estación ${escapeHtml(s.codigo || s.id)}): temperatura del aire de <b>${s.temp.toFixed(1)} °C</b>, humedad relativa de <b>${s.humedad.toFixed(0)}%</b>, irradiancia solar incidente de <b>${s.radiacion} W/m²</b> (UV ${s.uv.toFixed(1)}) y presión atmosférica de <b>${s.presion.toFixed(1)} hPa</b>. Viento vectorial a <b>${s.viento.toFixed(1)} km/h</b>${dirVientoTxt}.`;

    leadAnalisis = `Fundamentación termodinámica: El punto de rocío instrumental se sitúa en <b>${ind.dp.toFixed(1)} °C</b> y la temperatura de bulbo húmedo estimada en <b>${ind.wb.toFixed(1)} °C</b>, con un déficit de presión de vapor (VPD) de <b>${ind.vpd.toFixed(2)} kPa</b>. La velocidad de viento corresponde a la escala Beaufort <b>${ind.bft.l}</b> (${s.viento.toFixed(1)} km/h). ${lluviaFrase}`;
  } else if (promptKey === 'alerta') {
    const hayAlerta = ind.riesgo.score > 50 || s.uv >= 8 || s.precip >= 15;
    const estadoAlerta = hayAlerta ? 'Vigilancia meteorológica activa' : 'Situación estable';
    resumenTexto =
      rangoVal === '24h'
        ? `<b>[${estadoAlerta}]</b> Registro 24h: temperatura máxima de ${s.max.toFixed(1)} °C, sensación térmica media de <b>${ind.hi.toFixed(1)} °C</b>, lluvia acumulada de <b>${s.precip.toFixed(1)} mm</b> y ráfagas de viento de hasta <b>${(s.viento * 1.35).toFixed(1)} km/h</b>. Nivel de riesgo térmico: <b>${ind.riesgo.nivel}</b>.`
        : rangoVal === 'semana'
        ? `<b>[${estadoAlerta}]</b> Balance semanal de seguridad: acumulado de precipitaciones de <b>${s.precip.toFixed(1)} mm</b>, temperatura media de <b>${s.temp.toFixed(1)} °C</b> y radiación solar acumulada de <b>${s.radiacion} W/m²</b>. Mantener las pautas de autoprotección vigentes.`
        : `<b>[${estadoAlerta}]</b> Aviso de prevención para <b>${escapeHtml(s.nombre)}</b>: sensación térmica de <b>${ind.hi.toFixed(1)} °C</b> (riesgo ${ind.riesgo.nivel}), radiación de <b>${s.radiacion} W/m²</b> (UV ${s.uv.toFixed(1)}) y viento a <b>${s.viento.toFixed(1)} km/h</b>${dirVientoTxt}. ${lluviaFrase}`;

    leadAnalisis = `Evaluación de riesgos y amenazas: El índice de calor se ubica en <b>${ind.hi.toFixed(1)} °C</b> con nivel de riesgo <b>${ind.riesgo.nivel}</b>. La radiación ultravioleta se clasifica como <b>${s.uv >= 11 ? 'Extrema' : s.uv >= 8 ? 'Muy Alta' : s.uv >= 6 ? 'Alta' : s.uv >= 3 ? 'Moderada' : 'Baja'}</b> (${s.radiacion} W/m²). ${lluviaFrase} Se recomienda acatar las instrucciones preventivas.`;
  } else {
    // tecnico o custom
    resumenTexto =
      rangoVal === '24h'
        ? `En las últimas 24 horas se registra una temperatura promedio de <b>${s.temp.toFixed(1)} °C</b> (mínima de ${s.min.toFixed(1)} °C y máxima de ${s.max.toFixed(1)} °C), humedad relativa media de <b>${s.humedad.toFixed(0)}%</b> y precipitación acumulada de <b>${s.precip.toFixed(1)} mm</b>. El viento promedió <b>${s.viento.toFixed(1)} km/h</b> con presión atmosférica de <b>${s.presion.toFixed(1)} hPa</b>.`
        : rangoVal === 'semana'
        ? `Durante los últimos 7 días la temperatura promedio se situó en <b>${s.temp.toFixed(1)} °C</b> (mínima de ${s.min.toFixed(1)} °C y máxima de ${s.max.toFixed(1)} °C), con humedad relativa media de <b>${s.humedad.toFixed(0)}%</b> y precipitación acumulada de <b>${s.precip.toFixed(1)} mm</b>. El viento promedió <b>${s.viento.toFixed(1)} km/h</b> y radiación solar promedio de <b>${s.radiacion} W/m²</b>.`
        : `Actualmente se registra una temperatura ambiente de <b>${s.temp.toFixed(1)} °C</b>, humedad relativa de <b>${s.humedad.toFixed(0)}%</b> y radiación solar de <b>${s.radiacion} W/m²</b>. El viento sopla a <b>${s.viento.toFixed(1)} km/h</b>${dirVientoTxt}. Presión atmosférica en <b>${s.presion.toFixed(1)} hPa</b>.`;

    leadAnalisis = `La temperatura actual se clasifica como <b>${nivelT}</b>, con una mínima de ${s.min.toFixed(1)} °C y máxima de ${s.max.toFixed(1)} °C. La humedad se mantiene en un rango <b>${nivelH}</b>. ${lluviaFrase}`;
  }

  let secIndex = 1;

  let html = `
    <header class="doc-utm-header">
      <div class="doc-utm-header-left">
        <h1 class="doc-main-title">Boletín climático</h1>
        <div class="doc-clean-meta">
          ${escapeHtml(s.nombre)} · ${conModelo ? 'Generado con ' + escapeHtml(modelo.name) : 'Plantilla local'} · ${escapeHtml(rangoLabel)} · ${escapeHtml(fecha)}
        </div>
      </div>
      <div class="doc-meteonet-brand-wrap">
        <img src="assets/images/logo_meteonet_dark_text.png" alt="UTM MeteoNet" class="doc-meteonet-header-logo" />
      </div>
    </header>

    <div class="doc-summary-callout">
      <div class="doc-summary-text">
        <b>Resumen.</b> ${resumenTexto}
      </div>
    </div>
  `;

  if (reportToggles.tecnicos) {
    html += `
      <div class="doc-section-card">
        <h3 class="doc-section-title">${secIndex++}. Análisis meteorológico</h3>
        <p class="doc-analisis-lead">${leadAnalisis}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#374151;line-height:1.5">
          Sensación térmica: <b>${ind.hi.toFixed(1)} °C</b> · Punto de rocío: <b>${ind.dp.toFixed(1)} °C</b> · Bulbo húmedo: <b>${ind.wb.toFixed(1)} °C</b> · Riesgo térmico: <b>${ind.riesgo.nivel}</b> · Escala viento: <b>${ind.bft.l}</b>.
        </p>
      </div>
    `;
  }

  if (reportToggles.kpisHistoricos) {
    html += `
      <div class="doc-kpi-row">
        <div class="doc-kpi-card">
          <span class="doc-kpi-label">Temperatura</span>
          <div class="doc-kpi-val">${s.temp.toFixed(1)} <small>°C</small></div>
          <div class="doc-kpi-sub">${s.subTemp}</div>
        </div>
        <div class="doc-kpi-card highlight">
          <span class="doc-kpi-label">Precipitación</span>
          <div class="doc-kpi-val">${s.precip.toFixed(1)} <small>mm</small></div>
          <div class="doc-kpi-sub">${s.subPrecip}</div>
        </div>
        <div class="doc-kpi-card">
          <span class="doc-kpi-label">Humedad relativa</span>
          <div class="doc-kpi-val">${s.humedad.toFixed(0)} <small>%</small></div>
          <div class="doc-kpi-sub">${s.subHum}</div>
        </div>
        <div class="doc-kpi-card">
          <span class="doc-kpi-label">Velocidad del viento</span>
          <div class="doc-kpi-val">${s.viento.toFixed(1)} <small>km/h</small></div>
          <div class="doc-kpi-sub">${s.subViento}</div>
        </div>
        <div class="doc-kpi-card">
          <span class="doc-kpi-label">Presión atmosférica</span>
          <div class="doc-kpi-val">${s.presion.toFixed(1)} <small>hPa</small></div>
          <div class="doc-kpi-sub">${s.subPres}</div>
        </div>
        <div class="doc-kpi-card">
          <span class="doc-kpi-label">Radiación e Índice UV</span>
          <div class="doc-kpi-val">${s.radiacion} <small>W/m²</small></div>
          <div class="doc-kpi-sub">${s.subRad}</div>
        </div>
      </div>
    `;
  }

  if (reportToggles.recomendaciones) {
    const listaRecs = generarRecomendacionesDinamicas(s, ind, rangoVal, promptKey);
    const recsHtml = listaRecs.map((r) => `<li>${r}</li>`).join('');
    html += `
      <div class="doc-section-card">
        <h3 class="doc-section-title">${secIndex++}. Recomendaciones y medidas preventivas</h3>
        <ul>
          ${recsHtml}
        </ul>
      </div>
    `;
  }

  if (reportToggles.analisisGrafico) {
    const tituloAcumulada =
      rangoVal === '24h'
        ? 'Lluvia acumulada en las últimas 24 horas'
        : rangoVal === 'semana'
        ? 'Lluvia acumulada en los últimos 7 días'
        : 'Lluvia acumulada en el día en curso';

    const subAcumulada =
      rangoVal === '24h'
        ? `Curva acumulativa horaria continua de las últimas 24 horas en la estación ${escapeHtml(s.nombre)} (total medido: ${s.precip.toFixed(1)} mm).`
        : rangoVal === 'semana'
        ? `Curva acumulativa diaria de los últimos 7 días en la estación ${escapeHtml(s.nombre)} (total acumulado: ${s.precip.toFixed(1)} mm).`
        : `Evolución horaria de precipitación acumulada del día hasta el dato actual en la estación ${escapeHtml(s.nombre)} (total: ${s.precip.toFixed(1)} mm).`;

    const tituloHoraria =
      rangoVal === '24h'
        ? 'Distribución horaria de lluvia (24 h)'
        : rangoVal === 'semana'
        ? 'Régimen horario consolidado (semanal)'
        : 'Perfil horario del día actual';

    const subHoraria =
      rangoVal === '24h'
        ? 'Franjas horarias con mayor actividad convectiva y concentración de lluvia en la jornada.'
        : rangoVal === 'semana'
        ? 'Patrón de concentración de precipitaciones por horas del día consolidado a lo largo de la semana.'
        : 'Distribución de precipitaciones medidas a lo largo de las horas del día de hoy.';

    html += `
      <div class="doc-grid-2col">
        <div class="doc-section-card" style="margin-bottom:0">
          <h3 class="doc-section-title">${tituloAcumulada}</h3>
          <p class="doc-section-sub">${subAcumulada}</p>
          ${renderCumulativeRainSvg(s, rangoVal)}
        </div>
        <div class="doc-section-card" style="margin-bottom:0">
          <h3 class="doc-section-title">${tituloHoraria}</h3>
          <p class="doc-section-sub">${subHoraria}</p>
          ${renderHourlyRainSvg(s, rangoVal)}
        </div>
      </div>
    `;
  }

  const permiteHistoricos = rangoVal === 'semana';

  if (reportToggles.lluviaMensual && permiteHistoricos) {
    html += `
      <div class="doc-section-card">
        <h3 class="doc-section-title">Contexto climatológico mensual de referencia</h3>
        <p class="doc-section-sub">
          Serie histórica comparativa mensual de lluvia acumulada (mm) en la estación meteorológica ${escapeHtml(s.nombre)}. Sirve de referencia estacional macro frente a las lecturas del periodo evaluado.
        </p>
        <div class="doc-legend">
          <span class="doc-legend-item"><span class="doc-legend-dot" style="background:#1e6b14"></span> Precipitaciones recientes</span>
          <span class="doc-legend-item"><span class="doc-legend-dot" style="background:#439541"></span> Temporada lluviosa (ene - jun)</span>
          <span class="doc-legend-item"><span class="doc-legend-dot" style="background:#cbd5e1"></span> Resto de meses</span>
          <span class="doc-legend-item"><span class="doc-legend-dot" style="background:repeating-linear-gradient(45deg,#94a3b8,#94a3b8 2px,#fff 2px,#fff 5px)"></span> Mes con datos incompletos</span>
        </div>
        ${renderMonthlyRainSvg(s, rangoVal)}
      </div>
    `;
  }

  if (reportToggles.tormentasRanking && permiteHistoricos) {
    html += `
      <div class="doc-section-card">
        <h3 class="doc-section-title">Récords históricos de la estación (Referencia comparativa)</h3>
        <p class="doc-section-sub">
          Registro histórico de los episodios de tormenta de mayor volumen y duración medidos por la estación ${escapeHtml(s.nombre)}. Permite dimensionar la magnitud del periodo actual frente a eventos extremos.
        </p>
        ${renderTopStormsTable(s, rangoVal)}
      </div>
    `;
  }

  html += `
    <footer class="doc-footer-source">
      Fuente: Registros meteorológicos de la estación ${escapeHtml(s.codigo || s.id)} (${escapeHtml(s.nombre)}), Red de Observación UTM MeteoNet. Un evento de lluvia termina cuando pasan 2 horas o más sin llover. Modelo de análisis: ${escapeHtml(modelo.name)} · Fecha de emisión: ${escapeHtml(fecha)}.
    </footer>
    <div class="doc-footer-ia">
      <span class="doc-footer-ia-marca">Generado por MeteoNet · Universidad Técnica de Manabí</span>
      <span class="doc-footer-ia-prompt">Prompt: ${escapeHtml(pObj.name)}</span>
    </div>
  `;

  return html;
}

function renderReportHistorial() {
  const body = $('#historyBody');
  const hint = $('#emptyHint');
  if (!body) return;
  if (!reportSessionHistory.length) {
    body.innerHTML = '';
    if (hint) hint.style.display = 'block';
    return;
  }
  if (hint) hint.style.display = 'none';
  body.innerHTML = reportSessionHistory
    .map(
      (h) => `
    <tr>
      <td data-label="Fecha" class="td-cabecera">${escapeHtml(h.fecha)}</td>
      <td data-label="Estación">${escapeHtml(h.estacion)}</td>
      <td data-label="Modelo">${escapeHtml(h.modelo)}</td>
      <td data-label="Plantilla">${escapeHtml(h.prompt)}</td>
      <td data-label="Palabras" class="num">${h.palabras}</td>
    </tr>`
    )
    .join('');
}

function construirTextoDescarga() {
  if (!lastGeneratedReportData) return '';
  const { s, ind, modelo, fecha, tiempoResp, palabras, promptKey, rangeVal } = lastGeneratedReportData;
  const linea = '='.repeat(70);
  const pObj = aiPrompts.find((p) => p.id === promptKey) || aiPrompts[0];
  const recs = generarRecomendacionesDinamicas(s, ind, rangeVal || 'ahora', promptKey);
  const recsTexto = recs.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `BOLETÍN CLIMÁTICO GENERADO CON IA (UTM METEONET)
${linea}

MODELO SELECCIONADO
Modelo: ${modelo.name}
Plantilla: ${pObj.name}
Fecha de emisión: ${fecha}

${linea}
DATOS DE LA ESTACIÓN (6 VARIABLES FÍSICAS)
${linea}
Estación: ${s.nombre} (${s.codigo || s.id})
1. Temperatura ambiente: ${s.temp.toFixed(2)} °C (Mín: ${s.min.toFixed(1)} °C, Máx: ${s.max.toFixed(1)} °C)
2. Precipitación: ${s.precip.toFixed(2)} mm
3. Humedad relativa: ${s.humedad.toFixed(1)} %
4. Velocidad del viento: ${s.viento.toFixed(2)} km/h, dirección ${s.direccion}
5. Presión atmosférica: ${s.presion.toFixed(2)} hPa
6. Radiación solar: ${s.radiacion} W/m² (Índice UV: ${s.uv.toFixed(1)})

INDICADORES BIOCLIMÁTICOS Y DE RIESGO
Punto de rocío: ${ind.dp.toFixed(2)} °C
Índice de calor / Sensación térmica: ${ind.hi.toFixed(2)} °C
Bulbo húmedo estimado: ${ind.wb.toFixed(2)} °C
Déficit de presión de vapor: ${ind.vpd.toFixed(2)} kPa
Escala Beaufort: ${ind.bft.n} (${ind.bft.l})
Nivel de posibilidad de lluvia: ${ind.lluvia.nivel} (${ind.lluvia.score}/100)
Nivel de riesgo térmico: ${ind.riesgo.nivel} (${ind.riesgo.score}/100)

${linea}
RECOMENDACIONES Y MEDIDAS PREVENTIVAS
${linea}
${recsTexto}

${linea}
MÉTRICAS TÉCNICAS DEL PROCESO
${linea}
Tiempo de respuesta del modelo: ${tiempoResp} segundos
Cantidad de palabras del boletín: ${palabras}
`;
}

function crearHtmlDescarga() {
  const docElem = $('#reportDocument');
  const markup = docElem ? docElem.innerHTML : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Boletín climático · MeteoNet UTM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:40px 16px;background:#f3f5ef;color:#22301a;font-family:'Montserrat',sans-serif;}
.report-document{max-width:820px;margin:auto;padding:36px 44px;background:#fff;border:1px solid #e3e7db;border-radius:12px;box-shadow:0 8px 24px rgba(40,60,20,.08);color:#22301a;}
.doc-utm-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #8cc63f;padding-bottom:16px;margin-bottom:18px;}
.doc-utm-header-left{flex:1;min-width:0;}
.doc-top-meta{font-size:10.5px;font-weight:700;letter-spacing:.05em;color:#5b6a52;margin-bottom:6px;}
.doc-main-title{font-size:24px;font-weight:700;color:#17220f;line-height:1.25;margin:0 0 6px;}
.doc-clean-meta{font-size:11.5px;color:#5b6a52;font-weight:500;line-height:1.4;}
.doc-summary-callout{display:flex;align-items:flex-start;gap:12px;background:#f2f7ed;border-left:4px solid #8cc63f;border-radius:6px;padding:13px 16px;margin:16px 0 18px;font-size:13px;line-height:1.55;color:#24341e;}
.doc-summary-icon{font-size:18px;line-height:1.2;flex-shrink:0;}
.doc-summary-text{flex:1;}
.doc-summary-text b{font-weight:700;color:#1e6b14;}
.doc-analisis-lead{font-size:13px;line-height:1.6;color:#2e3a28;margin:0 0 14px;}
.doc-meteonet-brand-wrap{flex-shrink:0;padding-left:14px;display:flex;align-items:center;}
.doc-meteonet-header-logo{height:52px;width:auto;display:block;}
.doc-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 20px;}
.doc-kpi-card{background:#ffffff;border:1px solid #e3e7db;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;}
.doc-kpi-card.highlight{border-color:#cbd5e1;background:#fafbf9;}
.doc-kpi-label{font-size:10.5px;color:#5b6a52;font-weight:600;margin-bottom:4px;}
.doc-kpi-val{font-size:22px;font-weight:700;color:#17220f;line-height:1.1;margin-bottom:6px;}
.doc-kpi-val small{font-size:12px;font-weight:600;color:#5b6a52;}
.doc-kpi-sub{font-size:10.5px;color:#6b7280;line-height:1.4;}
.doc-section-card{background:#fbfcf9;border:1px solid #e3e7db;border-radius:10px;padding:18px 20px;margin-bottom:16px;}
.doc-section-title{font-size:14px;font-weight:700;color:#1e6b14;margin:0 0 6px;}
.doc-section-sub{font-size:12px;color:#4b5563;line-height:1.5;margin:0 0 14px;}
.doc-legend{display:flex;gap:16px;font-size:11px;color:#4b5563;margin-bottom:12px;flex-wrap:wrap;}
.doc-legend-item{display:flex;align-items:center;gap:6px;}
.doc-legend-color{width:12px;height:12px;border-radius:2px;display:inline-block;}
.doc-bar-chart{display:flex;flex-direction:column;gap:10px;margin-top:10px;}
.doc-bar-row{display:grid;grid-template-columns:70px 1fr 140px;align-items:center;gap:12px;}
.doc-bar-month{font-size:11.5px;font-weight:600;color:#2e3a28;}
.doc-bar-track-wrap{display:flex;flex-direction:column;gap:4px;}
.doc-bar-track{background:#e8ece2;height:12px;border-radius:6px;overflow:hidden;}
.doc-bar-fill{height:100%;border-radius:6px;}
.doc-bar-values{font-size:11px;color:#2e3a28;display:flex;flex-direction:column;gap:2px;text-align:right;}
.doc-grid-2col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;}
.doc-table{width:100%;border-collapse:collapse;font-size:11.5px;}
.doc-table th{text-align:left;padding:8px 10px;font-size:10.5px;color:#5b6a52;border-bottom:1.5px solid #d9e1d0;}
.doc-table td{padding:8px 10px;border-bottom:1px solid #edf1e7;color:#2e3a28;}
.doc-takeaway-list{margin:0;padding-left:18px;}
.doc-takeaway-list li{font-size:12.5px;line-height:1.6;color:#2e3a28;margin-bottom:8px;}
.doc-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;}
.doc-storms-table{width:100%;border-collapse:collapse;font-size:11.5px;}
.doc-storms-table th{text-align:left;padding:6px 8px;color:#5b6a52;border-bottom:1.5px solid #d9e1d0;font-weight:700;font-size:10.5px;}
.doc-storms-table td{padding:7px 8px;border-bottom:1px solid #edf1e7;color:#2e3a28;}
.doc-storms-table tr.nino-row{background:#f4faf2;font-weight:700;color:#1e6b14;}
.doc-storm-bar-wrap{display:flex;align-items:center;gap:8px;}
.doc-storm-bar{height:8px;border-radius:4px;background:#439541;}
.doc-storms-table tr.nino-row .doc-storm-bar{background:#1e6b14;}
.doc-data{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;}
.doc-data span{background:#f8faf6;padding:9px 12px;border:1px solid #e5ece0;border-radius:8px;font-size:11px;color:#5b6a52;display:flex;flex-direction:column;gap:3px;}
.doc-data b{font-size:14px;color:#1e6b14;font-weight:700;}
.doc-footer-source{margin-top:22px;padding-top:12px;border-top:1px solid #e3e7db;font-size:9.5px;color:#6b7280;line-height:1.5;text-align:justify;}
.doc-footer-ia{margin-top:10px;padding-top:9px;border-top:1px solid #e3e7db;display:flex;flex-direction:column;gap:2px;text-align:center;}
.doc-footer-ia-marca{font-size:10px;font-weight:700;color:#1e6b14;letter-spacing:.2px;}
.doc-footer-ia-prompt{font-size:9.5px;color:#6b7280;}
@media print{ body{padding:0;background:#fff;} .report-document{border:0;box-shadow:none;max-width:none;} }
@media (max-width:680px){ .doc-utm-header{flex-direction:column-reverse;gap:12px;} .doc-kpi-row{grid-template-columns:1fr 1fr;} .doc-grid-2col{grid-template-columns:1fr;} }
</style></head><body><article class="report-document">${markup}</article></body></html>`;
}

function actualizarDisponibilidadToggles() {
  const rangeVal = $('#reportRange') ? $('#reportRange').value : 'ahora';
  const permiteHistoricos = rangeVal === 'semana';
  const switchesHistoricos = document.querySelectorAll(
    '.switch[data-toggle="lluviaMensual"], .switch[data-toggle="tormentasRanking"]'
  );
  switchesHistoricos.forEach((sw) => {
    const row = sw.closest('.toggle-row');
    sw.disabled = !permiteHistoricos;
    sw.style.opacity = permiteHistoricos ? '1' : '0.45';
    sw.style.pointerEvents = permiteHistoricos ? 'auto' : 'none';
    if (row) {
      let badge = row.querySelector('.range-badge-hint');
      if (!permiteHistoricos) {
        if (!badge) {
          badge = document.createElement('small');
          badge.className = 'range-badge-hint';
          badge.style.cssText = 'display:block;font-size:9.5px;color:#78866b;margin-top:2px;';
          badge.textContent = '(Disponible en resumen semanal)';
          row.querySelector('span')?.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    }
  });
}

/* Cualquier cambio de parametro invalida el boletin mostrado: la vista
   previa vuelve a quedar vacia hasta que se presione "Generar boletin"
   otra vez, para que lo que se ve corresponda siempre a lo generado. */
function reiniciarVistaPreviaBoletin() {
  actualizarDisponibilidadToggles();
  if (!boletinGenerado) return;
  boletinGenerado = false;
  mostrarVistaPreviaVacia();
  showToast('Par\u00e1metro cambiado: genera el bolet\u00edn de nuevo');
}

function generarReporteIA() {
  const rangeVal = $('#reportRange') ? $('#reportRange').value : 'ahora';
  const stationRaw = getSelectedReportStation();
  const s = normalizeStationForReport(stationRaw, rangeVal);
  if (!s) return showToast('Por favor selecciona una estación');
  const modelo = aiModels.find((m) => m.id === selectedAiModel) || aiModels[0];
  const btn = $('#generateButton');
  const status = $('#statusText');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>◌</span> Generando con ' + escapeHtml(modelo.name) + '…';
  }
  if (status) {
    status.textContent = 'Analizando datos de la estación…';
  }

  const inicio = performance.now();

  (async () => {
    const ind = calcularIndicadores(s);
    const fecha = new Date().toLocaleString('es-EC');
    /* Si config.js define un endpoint, el texto lo redacta el modelo. Sin
       endpoint se usa la plantilla local y el documento lo dice en su cabecera,
       para no atribuir a un modelo un texto que no escribio. */
    const textoModelo = await pedirBoletinAlModelo(s, ind, rangeVal, modelo);
    const conModelo = Boolean(textoModelo);
    let docHtml = construirDocumento(s, ind, rangeVal, fecha, selectedAiPrompt, conModelo);
    if (textoModelo) {
      docHtml = insertarTextoDelModelo(docHtml, textoModelo);
    } else if (CFG_BOLETIN.endpoint) {
      showToast('No se pudo consultar el modelo: se usa la plantilla local');
    }

    const docElem = $('#reportDocument');
    if (docElem) {
      docElem.classList.remove('vacio');
      docElem.innerHTML = docHtml;
    }
    boletinGenerado = true;

    const tiempoResp = ((performance.now() - inicio) / 1000).toFixed(2);
    const palabras = docHtml.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>✦</span> Generar boletín';
    }
    if (status) {
      status.textContent = conModelo ? 'Generado ahora · ' + modelo.name : 'Generado ahora · plantilla local';
    }
    showToast('Bolet\u00edn generado');

    const pObj = aiPrompts.find((p) => p.id === selectedAiPrompt) || aiPrompts[0];
    lastGeneratedReportData = { s, ind, modelo, rangeVal, fecha, tiempoResp, palabras, promptKey: selectedAiPrompt, conModelo };
    reportSessionHistory.unshift({
      fecha,
      estacion: s.nombre,
      modelo: conModelo ? modelo.name : 'Plantilla local',
      prompt: pObj.name,
      palabras,
    });
    renderReportHistorial();
  })();
}

/* Pide el texto del boletin al servicio configurado en config.js.
   Devuelve null si no hay endpoint o si la consulta falla, y entonces se
   mantiene la plantilla local. */
async function pedirBoletinAlModelo(s, ind, rangeVal, modelo) {
  if (!CFG_BOLETIN.endpoint) return null;
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), Number(CFG_BOLETIN.tiempoLimiteMs) || 60000);
  try {
    const res = await fetch(CFG_BOLETIN.endpoint, {
      method: 'POST',
      headers: CFG_BOLETIN.cabeceras || { 'Content-Type': 'application/json' },
      signal: control.signal,
      body: JSON.stringify({
        model: modelo.id,
        prompt: [
          promptActualTexto(),
          `Estaci\u00f3n: ${s.nombre} (${s.codigo}). Periodo: ${rangeVal}.`,
          'Redacta el an\u00e1lisis del bolet\u00edn en espa\u00f1ol, en p\u00e1rrafos separados por una l\u00ednea en blanco.',
          'No inventes valores: usa solo los datos entregados y omite lo que falte.',
        ].join(' '),
        weatherData: {
          estacion: s.nombre,
          codigo: s.codigo,
          periodo: rangeVal,
          temperatura: s.temp,
          temperaturaMin: s.min,
          temperaturaMax: s.max,
          sensacion: s.sens,
          humedad: s.humedad,
          precipitacion: s.precip,
          presion: s.presion,
          vientoKmh: s.viento,
          direccionViento: s.direccion,
          radiacion: s.radiacion,
          indiceUv: s.uv,
        },
      }),
    });
    if (!res.ok) return null;
    const datos = await res.json();
    const texto = String(datos?.report || '').trim();
    return texto || null;
  } catch {
    return null;
  } finally {
    clearTimeout(corte);
  }
}

/* Sustituye el parrafo de analisis de la plantilla por el texto del modelo */
function insertarTextoDelModelo(html, texto) {
  const parrafos = texto
    .split(/\n{2,}/)
    .map((t) => `<p class="doc-analisis-lead">${escapeHtml(t.trim())}</p>`)
    .join('');
  return html.replace(
    /<p class="doc-analisis-lead">[\s\S]*?<\/p>/,
    parrafos || '<p class="doc-analisis-lead"></p>'
  );
}

function renderReportPreview() {
  const sel = $('#reportStation');
  if (sel) {
    sel.innerHTML = state.stations
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === state.selectedStationId ? 'selected' : ''}>${escapeHtml(s.location)} (${escapeHtml(s.code || s.name)})</option>`
      )
      .join('');
  }

  const modelCont = $('#modelList');
  if (modelCont) {
    modelCont.innerHTML = aiModels
      .map(
        (m) => `
      <div class="model-option${m.id === selectedAiModel ? ' selected' : ''}" data-model="${m.id}">
        <span class="badge">${m.badge}</span>
        <div><span class="model-name">${escapeHtml(m.name)}</span><small>${escapeHtml(m.note)}</small></div>
        <i class="check">✓</i>
      </div>`
      )
      .join('');
  }

  const promptCont = $('#promptList');
  if (promptCont) {
    promptCont.innerHTML = aiPrompts
      .map(
        (p) => `
      <button type="button" class="prompt-choice${p.id === selectedAiPrompt ? ' selected' : ''}" data-prompt="${p.id}">
        ${escapeHtml(p.name)}<small>${escapeHtml(p.note)}</small>
      </button>`
      )
      .join('');
  }

  const customPrompt = $('#admCustomPrompt');
  if (customPrompt) {
    customPrompt.style.display = selectedAiPrompt === 'custom' ? 'block' : 'none';
  }
  updatePromptHint();

  document.querySelectorAll('.switch[data-toggle]').forEach((btn) => {
    const key = btn.dataset.toggle;
    if (key in reportToggles) {
      btn.classList.toggle('on', Boolean(reportToggles[key]));
    }
  });

  renderReportHistorial();

  /* La vista previa queda vacia hasta que la persona presiona
     "Generar boletin". Antes se armaba sola al entrar a la pagina y al
     cambiar cualquier opcion, lo que hacia indistinguible un boletin
     generado de uno que no. */
  if (!boletinGenerado) mostrarVistaPreviaVacia();
}

/* Marca si ya se genero un boletin en esta visita a la pagina */
let boletinGenerado = false;

function mostrarVistaPreviaVacia() {
  const docElem = $('#reportDocument');
  if (!docElem) return;
  docElem.classList.add('vacio');
  docElem.innerHTML = `
    <div class="doc-vacio">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <polyline points="14 3 14 8 19 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
      <p class="doc-vacio-titulo">A\u00fan no hay bolet\u00edn</p>
      <p class="doc-vacio-texto">Elige la estaci\u00f3n, el periodo y el tipo de redacci\u00f3n, y presiona \u00abGenerar bolet\u00edn\u00bb.</p>
    </div>`;
  const estado = $('#statusText');
  if (estado) estado.textContent = 'Listo para generar';
  lastGeneratedReportData = null;
}

function renderAlerts() {
  renderAlertStatus();
  renderThresholdRules();
}

/* Panel izquierdo: como esta cada regla en la estacion seleccionada */
function renderAlertStatus() {
  const cont = $('#alertList');
  if (!cont) return;
  const activas = calculateAlerts();
  const nota = $('#alertStationNote');
  const est = currentStation();
  if (nota) nota.textContent = est ? est.location : '';

  if (!activas.length) {
    cont.innerHTML = '<p class="nota">No hay reglas activas. Activa alguna en el panel de la derecha.</p>';
    return;
  }

  cont.innerHTML = activas
    .map(
      (a) => `
      <div class="rio-item">
        <div class="rio-cab">
          <span class="ru-titulo">${escapeHtml(a.type)}</span>
          <span class="insignia ${a.triggered ? 'mal' : 'ok'}">${a.triggered ? 'L\u00edmite cruzado' : 'Normal'}</span>
        </div>
        <p class="nota">Lectura ${escapeHtml(String(Math.round(Number(a.reading) * 10) / 10))} ${escapeHtml(a.unit)} \u00b7 l\u00edmite ${escapeHtml(a.operador.simbolo)} ${escapeHtml(String(a.value))} ${escapeHtml(a.unit)}</p>
      </div>`
    )
    .join('');
}

/* Panel derecho: cada regla se edita en su sitio, sin abrir un modal */
function renderThresholdRules() {
  const cont = $('#thresholdList');
  if (!cont) return;
  const nota = $('#thresholdCountNote');
  if (nota) {
    const act = state.alerts.filter((a) => a.active).length;
    nota.textContent = `${state.alerts.length} reglas \u00b7 ${act} activas`;
  }

  if (!state.alerts.length) {
    cont.innerHTML = '<p class="nota">Todav\u00eda no hay reglas. Usa \u00abNueva alerta\u00bb para crear la primera.</p>';
    return;
  }

  cont.innerHTML = state.alerts
    .map((a) => {
      const unidad = VARIABLE_UNITS[a.condition] || '';
      const variables = VARIABLES_ALERTA.map(
        (v) => `<option value="${v}" ${v === a.condition ? 'selected' : ''}>${escapeHtml((VARIABLE_LABELS[v] || v).replace(/\s*\(.*\)$/, ''))}</option>`
      ).join('');
      const operadores = Object.entries(OPERADORES)
        .map(([k, o]) => `<option value="${k}" ${k === (a.operator || '>') ? 'selected' : ''}>${escapeHtml(o.etiqueta)}</option>`)
        .join('');
      return `
      <div class="regla-umbral ${a.active ? '' : 'inactiva'}" data-rule="${escapeHtml(a.id)}">
        <div class="ru-cab">
          <input class="entrada ru-nombre" type="text" value="${escapeHtml(a.type)}" data-rule-field="type"
            aria-label="Nombre de la regla" />
          <button type="button" class="switch ${a.active ? 'on' : ''}" data-toggle-alert="${escapeHtml(a.id)}"
            role="switch" aria-checked="${a.active}" aria-label="Activar o desactivar la regla"><i></i></button>
        </div>
        <div class="ru-campos">
          <label class="ru-campo">
            <span>Variable</span>
            <select class="selector" data-rule-field="condition">${variables}</select>
          </label>
          <label class="ru-campo">
            <span>Comparador</span>
            <select class="selector" data-rule-field="operator">${operadores}</select>
          </label>
          <label class="ru-campo ru-campo-valor">
            <span>L\u00edmite</span>
            <span class="ru-valor-wrap">
              <input class="entrada" type="number" step="0.1" value="${escapeHtml(String(a.value))}"
                data-rule-field="value" aria-label="Valor del l\u00edmite" />
              <small class="ru-unidad">${escapeHtml(unidad)}</small>
            </span>
          </label>
        </div>
        <div class="ru-pie">
          <span class="ru-estado nota">${a.active ? 'Vigilando' : 'Sin vigilar'}</span>
          <div class="ru-acciones">
            <button type="button" class="enlace ru-eliminar" data-delete-alert="${escapeHtml(a.id)}">Eliminar</button>
            <button type="button" class="boton pequeno ru-aplicar" data-apply-alert="${escapeHtml(a.id)}" disabled>
              Actualizar
            </button>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function renderUsers() {
  $('#usersTable').innerHTML = state.users
    .map(
      (u) => `
      <tr>
        <td data-label="Usuario" class="td-cabecera">${escapeHtml(u.name)}</td>
        <td data-label="Correo">${escapeHtml(u.email)}</td>
        <td data-label="Rol">${escapeHtml(u.role)}</td>
        <td data-label="Estado"><span class="insignia ok">${escapeHtml(u.status)}</span></td>
        <td data-label="Acción" class="td-acciones">${u.id !== 'jorge' ? `<button class="boton peligro pequeno" type="button" data-delete-user="${u.id}" style="width:100%">Eliminar</button>` : ''}</td>
      </tr>`
    )
    .join('');
}

function renderSettings() {
  const form = $('#settingsForm');
  if (!form) return;
  form.adminName.value = state.settings.adminName || '';
  form.adminEmail.value = state.settings.adminEmail || '';
  form.apiUrl.value = state.settings.apiUrl || '';
  form.aiModel.value = state.settings.aiModel || 'gemma-3';
  if (form.intervaloMinutos) form.intervaloMinutos.value = String(intervaloDeMuestreo());
  if (form.usarUbicacion) form.usarUbicacion.checked = state.settings.usarUbicacion !== false;
}

/* ---------- Navegación y Modales ---------- */
function showPage(id) {
  const adminOnlyPages = ['estaciones', 'historico', 'alertas', 'reportes', 'usuarios', 'configuracion'];
  if (adminOnlyPages.includes(id) && !isAdmin()) {
    showToast('Esta sección requiere acceso de administrador');
    id = 'inicio';
  }
  currentViewId = id;
  $all('[data-view]').forEach((section) => {
    section.hidden = section.id !== id;
  });
  $all('.web-nav-link').forEach((btn) => {
    btn.classList.toggle('activo', btn.dataset.page === id);
  });
  $('#adminMenuBtn')?.classList.toggle('activo', adminOnlyPages.includes(id));
  closeAdminMenu();
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', '#' + id);
  } else {
    window.location.hash = id;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });

  renderCurrentView();
}

/* Redibuja el contenido de la vista activa sin navegar: no mueve el scroll
   ni reescribe el historial. */
function renderCurrentView() {
  const id = currentViewId;
  if (id === 'inicio') renderDashboard();
  if (id === 'solicitar-datos') renderDataRequestForm();
  if (id === 'estaciones') renderStations();
  if (id === 'historico') renderHistory();
  if (id === 'alertas') renderAlerts();
  if (id === 'reportes') renderReportPreview();
  if (id === 'usuarios') renderUsers();
  if (id === 'configuracion') renderSettings();
}

function renderAll() {
  renderHeader();
  showPage(currentViewId);
}

/* Refresco tras una actualizacion de datos (por ejemplo la sincronizacion
   con el servidor UTM). Usa renderCurrentView en lugar de renderAll para
   que la pagina no salte al inicio mientras la persona esta leyendo. */
function refrescarDatos() {
  renderHeader();
  renderCurrentView();
}

function openModal(htmlContent, onSubmitCallback) {
  const modal = $('#modal');
  const content = $('#modalContent');
  const form = $('#modalForm');
  content.innerHTML = htmlContent;
  form.onsubmit = (e) => {
    e.preventDefault();
    if (onSubmitCallback) onSubmitCallback(new FormData(form));
  };
  if (!modal.open) modal.showModal();
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (link.parentNode) link.parentNode.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1200);
}

/* ---------- Eventos ---------- */

/* ---------- Edicion de reglas de umbral ----------
   Escribir en un campo no cambia nada todavia: la regla queda marcada como
   pendiente y el cambio se aplica al presionar "Actualizar". Asi una
   pulsacion de teclas a medias nunca altera la vigilancia. */
function marcarReglaPendiente(fila, pendiente) {
  fila.classList.toggle('pendiente', pendiente);
  const boton = fila.querySelector('[data-apply-alert]');
  if (boton) boton.disabled = !pendiente;
  const estado = fila.querySelector('.ru-estado');
  if (estado && pendiente) estado.textContent = 'Cambios sin aplicar';
}

/* Compara lo que hay en los campos con lo guardado */
function reglaTieneCambios(fila, regla) {
  const leer = (clave) => fila.querySelector(`[data-rule-field="${clave}"]`);
  const nombre = (leer('type')?.value || '').trim();
  const variable = leer('condition')?.value;
  const operador = leer('operator')?.value;
  const limite = Number(leer('value')?.value);
  return (
    nombre !== regla.type ||
    variable !== regla.condition ||
    operador !== (regla.operator || '>') ||
    !Number.isFinite(limite) ||
    limite !== Number(regla.value)
  );
}

['input', 'change'].forEach((evento) => {
  document.addEventListener(evento, (ev) => {
    const campo = ev.target.closest('[data-rule-field]');
    if (!campo) return;
    const fila = campo.closest('[data-rule]');
    const regla = fila && state.alerts.find((a) => a.id === fila.dataset.rule);
    if (!regla) return;

    /* La unidad del limite acompana a la variable elegida aunque todavia
       no se haya aplicado, para que el numero se escriba con contexto */
    if (campo.dataset.ruleField === 'condition') {
      const unidad = fila.querySelector('.ru-unidad');
      if (unidad) unidad.textContent = VARIABLE_UNITS[campo.value] || '';
    }
    marcarReglaPendiente(fila, reglaTieneCambios(fila, regla));
  });
});

document.addEventListener('click', (event) => {
  const printBtn = event.target.closest('#printReportButton');
  if (printBtn) {
    exportarReportePdf();
    return;
  }

  const downloadHtmlBtn = event.target.closest('#downloadHtmlButton');
  if (downloadHtmlBtn) {
    descargarReporteHtml();
    return;
  }

  const downloadTxtBtn = event.target.closest('#downloadTxtButton');
  if (downloadTxtBtn) {
    descargarReporteTxt();
    return;
  }

  /* Cerrar el detalle de alerta abierto al tocar fuera de el */
  if (!event.target.closest('.mei-alerta-wrap')) {
    document.querySelectorAll('.mei-alerta-wrap.abierta').forEach((n) => n.classList.remove('abierta'));
  }

  const navBtn = event.target.closest('[data-page]');
  if (navBtn) {
    showPage(navBtn.dataset.page);
    $('#mainLayoutBody')?.classList.remove('sidebar-movil-activo');
    return;
  }

  const brandLink = event.target.closest('[data-page-link]');
  if (brandLink) {
    event.preventDefault();
    showPage(brandLink.dataset.pageLink);
    return;
  }

  const mapVarBtn = event.target.closest('[data-map-var]');
  if (mapVarBtn) {
    mapOptions.variable = mapVarBtn.dataset.mapVar;
    $all('[data-map-var]').forEach((b) => b.classList.toggle('activo', b.dataset.mapVar === mapOptions.variable));
    renderMapControlsAndList();
    renderMainWeatherMap();
    return;
  }

  const quickStationBtn = event.target.closest('[data-quick-station]');
  if (quickStationBtn) {
    if (currentViewId !== 'inicio') {
      showPage('inicio');
    }
    selectStationFromMap(quickStationBtn.dataset.quickStation, true);
    $('#mainLayoutBody')?.classList.remove('sidebar-movil-activo');
    return;
  }

  const selStationBtn = event.target.closest('[data-select-station]');
  if (selStationBtn) {
    state.selectedStationId = selStationBtn.dataset.selectStation;
    saveState();
    renderHeader();
    showPage('inicio');
    return;
  }

  const editStBtn = event.target.closest('[data-edit-station]');
  if (editStBtn) {
    const st = state.stations.find((s) => s.id === editStBtn.dataset.editStation);
    if (!st) return;
    openModal(
      `<h2>Editar estación</h2>
       <div class="campo"><label>Código / Nombre</label><input class="entrada" name="code" value="${escapeHtml(st.code || st.name)}" required /></div>
       <div class="campo"><label>Ubicación</label><input class="entrada" name="location" value="${escapeHtml(st.location)}" required /></div>
       <div class="campo">
         <label>Institución o entidad propietaria</label>
         <input class="entrada" name="owner" id="editStationOwner" value="${escapeHtml(st.owner || 'UTM')}" required />
       </div>
       <div class="campo">
         <label>Logo de la entidad propietaria</label>
         <div style="display:flex;align-items:center;gap:12px;background:var(--superficie2);border:1px solid var(--borde);border-radius:10px;padding:10px 12px;">
           <div style="width:48px;height:48px;border-radius:8px;background:#fff;border:1px solid var(--borde);display:grid;place-items:center;padding:4px;flex-shrink:0;">
             <img id="editLogoPreview" src="${escapeHtml(st.ownerLogo || 'assets/images/logo_utm_escudo.png')}" alt="Logo de la entidad" style="max-width:100%;max-height:100%;object-fit:contain;" />
           </div>
           <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
             <div style="display:flex;gap:8px;flex-wrap:wrap;">
               <label class="btn-estilo-reporte" style="cursor:pointer;margin:0;font-size:11.5px;padding:5px 10px;height:auto;">
                 Cambiar imagen
                 <input type="file" id="editLogoFileInput" accept="image/*" style="display:none;" />
               </label>
               <button type="button" class="btn-estilo-reporte" id="editLogoResetUtmBtn" style="font-size:11.5px;padding:5px 10px;height:auto;">
                 Escudo UTM
               </button>
             </div>
             <input type="hidden" name="ownerLogo" id="editLogoHidden" value="${escapeHtml(st.ownerLogo || 'assets/images/logo_utm_escudo.png')}" />
             <small style="font-size:10.5px;color:var(--texto3);">Sube una imagen para la dueña de la estación o mantén el escudo de la UTM.</small>
           </div>
         </div>
       </div>
       <div class="exp-form">
         <label>Latitud<input class="entrada" name="latitude" type="number" step="0.000001" value="${st.latitude ?? ''}" /></label>
         <label>Longitud<input class="entrada" name="longitude" type="number" step="0.000001" value="${st.longitude ?? ''}" /></label>
       </div>
       <div class="fila-botones" style="margin-top:14px"><button class="boton" type="submit">Guardar</button></div>`,
      (fd) => {
        st.code = fd.get('code').trim();
        st.location = fd.get('location').trim();
        st.name = `${st.location} · ${st.code}`;
        st.owner = (fd.get('owner') || '').trim() || 'UTM';
        st.ownerLogo = (fd.get('ownerLogo') || '').trim() || 'assets/images/logo_utm_escudo.png';
        st.latitude = Number(fd.get('latitude')) || st.latitude;
        st.longitude = Number(fd.get('longitude')) || st.longitude;
        saveState();
        $('#modal').close();
        renderAll();
        showToast('Estación actualizada con éxito');
      }
    );

    const editFileInput = $('#editLogoFileInput');
    const editPreview = $('#editLogoPreview');
    const editHidden = $('#editLogoHidden');
    const editResetBtn = $('#editLogoResetUtmBtn');

    if (editFileInput) {
      editFileInput.addEventListener('change', () => {
        const file = editFileInput.files && editFileInput.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            if (editPreview) editPreview.src = e.target.result;
            if (editHidden) editHidden.value = e.target.result;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (editResetBtn) {
      editResetBtn.addEventListener('click', () => {
        if (editPreview) editPreview.src = 'assets/images/logo_utm_escudo.png';
        if (editHidden) editHidden.value = 'assets/images/logo_utm_escudo.png';
      });
    }
    return;
  }

  const histTabBtn = event.target.closest('[data-history-tab]');
  if (histTabBtn) {
    historyTab = histTabBtn.dataset.historyTab;
    renderDataRequests();
    return;
  }

  const histPagBtn = event.target.closest('[data-hist-pag]');
  if (histPagBtn) {
    historyPage =
      histPagBtn.dataset.histPag === 'prev' ? Math.max(1, historyPage - 1) : historyPage + 1;
    renderHistory();
    return;
  }

  if (event.target.id === 'stationsPrevPageBtn') {
    stationsAdminPage = Math.max(1, stationsAdminPage - 1);
    renderStations();
    return;
  }
  if (event.target.id === 'stationsNextPageBtn') {
    stationsAdminPage += 1;
    renderStations();
    return;
  }

  const modelOpt = event.target.closest('.model-option[data-model]');
  if (modelOpt) {
    selectedAiModel = modelOpt.dataset.model;
    document.querySelectorAll('.model-option').forEach((el) => {
      el.classList.toggle('selected', el.dataset.model === selectedAiModel);
    });
    reiniciarVistaPreviaBoletin();
    return;
  }

  const promptOpt = event.target.closest('.prompt-choice[data-prompt]');
  if (promptOpt) {
    selectedAiPrompt = promptOpt.dataset.prompt;
    document.querySelectorAll('.prompt-choice').forEach((el) => {
      el.classList.toggle('selected', el.dataset.prompt === selectedAiPrompt);
    });
    const customPrompt = $('#admCustomPrompt');
    if (customPrompt) {
      customPrompt.style.display = selectedAiPrompt === 'custom' ? 'block' : 'none';
    }
    updatePromptHint();
    reiniciarVistaPreviaBoletin();
    return;
  }

  const toggleSwitch = event.target.closest('.switch[data-toggle]');
  if (toggleSwitch) {
    const key = toggleSwitch.dataset.toggle;
    if (key in reportToggles) {
      reportToggles[key] = !reportToggles[key];
      toggleSwitch.classList.toggle('on', reportToggles[key]);
      reiniciarVistaPreviaBoletin();
    }
    return;
  }

  const genReqBtn = event.target.closest('[data-generate-request]');
  if (genReqBtn) {
    generateRequestedData(genReqBtn.dataset.generateRequest);
    return;
  }

  const toggleAlertBtn = event.target.closest('[data-toggle-alert]');
  if (toggleAlertBtn) {
    const alert = state.alerts.find((a) => a.id === toggleAlertBtn.dataset.toggleAlert);
    if (alert) {
      alert.active = !alert.active;
      saveState();
      renderAlerts();
      renderHeader();
      renderDashboard();
    }
    return;
  }

  const aplicarBtn = event.target.closest('[data-apply-alert]');
  if (aplicarBtn) {
    const fila = aplicarBtn.closest('[data-rule]');
    const regla = state.alerts.find((a) => a.id === aplicarBtn.dataset.applyAlert);
    if (!regla || !fila) return;

    const leer = (clave) => fila.querySelector(`[data-rule-field="${clave}"]`);
    const nombre = (leer('type')?.value || '').trim();
    const limite = Number(leer('value')?.value);

    if (!nombre) return showToast('La regla necesita un nombre');
    if (!Number.isFinite(limite)) return showToast('El l\u00edmite debe ser un n\u00famero');

    regla.type = nombre;
    regla.condition = leer('condition')?.value || regla.condition;
    regla.operator = leer('operator')?.value || regla.operator;
    regla.value = limite;

    saveState();
    renderAlerts();
    renderHeader();
    renderDashboard();
    showToast(`Regla \u00ab${nombre}\u00bb actualizada`);
    return;
  }

  const delAlertBtn = event.target.closest('[data-delete-alert]');
  if (delAlertBtn) {
    const regla = state.alerts.find((a) => a.id === delAlertBtn.dataset.deleteAlert);
    if (regla) {
      state.alerts = state.alerts.filter((a) => a.id !== regla.id);
      saveState();
      renderAlerts();
      renderHeader();
      renderDashboard();
      showToast(`Regla \u00ab${regla.type}\u00bb eliminada`);
    }
    return;
  }

  const delUserBtn = event.target.closest('[data-delete-user]');
  if (delUserBtn) {
    state.users = state.users.filter((u) => u.id !== delUserBtn.dataset.deleteUser);
    saveState();
    renderUsers();
    showToast('Usuario eliminado');
    return;
  }
});

$('#modalCloseBtn')?.addEventListener('click', () => $('#modal').close());

$('#toggleQuickSearchBtn')?.addEventListener('click', () => {
  const wrap = $('#quickSearchWrap');
  if (!wrap) return;
  const isHidden = wrap.hidden;
  wrap.hidden = !isHidden;
  if (!isHidden) {
    quickStationSearchQuery = '';
    const input = $('#quickStationSearchInput');
    if (input) input.value = '';
    quickStationPage = 1;
    renderMapControlsAndList();
  } else {
    setTimeout(() => $('#quickStationSearchInput')?.focus(), 50);
  }
});

$('#quickStationSearchInput')?.addEventListener('input', (e) => {
  quickStationSearchQuery = e.target.value || '';
  quickStationPage = 1;
  renderMapControlsAndList();
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'quickStationPrev') {
    quickStationPage = Math.max(1, quickStationPage - 1);
    renderMapControlsAndList();
    return;
  }
  if (e.target.id === 'quickStationNext') {
    quickStationPage += 1;
    renderMapControlsAndList();
    return;
  }
});

$('#centerStationBtn')?.addEventListener('click', () => {
  const st = currentStation();
  if (mainMap && st.latitude && st.longitude) {
    mainMap.flyTo([st.latitude, st.longitude], 13, { duration: 0.6 });
  }
});

$('#cAnimacionClima')?.addEventListener('change', (e) => {
  mapOptions.animacionClima = e.target.checked;
  renderMainWeatherMap();
});
$('#cEtiquetas')?.addEventListener('change', (e) => {
  mapOptions.etiquetas = e.target.checked;
  renderMainWeatherMap();
});
$('#cCodigoEstacion')?.addEventListener('change', (e) => {
  mapOptions.codigo = e.target.checked;
  renderMainWeatherMap();
});
$('#cTemperaturaMapa')?.addEventListener('change', (e) => {
  mapOptions.temperatura = e.target.checked;
  renderMainWeatherMap();
});
$('#cSensacionTermica')?.addEventListener('change', (e) => {
  mapOptions.sensacionTermica = e.target.checked;
  renderMainWeatherMap();
});
$('#cHumedadViento')?.addEventListener('change', (e) => {
  mapOptions.humedadViento = e.target.checked;
  renderMainWeatherMap();
});
$('#cLluviaMapa')?.addEventListener('change', (e) => {
  mapOptions.lluviaMapa = e.target.checked;
  renderMainWeatherMap();
});
$('#cAlertasMapa')?.addEventListener('change', (e) => {
  mapOptions.alertasMapa = e.target.checked;
  renderMainWeatherMap();
});
$('#mapBaseLayerSelect')?.addEventListener('change', (e) => {
  mapOptions.baseLayer = e.target.value || 'light';
  const mBase = $('#mobileMapBaseLayerSelect');
  if (mBase) mBase.value = mapOptions.baseLayer;
  renderMainWeatherMap();
});

/* Eventos de controles de mapa móvil */
$('#mobileMapStationStrip')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-station-id]');
  if (!btn) return;
  const stationId = btn.dataset.stationId;
  selectStationFromMap(stationId, true);
});

$('#btnMobileMapLayers')?.addEventListener('click', () => {
  const sheet = $('#mobileMapOptionsSheet');
  if (sheet) {
    const isHidden = sheet.hidden;
    sheet.hidden = !isHidden;
    $('#btnMobileMapLayers')?.classList.toggle('activo', isHidden);
  }
});

$('#btnMobileCloseMapOptions')?.addEventListener('click', () => {
  const sheet = $('#mobileMapOptionsSheet');
  if (sheet) {
    sheet.hidden = true;
    $('#btnMobileMapLayers')?.classList.remove('activo');
  }
});

$('#mobileMapBaseLayerSelect')?.addEventListener('change', (e) => {
  mapOptions.baseLayer = e.target.value || 'light';
  const dBase = $('#mapBaseLayerSelect');
  if (dBase) dBase.value = mapOptions.baseLayer;
  renderMainWeatherMap();
});
$('#mAnimacionClima')?.addEventListener('change', (e) => {
  mapOptions.animacionClima = e.target.checked;
  const dCheck = $('#cAnimacionClima');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mEtiquetas')?.addEventListener('change', (e) => {
  mapOptions.etiquetas = e.target.checked;
  const dCheck = $('#cEtiquetas');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mCodigoEstacion')?.addEventListener('change', (e) => {
  mapOptions.codigo = e.target.checked;
  const dCheck = $('#cCodigoEstacion');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mTemperaturaMapa')?.addEventListener('change', (e) => {
  mapOptions.temperatura = e.target.checked;
  const dCheck = $('#cTemperaturaMapa');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mSensacionTermica')?.addEventListener('change', (e) => {
  mapOptions.sensacionTermica = e.target.checked;
  const dCheck = $('#cSensacionTermica');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mHumedadViento')?.addEventListener('change', (e) => {
  mapOptions.humedadViento = e.target.checked;
  const dCheck = $('#cHumedadViento');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mLluviaMapa')?.addEventListener('change', (e) => {
  mapOptions.lluviaMapa = e.target.checked;
  const dCheck = $('#cLluviaMapa');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});
$('#mAlertasMapa')?.addEventListener('change', (e) => {
  mapOptions.alertasMapa = e.target.checked;
  const dCheck = $('#cAlertasMapa');
  if (dCheck) dCheck.checked = e.target.checked;
  renderMainWeatherMap();
});

$('#mCenterStationBtn')?.addEventListener('click', () => {
  const st = currentStation();
  if (mainMap && st.latitude && st.longitude) {
    mainMap.flyTo([st.latitude, st.longitude], 13, { duration: 0.6 });
  }
  const sheet = $('#mobileMapOptionsSheet');
  if (sheet) sheet.hidden = true;
  $('#btnMobileMapLayers')?.classList.remove('activo');
});

$('#mEncuadreBtn')?.addEventListener('click', () => {
  const bounds = state.stations.filter((s) => s.latitude && s.longitude).map((s) => [s.latitude, s.longitude]);
  if (bounds.length && mainMap) {
    mainMap.fitBounds(bounds, { padding: [50, 50] });
  }
  const sheet = $('#mobileMapOptionsSheet');
  if (sheet) sheet.hidden = true;
  $('#btnMobileMapLayers')?.classList.remove('activo');
});

$('#bEncuadre')?.addEventListener('click', () => {
  if (!mainMap) return;
  const pts = state.stations.filter((s) => s.latitude && s.longitude).map((s) => [s.latitude, s.longitude]);
  if (pts.length) mainMap.fitBounds(pts, { padding: [50, 50], maxZoom: 12 });
});

$('#bRecargarLectura')?.addEventListener('click', () => {
  syncRealStationsFromUtmApi(true);
});

$('#miUbicacionBtn')?.addEventListener('click', () => pedirUbicacion(true));

$('#accessButton')?.addEventListener('click', () => {
  const hayServidor = Boolean(CFG_ACCESO.endpoint);
  openModal(
    `<h2>Acceso administrador</h2>
     <p class="nota" style="margin-bottom:14px">Ingresa tus credenciales para gestionar estaciones, alertas, hist\u00f3rico y boletines.${
       hayServidor
         ? ''
         : ' <b>Modo demostraci\u00f3n:</b> la validaci\u00f3n ocurre en el navegador y no protege nada. Configura <code>acceso.endpoint</code> en config.js para producci\u00f3n.'
     }</p>
     <div class="campo"><label>Usuario</label><input class="entrada" name="username" required autocomplete="username" /></div>
     <div class="campo"><label>Clave</label><input class="entrada" name="password" type="password" required autocomplete="current-password" /></div>
     <div class="fila-botones"><button class="boton" type="submit">Ingresar</button></div>`,
    async (fd) => {
      const usuario = String(fd.get('username') || '').trim();
      const clave = String(fd.get('password') || '');

      if (hayServidor) {
        /* La validacion la hace el servidor, que es quien puede guardar un
           secreto. El navegador solo recibe el veredicto. */
        try {
          const res = await fetch(CFG_ACCESO.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, clave }),
          });
          const datos = await res.json().catch(() => ({}));
          if (!res.ok || !datos.ok) return showToast('Credenciales no v\u00e1lidas');
          if (datos.token) sessionStorage.setItem('utm-meteonet-token', datos.token);
          currentRole = datos.rol || 'admin';
        } catch {
          return showToast('No se pudo verificar el acceso con el servidor');
        }
      } else {
        if (usuario !== CFG_ACCESO.demoUsuario || clave !== CFG_ACCESO.demoClave) {
          return showToast('Credenciales no v\u00e1lidas');
        }
        currentRole = 'admin';
      }

      sessionStorage.setItem('utm-meteonet-role', currentRole);
      $('#modal').close();
      renderAll();
      showToast(hayServidor ? 'Sesi\u00f3n iniciada' : 'Modo administrador de demostraci\u00f3n habilitado');
    }
  );
});

$('#adminLogoutButton')?.addEventListener('click', (e) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  currentRole = 'public';
  sessionStorage.setItem('utm-meteonet-role', 'public');
  closeAdminMenu();
  showPage('inicio');
  renderAll();
  showToast('Sesión administrativa cerrada');
});

$('#closeDataRequestButton')?.addEventListener('click', () => showPage('inicio'));

/* Menú desplegable de Administración (solo visible con sesión de administrador) */
function closeAdminMenu() {
  const panel = $('#adminMenuPanel');
  if (panel) panel.hidden = true;
  $('#adminMenuBtn')?.setAttribute('aria-expanded', 'false');
}

let lastAdminToggleTime = 0;
function toggleAdminMenu(e) {
  const now = Date.now();
  if (now - lastAdminToggleTime < 280) return;
  lastAdminToggleTime = now;
  if (e) {
    e.stopPropagation();
  }
  const panel = $('#adminMenuPanel');
  const btn = $('#adminMenuBtn');
  if (!panel || !btn) return;
  const willShow = panel.hidden;
  panel.hidden = !willShow;
  btn.setAttribute('aria-expanded', String(willShow));
}

$('#adminMenuBtn')?.addEventListener('click', toggleAdminMenu);
$('#adminMenuBtn')?.addEventListener('touchend', toggleAdminMenu);

document.addEventListener('click', (event) => {
  if (!event.target.closest('#adminMenuWrap')) closeAdminMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAdminMenu();
});

document.addEventListener('click', (event) => {
  const stChip = event.target.closest('[data-req-station-chip]');
  if (stChip) {
    requestSelectedStationId = stChip.dataset.reqStationChip;
    renderDataRequestForm();
    return;
  }

  const varChip = event.target.closest('[data-var-chip]');
  if (varChip) {
    varChip.classList.toggle('activa');
    syncRequestVariablesSelect();
    return;
  }

  const presetBtn = event.target.closest('[data-date-preset]');
  if (presetBtn) {
    const days = Number(presetBtn.dataset.datePreset || 7);
    const now = new Date();
    if ($('#reqEndDate')) $('#reqEndDate').value = fechaLocalIso(now);
    if ($('#reqStartDate')) $('#reqStartDate').value = fechaLocalIso(new Date(now.getTime() - days * 86400000));
    marcarPresetFecha(presetBtn.dataset.datePreset);
    validateDataRequestForm();
    return;
  }
});

['input', 'change', 'keyup', 'click'].forEach((evtName) => {
  $('#dataRequestForm')?.addEventListener(evtName, () => {
    validateDataRequestForm();
    setTimeout(validateDataRequestForm, 20);
  });
});
$('#reqAgreement')?.addEventListener('change', validateDataRequestForm);

/* Si la persona toca las fechas, el periodo predefinido deja de aplicar */
['#reqStartDate', '#reqEndDate'].forEach((sel) => {
  $(sel)?.addEventListener('input', () => marcarPresetFecha(null));
});

$('#toggleAllVarsBtn')?.addEventListener('click', () => {
  const chips = $all('#requestVariableChips .sm-var-chip');
  const allActive = chips.every((c) => c.classList.contains('activa'));
  chips.forEach((c) => c.classList.toggle('activa', !allActive));
  syncRequestVariablesSelect();
});

$('#dataRequestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const startDate = fd.get('startDate');
  const endDate = fd.get('endDate');
  if (new Date(endDate) < new Date(startDate)) {
    return showToast('La fecha de término debe ser posterior a la de inicio');
  }
  const activeVars = $all('#requestVariableChips .sm-var-chip.activa').map((b) => b.dataset.varChip);
  if (!activeVars.length) {
    return showToast('Seleccione al menos una variable meteorológica');
  }
  const variables = activeVars;
  const reqObj = {
    id: `req-${Date.now()}`,
    document: (fd.get('document') || '').trim(),
    fullName: (fd.get('fullName') || '').trim(),
    institution: (fd.get('institution') || '').trim(),
    email: (fd.get('email') || '').trim(),
    stationId: requestSelectedStationId || fd.get('station') || 'all',
    variables,
    startDate,
    endDate,
    purpose: (fd.get('purpose') || '').trim(),
    createdAt: new Date().toISOString(),
    status: 'Recibida',
  };
  const formulario = e.currentTarget;
  const enviada = await enviarSolicitudAlServidor(reqObj);
  reqObj.status = enviada ? 'Enviada' : 'Solo local';

  state.dataRequests = state.dataRequests || [];
  state.dataRequests.unshift(reqObj);
  saveState();
  formulario.reset();
  requestSelectedStationId = 'all';
  /* Las variables vuelven a quedar sin marcar, como al entrar */
  $all('#requestVariableChips .sm-var-chip').forEach((c) => c.classList.remove('activa'));
  marcarPresetFecha(null);
  renderDataRequestForm();
  const destino = CFG_SOLICITUDES.correoDestino;
  showToast(
    enviada
      ? `Solicitud enviada a ${destino}. Recibir\u00e1 respuesta en el correo indicado.`
      : 'Solicitud registrada solo en este navegador: a\u00fan no hay servicio de env\u00edo configurado.'
  );
});

$('#historyFilters')?.addEventListener('submit', (e) => {
  e.preventDefault();
  historyPage = 1;
  renderHistory();
  showToast('Filtro aplicado');
});

$('#exportCsvButton')?.addEventListener('click', () => {
  const st = currentStation();
  const headers = 'estacion,fecha_iso,temperatura_c,precipitacion_mm,humedad_pct,viento_ms,radiacion_wm2,presion_hpa';
  const csv = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '' : Number(v).toFixed(d));
  const rows = historicalRows(st).map(
    (r) => `"${st.name}",${r.timestamp.toISOString()},${csv(r.temperature)},${csv(r.precipitation)},${csv(r.humidity, 0)},${csv(r.windSpeed)},${csv(r.radiation, 0)},${csv(r.pressure)}`
  );
  download(`historico-${st.code || st.id}.csv`, [headers, ...rows].join('\n'), 'text/csv;charset=utf-8');
});

$('#generateButton')?.addEventListener('click', () => {
  generarReporteIA();
});

function exportarReportePdf() {
  const docElem = $('#reportDocument');
  if (!docElem || !docElem.innerHTML.trim()) {
    showToast('Genera primero el bolet\u00edn');
    return;
  }

  /* El boletin vive dentro de contenedores marcados .no-imprimir, asi que
     imprimir la pagina tal cual producia un PDF en blanco. Se imprime una
     copia colgada directamente de <body>, que el CSS de impresion deja como
     unico contenido visible. Funciona igual en escritorio y en movil, sin
     iframes ni ventanas emergentes que el navegador pueda bloquear, y con
     las imagenes ya cargadas. */
  const previo = document.getElementById('printRoot');
  if (previo) previo.remove();

  const contenedor = document.createElement('div');
  contenedor.id = 'printRoot';
  const copia = document.createElement('article');
  copia.className = 'report-document';
  copia.innerHTML = docElem.innerHTML;
  contenedor.appendChild(copia);
  document.body.appendChild(contenedor);
  document.body.classList.add('imprimiendo-boletin');

  const limpiar = () => {
    document.body.classList.remove('imprimiendo-boletin');
    const actual = document.getElementById('printRoot');
    if (actual) actual.remove();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);

  setTimeout(() => {
    try {
      window.print();
    } finally {
      setTimeout(limpiar, 1200);
    }
  }, 60);
}

/* ---------- Imagenes embebidas en el HTML descargado ----------
   El boletin referencia los logos con rutas relativas. Al guardar el
   archivo fuera de la carpeta del proyecto esas rutas no existen y las
   imagenes salen rotas, asi que se convierten a data URI. Si la
   conversion falla (por ejemplo al abrir el sitio con file://, donde
   fetch esta bloqueado) se deja la ruta absoluta, que sigue resolviendo. */
const cacheImagenesEmbebidas = new Map();

async function imagenADataUri(url) {
  if (cacheImagenesEmbebidas.has(url)) return cacheImagenesEmbebidas.get(url);
  let resultado = null;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const blob = await respuesta.blob();
    resultado = await new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = reject;
      lector.readAsDataURL(blob);
    });
  } catch (err) {
    resultado = null;
  }
  cacheImagenesEmbebidas.set(url, resultado);
  return resultado;
}

async function embeberImagenes(html) {
  const fuentes = Array.from(new Set((html.match(/src="[^"]+"/g) || []).map((s) => s.slice(5, -1)))).filter(
    (u) => u && !u.startsWith('data:')
  );
  for (const src of fuentes) {
    let absoluta = src;
    try {
      absoluta = new URL(src, document.baseURI).href;
    } catch (err) {
      /* ruta no resoluble: se deja tal cual */
    }
    const dataUri = await imagenADataUri(absoluta);
    html = html.split(`src="${src}"`).join(`src="${dataUri || absoluta}"`);
  }
  return html;
}

async function descargarReporteHtml() {
  const rangeVal = $('#reportRange') ? $('#reportRange').value : 'ahora';
  const stationRaw = getSelectedReportStation();
  const s = normalizeStationForReport(stationRaw, rangeVal);
  const code = s ? (s.codigo || s.id || 'estacion').toLowerCase().replace(/[^a-z0-9_-]/g, '_') : 'estacion';
  const filename = `boletin-meteonet-${code}-${rangeVal}.html`;
  let htmlContent = crearHtmlDescarga();
  try {
    htmlContent = await embeberImagenes(htmlContent);
  } catch (err) {
    /* se descarga igual con las rutas originales */
  }
  download(filename, htmlContent, 'text/html;charset=utf-8');
  showToast('Boletín descargado en formato HTML');
}

function descargarReporteTxt() {
  const rangeVal = $('#reportRange') ? $('#reportRange').value : 'ahora';
  const stationRaw = getSelectedReportStation();
  const s = normalizeStationForReport(stationRaw, rangeVal);
  const code = s ? (s.codigo || s.id || 'estacion').toLowerCase().replace(/[^a-z0-9_-]/g, '_') : 'estacion';
  const filename = `boletin-meteonet-${code}-${rangeVal}.txt`;
  const txtContent = construirTextoDescarga();
  download(filename, txtContent, 'text/plain;charset=utf-8');
  showToast('Boletín descargado en formato TXT');
}

/* Copiar, HTML y TXT se atienden en el handler delegado de clics
   (ver 'Eventos'). Enlazarlos tambien aqui disparaba cada accion dos
   veces: dos descargas por clic y dos dialogos de impresion. */

$('#admCustomPrompt')?.addEventListener('input', () => {
  updatePromptHint();
  if (selectedAiPrompt === 'custom') {
    reiniciarVistaPreviaBoletin();
  }
});

$('#reportStation')?.addEventListener('change', () => {
  reiniciarVistaPreviaBoletin();
});

$('#reportRange')?.addEventListener('change', () => {
  reiniciarVistaPreviaBoletin();
});

$('#addStationButton')?.addEventListener('click', () => {
  openModal(
    `<h2>Agregar nueva estación</h2>
     <div class="campo">
       <label>Código de estación</label>
       <input class="entrada" name="code" placeholder="Ej. UTM-04" required />
     </div>
     <div class="campo">
       <label>Ubicación / Cantón</label>
       <input class="entrada" name="location" placeholder="Ej. Chone" required />
     </div>
     <div class="campo">
       <label>Institución o entidad propietaria</label>
       <input class="entrada" name="owner" id="newStationOwner" placeholder="Ej. UTM, INAMHI, GAD Portoviejo" value="UTM" required />
     </div>
     <div class="campo">
       <label>Logo de la entidad propietaria</label>
       <div style="display:flex;align-items:center;gap:12px;background:var(--superficie2);border:1px solid var(--borde);border-radius:10px;padding:10px 12px;">
         <div style="width:48px;height:48px;border-radius:8px;background:#fff;border:1px solid var(--borde);display:grid;place-items:center;padding:4px;flex-shrink:0;">
           <img id="stLogoPreview" src="assets/images/logo_utm_escudo.png" alt="Logo de la entidad" style="max-width:100%;max-height:100%;object-fit:contain;" />
         </div>
         <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
           <div style="display:flex;gap:8px;flex-wrap:wrap;">
             <label class="btn-estilo-reporte" style="cursor:pointer;margin:0;font-size:11.5px;padding:5px 10px;height:auto;">
               Subir imagen
               <input type="file" id="stLogoFileInput" accept="image/*" style="display:none;" />
             </label>
             <button type="button" class="btn-estilo-reporte" id="stLogoResetUtmBtn" style="font-size:11.5px;padding:5px 10px;height:auto;">
               Escudo UTM
             </button>
           </div>
           <input type="hidden" name="ownerLogo" id="stLogoHidden" value="assets/images/logo_utm_escudo.png" />
           <small style="font-size:10.5px;color:var(--texto3);">Sube el logo de la entidad dueña (PNG, JPG o SVG) o mantén el escudo oficial de la UTM.</small>
         </div>
       </div>
     </div>
     <div class="exp-form">
       <label>Latitud<input class="entrada" name="latitude" type="number" step="0.000001" placeholder="-0.6982" required /></label>
       <label>Longitud<input class="entrada" name="longitude" type="number" step="0.000001" placeholder="-80.0934" required /></label>
     </div>
     <div class="exp-form" style="margin-top:8px">
       <label>Temperatura inicial (°C)<input class="entrada" name="temperature" type="number" step="0.1" value="25.0" /></label>
       <label>Precipitación (mm)<input class="entrada" name="precipitation" type="number" step="0.1" value="0.0" /></label>
     </div>
     <div class="exp-form" style="margin-top:8px">
       <label>Humedad (%)<input class="entrada" name="humidity" type="number" value="75" /></label>
       <label>Viento (m/s)<input class="entrada" name="windSpeed" type="number" step="0.1" value="2.0" /></label>
     </div>
     <div class="fila-botones" style="margin-top:14px">
       <button class="boton" type="submit">Guardar estación</button>
     </div>`,
    (fd) => {
      const code = (fd.get('code') || '').trim();
      const location = (fd.get('location') || '').trim();
      const owner = (fd.get('owner') || '').trim() || 'UTM';
      const ownerLogo = (fd.get('ownerLogo') || '').trim() || 'assets/images/logo_utm_escudo.png';
      const lat = Number(fd.get('latitude')) || -1.05;
      const lng = Number(fd.get('longitude')) || -80.45;
      const temp = Number(fd.get('temperature')) || 25.0;
      const prec = Number(fd.get('precipitation')) || 0.0;
      const hum = Number(fd.get('humidity')) || 75;
      const wind = Number(fd.get('windSpeed')) || 2.0;

      const newStation = {
        id: `st-${Date.now()}`,
        name: `${location} · ${code}`,
        code: code,
        location: location,
        status: 'Activa',
        latitude: lat,
        longitude: lng,
        temperature: temp,
        precipitation: prec,
        humidity: hum,
        windSpeed: wind,
        pressure: 1009.1,
        radiation: 250,
        uvIndex: 4,
        updatedAt: new Date().toISOString(),
        owner: owner,
        ownerLogo: ownerLogo
      };

      state.stations.push(newStation);
      saveState();
      $('#modal').close();
      renderAll();
      showToast(`Estación ${location} (${owner}) agregada con éxito`);
    }
  );

  const fileInput = $('#stLogoFileInput');
  const logoPreview = $('#stLogoPreview');
  const logoHidden = $('#stLogoHidden');
  const resetUtmBtn = $('#stLogoResetUtmBtn');
  const ownerInput = $('#newStationOwner');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (logoPreview) logoPreview.src = e.target.result;
          if (logoHidden) logoHidden.value = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (resetUtmBtn) {
    resetUtmBtn.addEventListener('click', () => {
      if (logoPreview) logoPreview.src = 'assets/images/logo_utm_escudo.png';
      if (logoHidden) logoHidden.value = 'assets/images/logo_utm_escudo.png';
      if (ownerInput && !ownerInput.value.trim()) ownerInput.value = 'UTM';
    });
  }
});

/* #printReportButton se atiende en el handler delegado de clics. */

$('#newAlertButton')?.addEventListener('click', () => {
  const variables = VARIABLES_ALERTA.map(
    (v) => `<option value="${v}">${escapeHtml((VARIABLE_LABELS[v] || v).replace(/\s*\(.*\)$/, ''))}</option>`
  ).join('');
  const operadores = Object.entries(OPERADORES)
    .map(([k, o]) => `<option value="${k}">${escapeHtml(o.etiqueta)}</option>`)
    .join('');

  openModal(
    `<h2>Nueva regla de alerta</h2>
     <div class="campo"><label>Nombre</label><input class="entrada" name="type" required placeholder="Ej. Humedad alta" /></div>
     <div class="campo"><label>Variable</label><select class="selector" name="condition">${variables}</select></div>
     <div class="campo"><label>Comparador</label><select class="selector" name="operator">${operadores}</select></div>
     <div class="campo"><label>L\u00edmite</label><input class="entrada" name="value" type="number" step="0.1" required value="30" /></div>
     <div class="fila-botones"><button class="boton" type="submit">Crear regla</button></div>`,
    (fd) => {
      const valor = Number(fd.get('value'));
      if (!Number.isFinite(valor)) return showToast('El l\u00edmite debe ser un n\u00famero');
      state.alerts.push({
        id: `al-${Date.now()}`,
        type: fd.get('type').trim(),
        condition: fd.get('condition'),
        operator: fd.get('operator') || '>',
        value: valor,
        active: true,
      });
      saveState();
      $('#modal').close();
      renderAlerts();
      renderHeader();
      renderDashboard();
      showToast('Regla creada');
    }
  );
});

$('#newUserButton')?.addEventListener('click', () => {
  openModal(
    `<h2>Nuevo usuario</h2>
     <div class="campo"><label>Nombre</label><input class="entrada" name="name" required /></div>
     <div class="campo"><label>Correo institucional</label><input class="entrada" name="email" type="email" required /></div>
     <div class="campo"><label>Rol</label><select class="selector" name="role"><option>Analista</option><option>Administrador</option></select></div>
     <div class="fila-botones"><button class="boton" type="submit">Crear usuario</button></div>`,
    (fd) => {
      state.users.push({
        id: `usr-${Date.now()}`,
        name: fd.get('name').trim(),
        email: fd.get('email').trim(),
        role: fd.get('role'),
        status: 'Activo',
      });
      saveState();
      $('#modal').close();
      renderUsers();
      showToast('Usuario creado');
    }
  );
});

$('#settingsForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const intervalo = Number(fd.get('intervaloMinutos'));
  state.settings = {
    adminName: fd.get('adminName').trim(),
    adminEmail: fd.get('adminEmail').trim(),
    apiUrl: fd.get('apiUrl').trim(),
    aiModel: fd.get('aiModel') || 'gemma-3',
    intervaloMinutos: Number.isFinite(intervalo) ? intervalo : null,
    usarUbicacion: fd.get('usarUbicacion') === 'on',
  };
  saveState();
  aplicarIntervaloDeMuestreo();
  renderAll();
  showToast(
    state.settings.intervaloMinutos > 0
      ? `Configuraci\u00f3n guardada. Lectura cada ${state.settings.intervaloMinutos} min.`
      : 'Configuraci\u00f3n guardada. La lectura autom\u00e1tica queda desactivada.'
  );
});

$('#resetDemoDataButton')?.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, clone(defaults));
  saveState();
  renderAll();
  syncRealStationsFromUtmApi(true);
});

const initialHash = window.location.hash.slice(1);
if ($all('[data-view]').some((v) => v.id === initialHash)) {
  currentViewId = initialHash;
}
sembrarDatosDeEnsayo();
renderAll();
actualizarAvisoDeOrigen();
cargarArchivoMuestreo();
syncRealStationsFromUtmApi(false);

aplicarIntervaloDeMuestreo();
ubicarAlCargar();
