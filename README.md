# UTM MeteoNet · observatorio meteorológico

Aplicación web del observatorio de la Universidad Técnica de Manabí. Muestra la
red de estaciones en un mapa, sus lecturas actuales y su histórico, gestiona
umbrales de alerta y genera boletines.

Parte del proyecto de investigación **ObservaIA: Observatorios de Datos
Multitemáticos con Analítica Avanzada e Inteligencia Artificial**.

---

## Puesta en marcha

```bash
npm start          # sirve el sitio en http://localhost:8080
```

También se puede abrir `index.html` directamente, pero con `file://` el
navegador bloquea las peticiones a la API y las imágenes del boletín descargado
no quedan embebidas. Para desarrollo real, usa el servidor.

No hay dependencias ni proceso de compilación. Leaflet viene incluido en
`vendor/`.

---

## Estructura

```
index.html        marcado de las ocho vistas
config.js         único archivo a editar para conectar servicios
app.js            lógica de la aplicación
estilos.css       estilos
assets/           logos e iconos
vendor/           Leaflet
muestreo.js       muestreo ligero sin servidor, escribe muestreo.json
muestreo.json     lecturas acumuladas que la aplicación lee al arrancar
servidor/         servidor de referencia (proxy, histórico, solicitudes, acceso)
```

---

## Guía de integración

Todo lo conectable está en **`config.js`**, con comentarios en cada bloque. La
aplicación arranca aunque esté todo vacío: usa lecturas de ejemplo y avisa en
pantalla de que no hay conexión.

### 1. Estaciones y mediciones actuales

```js
estaciones: {
  baseUrl: 'https://meteonet.utm.edu.ec/api/',
  rutaListado: 'get_stations',
  rutaDetalle: 'get_station_info',
  cabeceras: {},
  refrescoMinutos: 10,
  unidades: { temperatura: 'F', presion: 'inHg', viento: 'ms', lluvia: 'mm' },
  campos: { /* ver más abajo */ },
}
```

La aplicación hace dos llamadas:

| Llamada | Petición | Respuesta esperada |
|---|---|---|
| Listado | `GET <baseUrl><rutaListado>` | `{ "data": [ { stationId, name, location, latitude, longitude, driver } ] }` |
| Detalle | `GET <baseUrl><rutaDetalle>?stationId=<id>` | `{ "data": [ { iso_date, meteorological: [ {...} ], barometer: [ {...} ] } ] }` |

**Si tu servicio usa otros nombres de campo**, no toques `app.js`: cámbialos en
`estaciones.campos`. Cada clave de la izquierda es el concepto que usa la
aplicación y el valor de la derecha es el nombre en tu respuesta.

```js
campos: {
  temperatura: 'temp',          // → °C
  humedad: 'hum',               // → %
  presion: 'bar_sea_level',     // → hPa
  vientoVelocidad: 'wind_speed_last',
  vientoDireccion: 'wind_dir_last',
  // ...
}
```

Los campos del detalle se buscan en este orden: `meteorological[0]`,
`barometer[0]` y la raíz del registro.

**Unidades.** La aplicación guarda siempre en Sistema Internacional (°C, hPa,
m/s, mm) y convierte una sola vez, al recibir el dato. Declara en
`estaciones.unidades` en qué unidad llega cada magnitud y la conversión es
automática. Conversores disponibles:

| Magnitud | Entradas aceptadas | Se guarda como |
|---|---|---|
| `temperatura` | `F`, `C` | °C |
| `presion` | `inHg`, `hPa` | hPa |
| `viento` | `mph`, `kmh`, `ms` | m/s |
| `lluvia` | `in`, `mm` | mm |

**Campos ausentes.** Si tu servicio no entrega una variable, pon `null` en su
entrada de `campos`. La aplicación mostrará «Sin dato». Nunca sustituye una
medición ausente por una cifra plausible, ni en la interfaz ni en el boletín.

### 2. Histórico

```js
historico: {
  baseUrl: 'https://meteonet.utm.edu.ec/api/',
  ruta: 'get_station_history',
  guardarEnNavegador: true,
  maximoRegistrosPorEstacion: 2000,
}
```

```
GET <baseUrl><ruta>?stationId=<id>&desde=<ISO>&hasta=<ISO>

{ "data": [ { "iso_date": "2026-11-06T18:00:00Z", "temp": 24.1, "hum": 88, ... } ] }
```

Los nombres de campo son los mismos de `estaciones.campos`.

