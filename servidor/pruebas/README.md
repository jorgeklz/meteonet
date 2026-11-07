# Pruebas del servidor

Ejercitan `servidor.js` sin red y sin instalar nada: `dobles/` contiene
sustitutos mínimos de express, better-sqlite3, bcryptjs, nodemailer, cors y
dotenv, suficientes para las sentencias y rutas que el servidor usa de verdad.

```bash
cd servidor/pruebas
node prueba.mjs
```

Qué comprueba:

| Bloque | Qué verifica |
|---|---|
| A | Que cada ruta llega a su manejador. Con el comodín `/api/:ruta` el histórico quedaba inalcanzable |
| B | El histórico responde una lista y exige `stationId` |
| C | Acceso: clave mala, usuario inexistente y credenciales válidas |
| D | El listado de solicitudes rechaza peticiones sin sesión y con token inventado |
| E | La solicitud se guarda, el aviso sale a meteonet@utm.edu.ec y responde al solicitante |
| F | El límite de peticiones corta a los 8 accesos y a las 5 solicitudes, por dirección, e informa cuánto esperar |
| G | La sesión sobrevive a un reinicio del servidor y el cierre de sesión la invalida |

Los dobles no sustituyen una prueba contra express y SQLite reales. Sirven para
que la lógica de rutas, sesiones y límites se pueda verificar en cualquier
máquina, también sin acceso al registro de paquetes.
