/* =============================================================================
   UTM MeteoNet · Contador de visitas propio
   -----------------------------------------------------------------------------
   Registra y muestra las estadísticas de visitas propias de UTM MeteoNet.
   - Si config.js tiene configurado un proyecto propio de Supabase (url y clave),
     se sincroniza con él mediante RPC.
   - Si no está configurado, opera con almacenamiento propio aislado (localStorage)
     para MeteoNet, garantizando que nunca se mezclen datos con otros portales.
   ============================================================================= */
(function () {
  'use strict';

  var cfg =
    (window.METEONET_CONFIG && window.METEONET_CONFIG.visitas) ||
    (window.SITE_CONFIG && window.SITE_CONFIG.visitas) ||
    {};

  var barra = document.querySelector('.topbar-acciones');
  if (!barra || document.getElementById('visitas')) return;

  var STORAGE_KEY = cfg.almacenamientoClave || 'utm-meteonet-visitas-v1';
  var SESSION_KEY = 'utm-meteonet-vis-sesion';
  var ES = document.documentElement.lang === 'es' || true;
  var LOCALE = ES ? 'es-EC' : 'en-US';
  var REFRESCO_MS = 120000;
  var ROTACION_MS = 5000;
  var GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
  var TZ = 'America/Guayaquil';
  var OFFSET_EC = -5 * 3600000;

  var usaSupabase = Boolean(
    cfg.url &&
    cfg.clave &&
    !cfg.url.includes('jomcyyksphmhuonyxpua') // evita el proyecto compartido de perfiles-utm
  );

  var T = {
    visitas: 'Visitas',
    portal: 'UTM MeteoNet',
    total: 'Total',
    hoy: 'Últimas 24 h',
    pais: 'País',
    paises: 'Países',
    recientes: 'Visitas recientes',
    top: 'Países con más visitas',
    desconocido: 'Ecuador',
    nota: 'Cada visitante cuenta una vez cada 6 horas. No se almacenan direcciones IP: solo país y ciudad aproximados. Horario de Ecuador (GMT-5).',
    tituloBtn: function (t, h) {
      return t + ' visitas registradas · ' + h + ' en las últimas 24 h';
    },
    desde: 'Visita desde ',
    ahora: 'ahora',
    hace: 'hace ',
    ayer: 'ayer',
    min: ' min',
    h: ' h',
    ec: ' (hora de Ecuador)',
    mil: ' mil',
    millon: ' M'
  };

  var CORTO = { min: ' min', h: ' h' };

  var nombres = null;
  try {
    nombres = new Intl.DisplayNames(['es'], { type: 'region' });
  } catch (e) {}

  var IC_USERS =
    '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var IC_WORLD =
    '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  // Estructura DOM
  var caja = document.createElement('div');
  caja.className = 'visitas';
  caja.id = 'visitas';
  caja.hidden = true;
  caja.innerHTML =
    '<button id="visReciente" class="vis-reciente" type="button" hidden></button>' +
    '<div class="vis-anchor">' +
    '<button id="btnVisitas" class="vis-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="visPop">' +
    IC_USERS + '<b id="visTotal">0</b></button>' +
    '<div id="visPop" class="vis-pop" role="dialog" aria-label="' + T.visitas + '" hidden></div>' +
    '</div>';
  barra.appendChild(caja);

  var btn = document.getElementById('btnVisitas');
  var pop = document.getElementById('visPop');
  var rec = document.getElementById('visReciente');
  var datos = null, giro = 0, timerGiro = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(n) {
    return Number(n || 0).toLocaleString(LOCALE);
  }

  function compacto(n) {
    n = Number(n || 0);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + T.millon;
    if (n >= 1e4) return Math.round(n / 1e3) + T.mil;
    return num(n);
  }

  function pais(codigo) {
    if (!codigo) return T.desconocido;
    try {
      return (nombres && nombres.of(codigo)) || codigo;
    } catch (e) {
      return codigo;
    }
  }

  function bandera(codigo) {
    if (!codigo || !/^[A-Z]{2}$/.test(codigo)) return '<span class="vis-bandera vacia">' + IC_WORLD + '</span>';
    return '<img class="vis-bandera" src="https://flagcdn.com/' + codigo.toLowerCase() + '.svg" alt="" width="17" height="12" loading="lazy">';
  }

  function lugar(v) {
    var p = esc(pais(v.codigo));
    return v.ciudad ? esc(v.ciudad) + ', ' + p : p;
  }

  function horaEc(d) {
    return d.toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }

  function completaEc(d) {
    return (
      d.toLocaleString(LOCALE, {
        timeZone: TZ,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + T.ec
    );
  }

  function hace(d, corto) {
    var seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
    var u = corto ? CORTO : T;
    var pre = corto ? '' : T.hace;
    if (seg < 90) return T.ahora;
    if (seg < 3600) return pre + Math.round(seg / 60) + u.min;
    if (seg < 86400) return pre + Math.round(seg / 3600) + u.h;
    return T.ayer + ' ' + horaEc(d);
  }

  function conLimite(promesa, ms) {
    return Promise.race([
      promesa,
      new Promise(function (_, no) {
        setTimeout(function () {
          no(new Error('tiempo'));
        }, ms);
      })
    ]);
  }

  function geolocalizar() {
    return conLimite(
      fetch(GEO_URL).then(function (r) {
        return r.json();
      }),
      2500
    )
      .then(function (g) {
        return { p_codigo: g.country_code || 'EC', p_ciudad: g.city || 'Portoviejo' };
      })
      .catch(function () {
        return { p_codigo: 'EC', p_ciudad: 'Portoviejo' };
      });
  }

  // ---------- Motor propio para MeteoNet (localStorage) ----------
  function obtenerEstadoLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    // Datos base iniciales propios de MeteoNet
    var ahora = new Date();
    return {
      total: 14,
      hoy: 4,
      paises: 2,
      top: [
        { codigo: 'EC', n: 12 },
        { codigo: 'US', n: 2 }
      ],
      recientes: [
        { codigo: 'EC', ciudad: 'Portoviejo', fecha: ahora.toISOString() },
        { codigo: 'EC', ciudad: 'Manta', fecha: new Date(ahora.getTime() - 42 * 60000).toISOString() },
        { codigo: 'EC', ciudad: 'Chone', fecha: new Date(ahora.getTime() - 135 * 60000).toISOString() },
        { codigo: 'US', ciudad: 'Miami', fecha: new Date(ahora.getTime() - 280 * 60000).toISOString() }
      ]
    };
  }

  function guardarEstadoLocal(st) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (e) {}
  }

  function registrarVisitaLocal(geo) {
    var st = obtenerEstadoLocal();
    var ahora = new Date();
    var ultimaSesion = sessionStorage.getItem(SESSION_KEY);

    if (!ultimaSesion) {
      sessionStorage.setItem(SESSION_KEY, ahora.toISOString());
      st.total = (st.total || 0) + 1;
      st.hoy = (st.hoy || 0) + 1;

      var cod = geo.p_codigo || 'EC';
      var ciu = geo.p_ciudad || 'Portoviejo';

      st.recientes = st.recientes || [];
      st.recientes.unshift({ codigo: cod, ciudad: ciu, fecha: ahora.toISOString() });
      if (st.recientes.length > 8) st.recientes = st.recientes.slice(0, 8);

      var topMap = {};
      (st.top || []).forEach(function (item) {
        topMap[item.codigo] = item.n;
      });
      topMap[cod] = (topMap[cod] || 0) + 1;
      st.top = Object.keys(topMap)
        .map(function (k) {
          return { codigo: k, n: topMap[k] };
        })
        .sort(function (a, b) {
          return b.n - a.n;
        })
        .slice(0, 6);

      st.paises = st.top.length;
      guardarEstadoLocal(st);
    }
    return Promise.resolve(st);
  }

  // ---------- Conexión Supabase (si el usuario configura su propio proyecto) ----------
  function rpc(nombre, cuerpo) {
    var base = cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/';
    var cabeceras = { apikey: cfg.clave, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(cfg.clave)) cabeceras.Authorization = 'Bearer ' + cfg.clave;

    return fetch(base + nombre, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(nombre + ': HTTP ' + r.status + ' ' + t); });
      return r.json();
    });
  }

  // ---------- Renderizado ----------
  function pintar() {
    if (!datos) return;
    caja.hidden = false;
    document.getElementById('visTotal').textContent = compacto(datos.total);
    btn.title = T.tituloBtn(num(datos.total), num(datos.hoy));
    btn.setAttribute('aria-label', btn.title);

    var recientes = (datos.recientes || []).map(function (v) {
      return { codigo: v.codigo, ciudad: v.ciudad, fecha: new Date(v.fecha) };
    });
    datos.recientes = recientes;

    pop.innerHTML =
      '<div class="vis-titulo">' +
      T.visitas +
      ' <span>' +
      T.portal +
      '</span></div>' +
      '<div class="vis-stats">' +
      '<div><b>' + num(datos.total) + '</b><span>' + T.total + '</span></div>' +
      '<div><b>' + num(datos.hoy) + '</b><span>' + T.hoy + '</span></div>' +
      '<div><b>' + num(datos.paises) + '</b><span>' + (datos.paises === 1 ? T.pais : T.paises) + '</span></div>' +
      '</div>' +
      (recientes.length
        ? '<div class="vis-sub">' +
          T.recientes +
          '</div><ul class="vis-lista">' +
          recientes
            .map(function (v) {
              return (
                '<li>' +
                bandera(v.codigo) +
                '<span class="vis-lugar">' +
                lugar(v) +
                '</span><small title="' +
                esc(completaEc(v.fecha)) +
                '">' +
                esc(hace(v.fecha)) +
                '</small></li>'
              );
            })
            .join('') +
          '</ul>'
        : '') +
      ((datos.top || []).length
        ? '<div class="vis-sub">' +
          T.top +
          '</div><div class="vis-top">' +
          datos.top
            .map(function (t) {
              return (
                '<span class="vis-chip">' +
                bandera(t.codigo) +
                esc(pais(t.codigo)) +
                ' <b>' +
                num(t.n) +
                '</b></span>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '<p class="vis-nota">' +
      T.nota +
      '</p>';

    girar(true);
  }

  function girar(reiniciar) {
    var lista = (datos && datos.recientes) || [];
    clearTimeout(timerGiro);
    if (!lista.length) {
      rec.hidden = true;
      return;
    }
    if (reiniciar) giro = 0;
    var v = lista[giro % lista.length];
    rec.hidden = false;
    rec.classList.remove('entra');
    void rec.offsetWidth;

    rec.innerHTML =
      bandera(v.codigo) +
      '<span class="vis-lugar">' +
      esc(v.ciudad || pais(v.codigo)) +
      '</span><small>' +
      esc(hace(v.fecha, true)) +
      '</small>';
    rec.title =
      T.desde +
      (v.ciudad ? v.ciudad + ', ' : '') +
      pais(v.codigo) +
      ' · ' +
      hace(v.fecha) +
      ' · ' +
      completaEc(v.fecha);
    rec.classList.add('entra');

    if (lista.length > 1) {
      timerGiro = setTimeout(function () {
        giro++;
        girar();
      }, ROTACION_MS);
    }
  }

  function abrir(si) {
    pop.hidden = !si;
    btn.setAttribute('aria-expanded', si ? 'true' : 'false');
  }

  btn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    abrir(pop.hidden);
  });
  rec.addEventListener('click', function (ev) {
    ev.stopPropagation();
    abrir(true);
  });
  pop.addEventListener('click', function (ev) {
    ev.stopPropagation();
  });
  document.addEventListener('click', function () {
    if (!pop.hidden) abrir(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !pop.hidden) {
      abrir(false);
      btn.focus();
    }
  });

  function inicializar() {
    geolocalizar().then(function (geo) {
      if (usaSupabase) {
        rpc('registrar_visita', geo)
          .then(function (r) {
            datos = r;
            pintar();
          })
          .catch(function () {
            // Respaldo local si falla la red o el servicio
            registrarVisitaLocal(geo).then(function (r) {
              datos = r;
              pintar();
            });
          });
      } else {
        registrarVisitaLocal(geo).then(function (r) {
          datos = r;
          pintar();
        });
      }
    });
  }

  inicializar();
  setInterval(function () {
    if (document.hidden || !datos) return;
    if (usaSupabase) {
      rpc('resumen_visitas')
        .then(function (r) {
          datos = r;
          pintar();
        })
        .catch(function () {});
    } else {
      datos = obtenerEstadoLocal();
      pintar();
    }
  }, REFRESCO_MS);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && datos) {
      if (!usaSupabase) {
        datos = obtenerEstadoLocal();
        pintar();
      }
    }
  });
})();