Mientras no exista ese endpoint, la aplicación guarda en el navegador cada
lectura que recibe, para que la pestaña Histórico tenga algo real que mostrar.
**Es un apaño de transición**: solo vive en el equipo de quien visita el sitio,
no se comparte entre usuarios y se pierde al limpiar el almacenamiento. El
histórico de verdad necesita una base de datos en el servidor. La interfaz lo
advierte mientras tanto.

### 3. Solicitudes de datos

```js
solicitudes: { endpoint: 'https://meteonet.utm.edu.ec/api/solicitudes' }
```

```
POST <endpoint>
{ document, fullName, institution, email, stationId,
  variables: ["temperature", "humidity"], startDate, endDate, purpose, createdAt }
```

El servidor de referencia guarda la solicitud y avisa por correo a
**meteonet@utm.edu.ec**, con el correo de quien solicita como `Reply-To`. El
destinatario se cambia en `solicitudes.correoDestino`.

Sin endpoint, la solicitud solo queda en el navegador de quien la envió y nadie
la recibe. La aplicación lo dice explícitamente en el mensaje de confirmación y
marca la solicitud como «Solo local».

### 4. Modelo de lenguaje para el boletín

```js
boletin: { endpoint: 'http://localhost:8000/api/reports/weather' }
```

```
POST <endpoint>
{ "model": "gemma3", "prompt": "...", "weatherData": { "temperature": 25.4, ... } }

{ "report": "Texto del boletín generado por el modelo" }
```

Sin endpoint, el botón «Generar boletín» arma el documento con una plantilla
local.

### 5. Acceso de administración

```js
acceso: { endpoint: 'https://meteonet.utm.edu.ec/api/login' }
```

```
POST <endpoint>   { "usuario": "...", "clave": "..." }
{ "ok": true, "rol": "admin", "token": "..." }
```

**Sin endpoint, el acceso no protege nada.** La validación ocurre en el
navegador con el usuario de demostración y cualquiera puede activarlo desde la
consola. Sirve para enseñar la interfaz, no para producción.

---

## Seguridad: por qué hace falta un servidor

`config.js` lo descarga el navegador, así que **cualquiera puede leer lo que
pongas ahí**. No sirve para guardar un token, ni para validar un acceso.

En la carpeta `servidor/` hay una implementación de referencia que resuelve
esto y además guarda las lecturas en una base de datos, que es lo que hace que
el histórico sea real. Cubre las cuatro piezas:

| Ruta | Para qué |
|---|---|
| `/api/get_stations`, `/api/get_station_info` | Proxy que añade el token del lado del servidor |
| `/api/get_station_history` | Histórico desde SQLite |
| `/api/solicitudes` | Registra las solicitudes de datos |
| `/api/login` | Valida credenciales contra un hash bcrypt |

Arranque:

```bash
cd servidor
npm install
cp env.ejemplo.txt .env     # rellenar METEONET_TOKEN y ADMIN_HASH
npm start
```

Y en `config.js` del sitio:

```js
estaciones:  { baseUrl: 'http://localhost:3001/api/', cabeceras: {} },
historico:   { baseUrl: 'http://localhost:3001/api/' },
solicitudes: { endpoint: 'http://localhost:3001/api/solicitudes' },
acceso:      { endpoint: 'http://localhost:3001/api/login' },
```

El token queda en una variable de entorno y nunca llega al navegador.

**Lo que llena el histórico es el muestreo periódico** del servidor, que cada
diez minutos consulta todas las estaciones y guarda una fila por cada una. Sin
ese proceso corriendo, el endpoint existe pero la tabla está vacía. El detalle
y lo que falta para producción están en `servidor/README.md`.

## Qué se guarda en el navegador

| Clave de `localStorage` | Contenido |
|---|---|
| `utm-meteonet-state-v4` | estaciones, alertas, usuarios, solicitudes y preferencias |
| `utm-meteonet-historico-v1` | respaldo local de lecturas, mientras no haya servicio |

En `sessionStorage` se guarda el rol de la sesión y, si el acceso va por
servidor, su token.

Para reiniciar, borra el almacenamiento del sitio desde las herramientas del
navegador, o usa «Restaurar datos por defecto» en Configuración.

---

## Exportación

- **Boletín en PDF**: imprime una copia del documento aislada del resto de la página.
- **Boletín en HTML**: archivo autónomo, con las imágenes embebidas como data URI
  cuando el sitio se sirve por HTTP.
- **Histórico en CSV**: columnas en Sistema Internacional. Las mediciones
  ausentes salen como celda vacía, no como cero.

---

## Identidad visual

Verde UTM, verde lima y amarillo institucionales. Tipografía Montserrat en toda
la aplicación. Sin mayúsculas sostenidas: los títulos y encabezados van en tipo
oración.
