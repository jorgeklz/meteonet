/*
 * Contador de visitas (Supabase), adaptado de Research y Emergency Radar.
 * ------------------------------------------------------------------
 * index.html carga este archivo. Aquí se arma el contador y se coloca al
 * final de las acciones de la barra superior (.topbar-acciones).
 * Cada carga llama a registrar_visita en el proyecto de Supabase del portal. El servidor toma la IP del
 * encabezado de la petición, guarda solo su huella cifrada y decide si es una visita nueva
 * (la misma IP cuenta otra vez recién después de 6 horas). Recargar o cambiar de página no suma.
 * País y ciudad aproximados se piden a un servicio de geolocalización sin clave; si no
 * responde, el servidor usa el país que informa la red. Las horas se muestran en hora de
 * Ecuador (GMT-5).
 */
(function () {
  "use strict";

  var cfg = ((window.SITE_CONFIG || {}).visitas) || ((window.METEONET_CONFIG || {}).visitas) || {};
  if (!cfg.url || !cfg.clave) return;
  var barra = document.querySelector(".topbar-acciones");
  if (!barra || document.getElementById("visitas")) return;

  var ES = document.documentElement.lang === "es";
  var LOCALE = ES ? "es-EC" : "en-US";
  var REFRESCO_MS = 120000;     // el resumen se actualiza cada 2 minutos
  var ROTACION_MS = 5000;       // la pastilla de "recientes" cambia cada 5 segundos
  var GEO_URL = "https://get.geojs.io/v1/ip/geo.json";
  var TZ = "America/Guayaquil";
  var OFFSET_EC = -5 * 3600000; // Ecuador continental no tiene horario de verano
  var base = cfg.url.replace(/\/+$/, "") + "/rest/v1/rpc/";

  var T = ES ? {
    visitas: "Visitas", total: "Total", hoy: "Últimas 24&nbsp;h", pais: "País", paises: "Países",
    recientes: "Visitas recientes", top: "Países con más visitas", desconocido: "Ubicación desconocida",
    nota: "Cada persona cuenta una vez cada 6 horas. No guardamos tu IP: solo una huella cifrada para no contar recargas, y el país y la ciudad aproximados. Horas de Ecuador (GMT-5).",
    tituloBtn: function (t, h) { return t + " visitas · " + h + " en las últimas 24 h"; },
    desde: "Visita reciente desde ", ahora: "ahora", hace: "hace ", ayer: "ayer", min: " min", h: " h", ec: " (hora de Ecuador)",
    mil: " mil", millon: " M"
  } : {
    visitas: "Visits", total: "Total", hoy: "Last 24&nbsp;h", pais: "Country", paises: "Countries",
    recientes: "Recent visits", top: "Top countries", desconocido: "Unknown location",
    nota: "Each person counts once every 6 hours. We do not store your IP: only an encrypted fingerprint to skip reloads, plus the approximate country and city. Times in Ecuador time (GMT-5).",
    tituloBtn: function (t, h) { return t + " visits · " + h + " in the last 24 h"; },
    desde: "Recent visit from ", ahora: "just now", hace: "", ayer: "yesterday", min: " min ago", h: " h ago", ec: " (Ecuador time)",
    mil: "k", millon: "M"
  };
  var CORTO = ES ? { min: " min", h: " h" } : { min: "m", h: "h" };

  var nombres = null;
  try { nombres = new Intl.DisplayNames([ES ? "es" : "en"], { type: "region" }); } catch (e) { /* navegador antiguo */ }

  // Icono "users" de Tabler (MIT), en línea.
  var IC_USERS = '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/></svg>';
  // Icono "world" de Tabler, para visitas sin país.
  var IC_WORLD = '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/></svg>';

  // ---------- estructura ----------
  var caja = document.createElement("div");
  caja.className = "visitas";
  caja.id = "visitas";
  caja.hidden = true;
  caja.innerHTML =
    '<button id="visReciente" class="vis-reciente" type="button" hidden></button>' +
    '<div class="vis-anchor">' +
    '<button id="btnVisitas" class="vis-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="visPop">' +
    IC_USERS + '<b id="visTotal">0</b></button>' +
    '<div id="visPop" class="vis-pop" role="dialog" aria-label="' + T.visitas + '" hidden></div>' +
    "</div>";
  barra.appendChild(caja);

  var btn = document.getElementById("btnVisitas");
  var pop = document.getElementById("visPop");
  var rec = document.getElementById("visReciente");
  var datos = null, giro = 0, timerGiro = null;

  // ---------- utilidades ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString(LOCALE); }
  function compacto(n) {
    n = Number(n || 0);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ES ? "," : ".") + T.millon;
    if (n >= 1e4) return Math.round(n / 1e3) + T.mil;
    return num(n);
  }
  function pais(codigo) {
    if (!codigo) return T.desconocido;
    try { return (nombres && nombres.of(codigo)) || codigo; } catch (e) { return codigo; }
  }
  function bandera(codigo) {
    if (!codigo || !/^[A-Z]{2}$/.test(codigo)) return '<span class="vis-bandera vacia">' + IC_WORLD + "</span>";
    return '<img class="vis-bandera" src="https://flagcdn.com/' + codigo.toLowerCase() + '.svg" alt="" width="18" height="13" loading="lazy">';
  }
  function lugar(v) {
    var p = esc(pais(v.codigo));
    return v.ciudad ? esc(v.ciudad) + ", " + p : p;
  }

  // Fechas en hora de Ecuador.
  function diaEc(d) { return Math.floor((d.getTime() + OFFSET_EC) / 86400000); }
  function horaEc(d) { return d.toLocaleTimeString(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }); }
  function fechaEc(d) { return d.toLocaleDateString(LOCALE, { timeZone: TZ, day: "numeric", month: "short" }); }
  function completaEc(d) {
    return d.toLocaleString(LOCALE, { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + T.ec;
  }
  function hace(d, corto) {
    var seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
    var u = corto ? CORTO : T;
    var pre = corto ? "" : T.hace;
    if (seg < 60) return T.ahora;
    if (seg < 3600) return pre + Math.floor(seg / 60) + u.min;
    if (seg < 86400 && diaEc(new Date()) === diaEc(d)) return pre + Math.floor(seg / 3600) + u.h;
    var dias = diaEc(new Date()) - diaEc(d);
    if (dias <= 1) return corto ? T.ayer : T.ayer + " " + horaEc(d);
    return corto ? fechaEc(d) : fechaEc(d) + ", " + horaEc(d);
  }

  // ---------- servidor ----------
  // La clave nueva (sb_publishable_...) va solo en "apikey"; la antigua "anon" es un JWT
  // (empieza con eyJ) y también se envía como Authorization. Así sirve cualquiera de las dos.
  var cabeceras = { apikey: cfg.clave, "Content-Type": "application/json" };
  if (/^eyJ/.test(cfg.clave)) cabeceras.Authorization = "Bearer " + cfg.clave;

  function rpc(nombre, cuerpo) {
    return fetch(base + nombre, {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify(cuerpo || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(nombre + ": HTTP " + r.status + " " + t); });
      return r.json();
    });
  }
  function conLimite(promesa, ms) {
    return Promise.race([promesa, new Promise(function (_, no) { setTimeout(function () { no(new Error("tiempo")); }, ms); })]);
  }
  function geolocalizar() {
    return conLimite(fetch(GEO_URL).then(function (r) { return r.json(); }), 2500)
      .then(function (g) { return { p_codigo: g.country_code || null, p_ciudad: g.city || null }; })
      .catch(function () { return {}; });
  }

  // ---------- interfaz ----------
  function pintar() {
    if (!datos) return;
    caja.hidden = false;
    document.getElementById("visTotal").textContent = compacto(datos.total);
    btn.title = T.tituloBtn(num(datos.total), num(datos.hoy));
    btn.setAttribute("aria-label", btn.title);

    var recientes = (datos.recientes || []).map(function (v) {
      return { codigo: v.codigo, ciudad: v.ciudad, fecha: new Date(v.fecha) };
    });
    datos.recientes = recientes;
    pop.innerHTML =
      '<div class="vis-titulo">' + T.visitas + "</div>" +
      '<div class="vis-stats"><div><b>' + num(datos.total) + "</b><span>" + T.total + "</span></div><div><b>" + num(datos.hoy) +
      "</b><span>" + T.hoy + "</span></div><div><b>" + num(datos.paises) + "</b><span>" + (datos.paises === 1 ? T.pais : T.paises) + "</span></div></div>" +
      (recientes.length ? '<div class="vis-sub">' + T.recientes + '</div><ul class="vis-lista">' + recientes.map(function (v) {
        return "<li>" + bandera(v.codigo) + '<span class="vis-lugar">' + lugar(v) + '</span><small title="' + esc(completaEc(v.fecha)) + '">' + esc(hace(v.fecha)) + "</small></li>";
      }).join("") + "</ul>" : "") +
      ((datos.top || []).length ? '<div class="vis-sub">' + T.top + '</div><div class="vis-top">' + datos.top.map(function (t) {
        return '<span class="vis-chip">' + bandera(t.codigo) + esc(pais(t.codigo)) + " <b>" + num(t.n) + "</b></span>";
      }).join("") + "</div>" : "") +
      '<p class="vis-nota">' + T.nota + "</p>";

    girar(true);
  }

  // Pastilla con la visita más reciente; va rotando entre las últimas.
  function girar(reiniciar) {
    var lista = (datos && datos.recientes) || [];
    clearTimeout(timerGiro);
    if (!lista.length) { rec.hidden = true; return; }
    if (reiniciar) giro = 0;
    var v = lista[giro % lista.length];
    rec.hidden = false;
    rec.classList.remove("entra");
    void rec.offsetWidth;
    // En la pastilla va solo la ciudad (o el país si no hay ciudad); el lugar completo queda en el título.
    rec.innerHTML = bandera(v.codigo) + '<span class="vis-lugar">' + esc(v.ciudad || pais(v.codigo)) + "</span><small>" + esc(hace(v.fecha, true)) + "</small>";
    rec.title = T.desde + (v.ciudad ? v.ciudad + ", " : "") + pais(v.codigo) + " · " + hace(v.fecha) + " · " + completaEc(v.fecha);
    rec.classList.add("entra");
    if (lista.length > 1) timerGiro = setTimeout(function () { giro++; girar(); }, ROTACION_MS);
  }

  function abrir(si) {
    pop.hidden = !si;
    btn.setAttribute("aria-expanded", si ? "true" : "false");
  }
  btn.addEventListener("click", function (ev) { ev.stopPropagation(); abrir(pop.hidden); });
  rec.addEventListener("click", function (ev) { ev.stopPropagation(); abrir(true); });
  pop.addEventListener("click", function (ev) { ev.stopPropagation(); });
  document.addEventListener("click", function () { if (!pop.hidden) abrir(false); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !pop.hidden) { abrir(false); btn.focus(); } });

  function refrescar() {
    if (document.hidden || !datos) return;
    rpc("resumen_visitas")
      .then(function (r) { datos = r; pintar(); })
      .catch(function () { /* se reintenta en el próximo ciclo */ });
  }

  geolocalizar()
    .then(function (geo) { return rpc("registrar_visita", geo); })
    .then(function (r) { datos = r; pintar(); })
    .catch(function (e) { caja.hidden = true; if (window.console) console.warn("Contador de visitas:", e.message); });
  setInterval(refrescar, REFRESCO_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refrescar(); });
})();
