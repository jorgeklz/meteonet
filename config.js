/* =============================================================================
   UTM MeteoNet · Configuración de integración
   -----------------------------------------------------------------------------
   Este es el único archivo que hay que tocar para conectar el observatorio con
   los servicios reales. Se carga antes que `app.js` desde `index.html`.

   Todo lo que está aquí se puede dejar vacío: la aplicación arranca igual y
   usa las lecturas de ejemplo que trae `app.js`, avisando en la interfaz de
   que no hay conexión.

   Importante sobre seguridad
   --------------------------
   Este archivo lo descarga el navegador, así que cualquiera puede leerlo.
   NO pongas aquí un token de producción ni una contraseña. Lo correcto es
   dejar `token` vacío y apuntar `baseUrl` a un proxy propio que guarde la
   credencial del lado del servidor y reenvíe la petición. Hay un ejemplo
   mínimo de ese proxy en el README.
   ============================================================================= */

window.METEONET_CONFIG = {
  /* ---------------------------------------------------------------------------
     1. Estaciones y mediciones en tiempo real
     ---------------------------------------------------------------------------
     De dónde salen las estaciones de la red y su última lectura.
  --------------------------------------------------------------------------- */
  estaciones: {
    /* Raíz del servicio. Debe terminar en barra.
       Ejemplo con proxy propio: 'https://meteonet.utm.edu.ec/api/'            */
    baseUrl: 'https://app.utm.edu.ec:3000/',

    /* Rutas relativas a baseUrl.
       - listado: devuelve el catálogo de estaciones
       - detalle: recibe ?stationId=<id> y devuelve la última lectura          */
    rutaListado: 'get_stations',
    rutaDetalle: 'get_station_info',

    /* Cabeceras de autenticación. Déjalo en {} si usas un proxy que ya
       autentica por su cuenta. Si tu servicio espera 'Authorization', cambia
       el nombre de la clave aquí.                                             */
    cabeceras: {
      // 'access-token': 'PON_AQUI_TU_TOKEN_SOLO_EN_DESARROLLO',
    },

    /* Cada cuántos minutos se vuelve a consultar. 0 desactiva el refresco
       automático y deja solo el botón «Actualizar lecturas».                  */
    refrescoMinutos: 10,

    /* Unidades en las que el servicio entrega cada variable. La aplicación
       convierte al Sistema Internacional antes de guardar nada, así que lo
       que se muestra y lo que se exporta siempre está en las unidades de la
       columna «destino».

         temperatura: 'F' | 'C'            destino: °C
         presion:     'inHg' | 'hPa'       destino: hPa
         viento:      'mph' | 'kmh' | 'ms' destino: m/s
         lluvia:      'in' | 'mm'          destino: mm                         */
    unidades: {
      temperatura: 'F',
      presion: 'inHg',
      viento: 'ms',
      lluvia: 'mm',
    },

    /* Correspondencia entre los campos del servicio y los de la aplicación.
       Si tu servicio devuelve otros nombres, cámbialos aquí y no hace falta
       tocar `app.js`. Un valor null significa «este servicio no lo entrega»,
       y la interfaz mostrará «Sin dato» en lugar de inventar una cifra.

       Los campos de `detalle` se buscan primero en `meteorological[0]`,
       después en `barometer[0]` y por último en la raíz del registro.         */
    campos: {
      // --- del listado de estaciones ---
      id: 'stationId',
      codigo: 'name',
      ubicacion: 'location',
      latitud: 'latitude',
      longitud: 'longitude',
      driver: 'driver',

      // --- de la última lectura ---
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
  },

  /* ---------------------------------------------------------------------------
     2. Histórico de mediciones
     ---------------------------------------------------------------------------
     Sin esto, la pestaña «Histórico» solo muestra lo que el propio navegador
     haya ido guardando desde que se abrió el sitio, y así lo advierte.

     El servicio debe aceptar:
         GET <baseUrl><ruta>?stationId=<id>&desde=<ISO>&hasta=<ISO>
     y responder:
         { "data": [ { "iso_date": "...", "temp": 24.1, "hum": 88, ... } ] }

     Los nombres de campo son los mismos de `estaciones.campos`.
  --------------------------------------------------------------------------- */
  historico: {
    /* Déjalo vacío mientras no exista el endpoint. */
    baseUrl: '',
    ruta: 'get_station_history',
    cabeceras: {},

    /* Respaldo local: la aplicación guarda cada lectura que recibe en el
       navegador, para que el histórico no quede vacío mientras no haya
       servicio. Es un apaño de transición, no un sustituto de la base de
       datos: solo existe en el equipo de quien visita el sitio.               */
    guardarEnNavegador: true,
    maximoRegistrosPorEstacion: 2000,

    /* Archivo de muestras en el propio sitio. Util mientras no hay servidor:
       un proceso externo va anadiendo lecturas a ese JSON y la aplicacion las
       carga al arrancar y las fusiona con lo que ya tenga el navegador.
       Formato: { "<stationId>": [ { t, temp, hum, prec, vel, dir, rad, uv, pres } ] }
       Dejar vacio para no consultarlo. */
    archivoMuestreo: 'muestreo.json',

    /* Ensayo. Con true, la aplicacion siembra 48 horas de lecturas
       SIMULADAS para todas las estaciones y variables, de modo que se pueda
       ver el patron y el historico funcionando antes de que exista el
       servicio. Los datos no son medidos y la interfaz lo advierte en cada
       sitio donde aparecen. Poner en false para produccion. */
    datosDeEnsayo: true,
  },

  /* ---------------------------------------------------------------------------
     3. Solicitudes de datos
     ---------------------------------------------------------------------------
     Qué hacer cuando alguien envía el formulario «Solicitar datos».
     Sin endpoint, la solicitud solo queda guardada en el navegador de quien
     la envió, así que nadie la recibe. La interfaz lo advierte.

     El servicio recibe un POST con JSON:
         { document, fullName, institution, email, stationId,
           variables: [], startDate, endDate, purpose, createdAt }
  --------------------------------------------------------------------------- */
  solicitudes: {
    endpoint: '',
    cabeceras: { 'Content-Type': 'application/json' },

    /* Correo del observatorio al que llegan las solicitudes. El servidor lo
       recibe en cada peticion y lo usa como destinatario del aviso. */
    correoDestino: 'meteonet@utm.edu.ec',
  },

  /* ---------------------------------------------------------------------------
     4. Modelo de lenguaje para el boletín
     ---------------------------------------------------------------------------
     Sin endpoint, el botón «Generar boletín» arma el documento con una
     plantilla local y lo rotula como tal. Con endpoint, envía:

         POST <endpoint>
         { "model": "gemma3", "prompt": "...", "weatherData": { ... } }

     y espera:

         { "report": "Texto del boletín" }
  --------------------------------------------------------------------------- */
  boletin: {
    endpoint: '',
    cabeceras: { 'Content-Type': 'application/json' },
    tiempoLimiteMs: 60000,
  },

  /* ---------------------------------------------------------------------------
     5. Acceso de administración
     ---------------------------------------------------------------------------
     Mientras `endpoint` esté vacío, el acceso se valida en el navegador con
     el usuario de demostración y NO protege nada: cualquiera puede activarlo
     desde la consola. Sirve para enseñar la interfaz, no para producción.

     Con endpoint, la aplicación envía:
         POST <endpoint>  { "usuario": "...", "clave": "..." }
     y espera:
         { "ok": true, "rol": "admin", "token": "..." }
  --------------------------------------------------------------------------- */
  acceso: {
    endpoint: '',

    /* Solo se usan cuando `endpoint` está vacío. */
    demoUsuario: 'admin',
    demoClave: 'utm2026',
  },

  /* ---------------------------------------------------------------------------
     6. Contador de visitas
     ---------------------------------------------------------------------------
     Contador independiente y exclusivo para UTM MeteoNet.
     - url y clave: proyecto propio en Supabase para MeteoNet.
       Para que funcione, ejecuta en el SQL Editor de Supabase el archivo
       'supabase/visitas.sql'.
     - Si la clave está vacía, MeteoNet utiliza automáticamente su propio
       almacenamiento local aislado para contabilizar visitas sin depender de
       servicios externos ni mezclar datos con otros sitios.
  --------------------------------------------------------------------------- */
  visitas: {
    url: 'https://zxwnahximblzfskqppkg.supabase.co',
    clave: 'sb_publishable_wcUsOrBfOKnEkSLglYjUXw_vE4uP-Aj',
    almacenamientoClave: 'utm-meteonet-visitas-v1',
  },
};

window.SITE_CONFIG = Object.assign(window.SITE_CONFIG || {}, {
  visitas: window.METEONET_CONFIG.visitas,
});
