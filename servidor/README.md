# Servidor de referencia

Implementación mínima de los cuatro servicios que `config.js` del sitio espera.
Resuelve lo que no se puede resolver desde el navegador: sacar el token del
código público y guardar las lecturas para que el histórico sea real.

Está pensado para leerse y adaptarse. No lo despliegues sin revisarlo.

## Puesta en marcha

```bash
cd servidor
npm install
cp env.ejemplo.txt .env
```

Rellena `.env`:

```
METEONET_TOKEN=<el token de app.utm.edu.ec>
ADMIN_USUARIO=admin
ADMIN_HASH=<hash bcrypt de la clave>
```

El hash se genera con:

```bash
node -e "console.log(require('bcryptjs').hashSync('tuClave',10))"
```

Y arranca:

```bash
npm start
```

## Qué expone

| Ruta | Método | Para qué |
|---|---|---|
| `/api/get_stations` | GET | Proxy del listado, añade el token |
| `/api/get_station_info?stationId=` | GET | Proxy de la lectura actual |
| `/api/get_station_history?stationId=&desde=&hasta=` | GET | Histórico desde la base de datos |
| `/api/solicitudes` | POST | Registra la solicitud y avisa por correo a meteonet@utm.edu.ec |
| `/api/login` | POST | Valida credenciales y devuelve un token de sesión |

## Cómo apuntar el sitio aquí

En `config.js` del sitio:

```js
estaciones: {
  baseUrl: 'http://localhost:3001/api/',
  cabeceras: {},                                  // el token ya no viaja al navegador
  unidades: { temperatura: 'F', presion: 'inHg', viento: 'ms', lluvia: 'mm' },
},
historico: {
  baseUrl: 'http://localhost:3001/api/',
  ruta: 'get_station_history',
},
solicitudes: { endpoint: 'http://localhost:3001/api/solicitudes' },
acceso:      { endpoint: 'http://localhost:3001/api/login' },
```

**Ojo con las unidades del histórico.** El servidor guarda ya convertido a
Sistema Internacional, mientras que el proxy de estaciones reenvía la respuesta
original sin tocar. Si usas los dos a la vez, el bloque `estaciones.unidades`
debe declarar las unidades de origen (`F`, `inHg`) y el servidor del histórico
devuelve °C y hPa. Para evitar la asimetría, lo más limpio es que el proxy
convierta también: la función está en `servidor.js`, basta aplicarla en la ruta
`/api/get_station_info` y poner entonces `unidades` en `C` y `hPa`.

## Correo de las solicitudes

Cada solicitud se guarda en la tabla `solicitudes` y se avisa por correo a
**meteonet@utm.edu.ec**. El destinatario sale de `CORREO_OBSERVATORIO` en el
`.env`, o del campo `destino` que manda el sitio, tomado a su vez de
`solicitudes.correoDestino` en `config.js`.

El aviso lleva como `Reply-To` el correo de quien solicita, así que basta
responder al mensaje para contestarle directamente.

Configura el SMTP de la universidad en el `.env`:

```
SMTP_HOST=smtp.utm.edu.ec
SMTP_PUERTO=587
SMTP_USUARIO=meteonet@utm.edu.ec
SMTP_CLAVE=...
SMTP_REMITENTE=meteonet@utm.edu.ec
```

**Sin `SMTP_HOST` la solicitud se guarda igual** y el contenido del aviso queda
en el registro de consola, para que no se pierda mientras el correo no esté
configurado. El guardado va antes que el envío: si el correo falla, la
solicitud sigue en la base de datos.

## El muestreo es lo importante

La tabla `lecturas` se llena sola cada `MINUTOS_MUESTREO` minutos, consultando
todas las estaciones y guardando una fila por cada una. **Sin este proceso
corriendo, el histórico queda vacío**, por mucho que el endpoint exista.

Conviene dejarlo bajo un supervisor, `systemd` o `pm2`, para que sobreviva a
reinicios. Con un muestreo cada 10 minutos y tres estaciones son unas 157 000
filas al año, nada para SQLite. Si la red crece mucho o se quiere consultar
desde varias aplicaciones, migra a PostgreSQL: solo cambian las tres sentencias
preparadas del principio.

## Lo que falta para producción

Esto es un punto de partida honesto, no un sistema terminado. Antes de exponerlo:

- **HTTPS.** Detrás de nginx o Caddy, nunca en claro.
- **Límite de peticiones** en `/api/login` y `/api/solicitudes`, para que nadie
  pruebe claves ni llene la tabla.
- **Sesiones persistentes.** Ahora viven en memoria y se pierden al reiniciar.
- **Copias de seguridad** del archivo `.db`.
- **Registro de auditoría** de quién accede y qué cambia.
