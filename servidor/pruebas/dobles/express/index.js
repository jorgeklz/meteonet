/* Doble de express suficiente para ejercitar las rutas del servidor. */
function crearApp() {
  const rutas = [];
  const app = (req, res) => app.manejar(req, res);
  app.ajustes = {};
  app.set = (k, v) => { app.ajustes[k] = v; };
  app.globales = [];
  app.use = (fn) => { if (typeof fn === 'function') app.globales.push(fn); };
  const registrar = (metodo) => (ruta, ...fns) => {
    const lista = Array.isArray(ruta) ? ruta : [ruta];
    lista.forEach((r) => rutas.push({ metodo, ruta: r, fns }));
  };
  app.get = registrar('GET');
  app.post = registrar('POST');
  app.listen = (p, cb) => { if (cb) cb(); return { close() {} }; };
  app.rutas = rutas;

  /* Express compara en orden de registro, igual que aqui. */
  app.resolver = (metodo, camino) => rutas.find((r) => {
    if (r.metodo !== metodo) return false;
    if (r.ruta === camino) return true;
    const partesR = r.ruta.split('/'), partesC = camino.split('/');
    if (partesR.length !== partesC.length) return false;
    return partesR.every((p, i) => p.startsWith(':') || p === partesC[i]);
  });

  app.pedir = async (metodo, url, { body, headers = {}, ip = '1.2.3.4' } = {}) => {
    const u = new URL(url, 'http://local');
    const camino = u.pathname;
    const r = app.resolver(metodo, camino);
    if (!r) return { status: 404, body: { error: 'sin ruta' } };
    const params = {};
    r.ruta.split('/').forEach((p, i) => { if (p.startsWith(':')) params[p.slice(1)] = camino.split('/')[i]; });
    const query = Object.fromEntries(u.searchParams);
    const req = { method: metodo, path: camino, params, query, body, headers, ip };
    const resultado = { status: 200, body: null, cabeceras: {} };
    const res = {
      status(c) { resultado.status = c; return res; },
      json(b) { resultado.body = b; resultado.fin = true; return res; },
      set(k, v) { resultado.cabeceras[k] = v; return res; },
    };
    const cadena = r.fns.slice();
    const siguiente = async () => {
      const fn = cadena.shift();
      if (!fn) return;
      await fn(req, res, siguiente);
    };
    await siguiente();
    return resultado;
  };
  return app;
}
crearApp.json = () => (req, res, next) => next && next();
module.exports = crearApp;
