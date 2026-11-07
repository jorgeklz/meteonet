/* =============================================================================
   UTM MeteoNet · Contador de visitas propio
   -----------------------------------------------------------------------------
   Registra visitas anónimas en Supabase (huella SHA-256 por IP cada 6 horas)
   y muestra el resumen de visitantes, visitas de las últimas 24 horas,
   países y ciudades recientes.
   ============================================================================= */
(function () {
  'use strict';

  var cfg = (window.METEONET_CONFIG && window.METEONET_CONFIG.visitas) || {};
  if (!cfg.url || !cfg.clave) return;

  var barra = document.querySelector('.topbar-acciones');
  if (!barra || document.getElementById('visitas')) return;

  var LOCALE = 'es-EC';
  var REFRESCO_MS = 120000;
  var ROTACION_MS = 5000;
  var GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
  var TZ = 'America/Guayaquil';
  var base = cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/';

  var T = {
    visitas: 'Visitas',
    portal: 'UTM MeteoNet',
    total: 'Total',
    hoy: 'Últimas 24 h',
    pais: 'País',
    paises: 'Países',
    recientes: 'Visitas recientes',
    top: 'Países con más visitas',
    desconocido: 'Ubicación no identificada',
    nota: 'Cada visitante cuenta una vez cada 6 horas. No se almacenan direcciones IP: solo país y ciudad aproximados. Horario de Ecuador (GMT-5).',
    tituloBtn: function (t, h) {
      return t + ' visitas registradas · ' + h + ' en las últimas 24 h';
    },
    desde: 'Visita desde ',
    ahora: 'ahora',
    hace: 'hace ',
    ayer: 'ayer',
    mil: ' mil',
    millon: ' M'
  };

  var nombres = null;
  try {
    nombres = new Intl.DisplayNames(['es'], { type: 'region' });
  } catch (e) {}

  var IC_USERS =
    '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var IC_WORLD =
    '<svg class="vis-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  // Estructura en la barra
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
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', ',') + T.millon;
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
      }) + ' (hora de Ecuador)'
    );
  }

  function hace(d, corto) {
    var seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
    var u = corto ? { min: ' min', h: ' h' } : { min: ' min', h: ' h' };
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
        return { p_codigo: g.country_code || null, p_ciudad: g.city || null };
      })
      .catch(function () {
        return {};
      });
  }

  function rpc(nombre, cuerpo) {
    var cabeceras = {
      apikey: cfg.clave,
      Authorization: 'Bearer ' + cfg.clave,
      'Content-Type': 'application/json'
    };

    return fetch(base + nombre, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(nombre + ': HTTP ' + r.status + ' ' + t); });
      return r.json();
    });
  }

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
      rpc('registrar_visita', geo)
        .then(function (r) {
          datos = r;
          pintar();
        })
        .catch(function (err) {
          console.warn('Contador de visitas:', err.message);
        });
    });
  }

  inicializar();

  setInterval(function () {
    if (document.hidden || !datos) return;
    rpc('resumen_visitas')
      .then(function (r) {
        datos = r;
        pintar();
      })
      .catch(function () {});
  }, REFRESCO_MS);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && datos) {
      rpc('resumen_visitas')
        .then(function (r) {
          datos = r;
          pintar();
        })
        .catch(function () {});
    }
  });
})();
