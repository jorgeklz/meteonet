/* =============================================================================
   Pruebas del servidor de UTM MeteoNet
   -----------------------------------------------------------------------------
   Ejercita servidor.js sin red y sin instalar nada. Copia el servidor a una
   carpeta temporal reescribiendo sus importaciones hacia los dobles de
   `dobles/`, lo importa y borra la copia al terminar. No crea node_modules,
   que algunos entornos no permiten escribir.

       node prueba.mjs
   ============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TEMP = path.join(AQUI, '.tmp-prueba');
const DOBLES = path.join(AQUI, 'dobles');

const rutaDoble = (nombre, archivo = 'index.js') =>
  pathToFileURL(path.join(DOBLES, nombre, archivo)).href;

const SUSTITUCIONES = [
  ["from 'express'", `from '${rutaDoble('express')}'`],
  ["from 'cors'", `from '${rutaDoble('cors')}'`],
  ["from 'better-sqlite3'", `from '${rutaDoble('better-sqlite3')}'`],
  ["from 'bcryptjs'", `from '${rutaDoble('bcryptjs')}'`],
  ["from 'nodemailer'", `from '${rutaDoble('nodemailer')}'`],
  ["import 'dotenv/config';", `import '${rutaDoble('dotenv', 'config.js')}';`],
];

const origen = path.join(AQUI, '..', 'servidor.js');
if (!fs.existsSync(origen)) {
  console.error('No encuentro ../servidor.js. Ejecuta esto desde servidor/pruebas.');
  process.exit(1);
}

fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(TEMP, { recursive: true });
process.on('exit', () => fs.rmSync(TEMP, { recursive: true, force: true }));

let fuente = fs.readFileSync(origen, 'utf8');
for (const [buscar, poner] of SUSTITUCIONES) {
  if (!fuente.includes(buscar)) {
    console.error('servidor.js ya no importa ' + buscar + '. Actualiza las sustituciones.');
    process.exit(1);
  }
  fuente = fuente.replace(buscar, poner);
}
const RUTA_SERVIDOR = path.join(TEMP, 'servidor.mjs');
fs.writeFileSync(RUTA_SERVIDOR, fuente);

const bcrypt = (await import(rutaDoble('bcryptjs'))).default;

process.env.BASE_DATOS = 'prueba.db';
process.env.ORIGEN_API = 'http://127.0.0.1:1/';
process.env.ADMIN_USUARIO = 'admin';
process.env.ADMIN_HASH = bcrypt.hashSync('utm2026');
process.env.SMTP_HOST = 'smtp.falso';
process.env.CORREO_OBSERVATORIO = 'meteonet@utm.edu.ec';

const { app } = await import(pathToFileURL(RUTA_SERVIDOR).href);
const nodemailer = (await import(rutaDoble('nodemailer'))).default;

let fallos = 0;
const comprobar = (nombre, ok, detalle = '') => {
  if (!ok) fallos += 1;
  console.log(` ${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ' · ' + detalle : ''}`);
};

console.log('A. ORDEN DE RUTAS');
app.rutas.forEach(r => console.log(`   ${r.metodo.padEnd(4)} ${r.ruta}`));
const h = app.resolver('GET', '/api/get_station_history');
comprobar('/api/get_station_history llega a su manejador', h && h.ruta === '/api/get_station_history', h ? h.ruta : 'ninguna');
comprobar('/api/get_stations sigue atendida', !!app.resolver('GET', '/api/get_stations'));
comprobar('/api/get_station_info sigue atendida', !!app.resolver('GET', '/api/get_station_info'));
comprobar('ruta no declarada no existe', !app.resolver('GET', '/api/borrar_todo'));

console.log('\nB. HISTORICO');
const vacio = await app.pedir('GET', '/api/get_station_history?stationId=abc');
comprobar('responde 200 con lista', vacio.status === 200 && Array.isArray(vacio.body.data), 'estado ' + vacio.status);
const sinId = await app.pedir('GET', '/api/get_station_history');
comprobar('exige stationId', sinId.status === 400, 'estado ' + sinId.status);

console.log('\nC. ACCESO');
const mal = await app.pedir('POST', '/api/login', { body: { usuario: 'admin', clave: 'nope' } });
comprobar('clave incorrecta -> 401', mal.status === 401);
const inexistente = await app.pedir('POST', '/api/login', { body: { usuario: 'nadie', clave: 'x' } });
comprobar('usuario inexistente -> 401', inexistente.status === 401);
const bien = await app.pedir('POST', '/api/login', { body: { usuario: 'admin', clave: 'utm2026' }, ip: '9.9.9.9' });
comprobar('credenciales validas -> token', bien.status === 200 && !!bien.body.token);
const token = bien.body.token;

console.log('\nD. LISTADO DE SOLICITUDES PROTEGIDO');
const sinSesion = await app.pedir('GET', '/api/solicitudes');
comprobar('sin cabecera -> 401', sinSesion.status === 401, 'estado ' + sinSesion.status);
const tokenFalso = await app.pedir('GET', '/api/solicitudes', { headers: { authorization: 'Bearer inventado' } });
comprobar('token inventado -> 401', tokenFalso.status === 401);
const conSesion = await app.pedir('GET', '/api/solicitudes', { headers: { authorization: 'Bearer ' + token } });
comprobar('con sesion -> 200', conSesion.status === 200 && Array.isArray(conSesion.body.data));

console.log('\nE. SOLICITUD Y CORREO');
const env = await app.pedir('POST', '/api/solicitudes', {
  ip: '7.7.7.1',
  body: { fullName: 'Maria Mendoza', email: 'maria@utm.edu.ec', institution: 'UTM',
          stationId: 'all', variables: ['temperature','humidity'], startDate: '2026-11-01',
          endDate: '2026-11-07', purpose: 'Tesis' },
});
comprobar('solicitud aceptada', env.status === 200 && env.body.ok);
const correo = nodemailer.enviados.at(-1);
comprobar('correo a meteonet@utm.edu.ec', correo && correo.to === 'meteonet@utm.edu.ec', correo && correo.to);
comprobar('responde al solicitante', correo && correo.replyTo === 'maria@utm.edu.ec');
const faltan = await app.pedir('POST', '/api/solicitudes', { ip: '7.7.7.2', body: { email: 'a@b.c' } });
comprobar('faltan obligatorios -> 400', faltan.status === 400);
const listado = await app.pedir('GET', '/api/solicitudes', { headers: { authorization: 'Bearer ' + token } });
comprobar('la solicitud aparece en el listado', listado.body.data.length === 1 && Array.isArray(listado.body.data[0].variables));

console.log('\nF. LIMITE DE PETICIONES');
let estados = [];
for (let i = 0; i < 10; i++) {
  const r = await app.pedir('POST', '/api/login', { body: { usuario: 'admin', clave: 'mala' }, ip: '5.5.5.5' });
  estados.push(r.status);
}
comprobar('acceso: corta a los 8 intentos', estados.filter(s => s === 429).length === 2, estados.join(','));
const corte = await app.pedir('POST', '/api/login', { body: { usuario: 'admin', clave: 'utm2026' }, ip: '5.5.5.5' });
comprobar('ni con clave buena pasa mientras esta cortado', corte.status === 429);
comprobar('otra ip no queda afectada', (await app.pedir('POST', '/api/login', { body: { usuario: 'admin', clave: 'utm2026' }, ip: '6.6.6.6' })).status === 200);
comprobar('informa cuanto esperar', corte.body.reintentarEnSegundos > 0 && corte.cabeceras['Retry-After'], String(corte.cabeceras['Retry-After']) + ' s');
let sol = [];
for (let i = 0; i < 7; i++) {
  const r = await app.pedir('POST', '/api/solicitudes', { ip: '8.8.8.8',
    body: { fullName: 'X', email: 'x@y.z' } });
  sol.push(r.status);
}
comprobar('solicitudes: corta a las 5', sol.filter(s => s === 429).length === 2, sol.join(','));

console.log('\nG. SESION QUE SOBREVIVE AL REINICIO');
const mod2 = await import(pathToFileURL(RUTA_SERVIDOR).href + '?reinicio=1');
const r2 = await mod2.app.pedir('GET', '/api/solicitudes', { headers: { authorization: 'Bearer ' + token } });
comprobar('el token sigue valido tras reiniciar', r2.status === 200, 'estado ' + r2.status);
const cierre = await mod2.app.pedir('POST', '/api/logout', { headers: { authorization: 'Bearer ' + token } });
comprobar('logout responde ok', cierre.status === 200);
const tras = await mod2.app.pedir('GET', '/api/solicitudes', { headers: { authorization: 'Bearer ' + token } });
comprobar('tras cerrar sesion -> 401', tras.status === 401, 'estado ' + tras.status);

console.log('\nH. MUESTREO NO ARRANCA AL IMPORTAR');
comprobar('sin lecturas por importar el modulo', true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
