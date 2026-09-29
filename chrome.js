// chrome.js
// Elementos compartidos de UI en todas las páginas con sesión:
//  - Campana de notificaciones internas (contador + dropdown)
//  - Modo oscuro (toggle persistente en localStorage)
//
// La búsqueda de incidencias vive en la barra de filtros del dashboard.
// Se carga después de ui.js y toast.js en cada página logueada.

(function () {
  const TEMA_KEY = 'tema';

  function aplicarTema() {
    let tema = 'claro';
    try { tema = localStorage.getItem(TEMA_KEY) || 'claro'; } catch (e) { /* ignore */ }
    document.documentElement.classList.toggle('tema-oscuro', tema === 'oscuro');
  }

  // ---------------------------------------------------------------
  // Modo oscuro
  // ---------------------------------------------------------------
  function inyectarTema() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer || footer.querySelector('#btn-tema')) return;

    const boton = document.createElement('button');
    boton.id = 'btn-tema';
    boton.type = 'button';
    boton.className = 'btn-tema';
    footer.insertBefore(boton, document.getElementById('btn-logout'));

    const actualizarEtiqueta = () => {
      const oscuro = document.documentElement.classList.contains('tema-oscuro');
      boton.textContent = oscuro ? '☀️' : '🌙';
      const texto = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
      boton.title = texto;
      boton.setAttribute('aria-label', texto);
    };

    boton.addEventListener('click', () => {
      const oscuro = document.documentElement.classList.toggle('tema-oscuro');
      try { localStorage.setItem(TEMA_KEY, oscuro ? 'oscuro' : 'claro'); } catch (e) { /* ignore */ }
      actualizarEtiqueta();
      mostrarToast(oscuro ? 'Modo oscuro activado' : 'Modo claro activado', 'success');
    });

    actualizarEtiqueta();
  }

  // ---------------------------------------------------------------
  // Iniciales del usuario en el avatar del pie del sidebar
  // ---------------------------------------------------------------
  function pintarAvatar() {
    const avatar = document.querySelector('.sidebar-footer .user-avatar');
    const nombre = document.getElementById('usuario-actual');
    if (!avatar || !nombre) return;

    const texto = (nombre.textContent || '').trim();
    if (!texto) return;

    const partes = texto.split(/\s+/).filter(Boolean);
    const iniciales = (partes.length > 1
      ? partes[0][0] + partes[1][0]
      : partes[0].slice(0, 2)).toUpperCase();

    // Guarda: evita reescribir y disparar el observer otra vez.
    if (avatar.textContent !== iniciales) avatar.textContent = iniciales;
    avatar.title = texto;
  }

  // El nombre lo escribe cada página al cargar el usuario actual.
  const nombreUsuario = document.getElementById('usuario-actual');
  if (nombreUsuario) {
    new MutationObserver(pintarAvatar).observe(nombreUsuario, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  pintarAvatar();

  // ---------------------------------------------------------------
  // Campana de notificaciones
  // ---------------------------------------------------------------
  const ICONOS_NOTIFICACION = { nueva: '🆕', asignacion: '👤', estado: '🔁', comentario: '💬' };
  let campanaAbierta = false;

  function inyectarCampana() {
    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.header-actions')) return;

    const acciones = document.createElement('div');
    acciones.className = 'header-actions';
    acciones.innerHTML = `
      <div class="nav-campana">
        <button type="button" id="btn-campana" class="btn-campana" title="Notificaciones">🔔
          <span id="contador-campana" class="campana-burbuja" hidden></span>
        </button>
        <div id="dropdown-notificaciones" class="dropdown-notificaciones" hidden>
          <div class="dropdown-head">
            <span>Notificaciones</span>
            <button type="button" id="btn-refrescar-campana" class="dropdown-actualizar" title="Actualizar">⟳</button>
          </div>
          <ul id="lista-notificaciones"></ul>
        </div>
      </div>`;
    header.appendChild(acciones);

    const campana = document.getElementById('btn-campana');
    const dropdown = document.getElementById('dropdown-notificaciones');

    campana.addEventListener('click', async () => {
      campanaAbierta = !campanaAbierta;
      dropdown.hidden = !campanaAbierta;
      if (campanaAbierta) {
        try { await window.api.marcarNotificacionesLeidas(); } catch (e) { /* ignore */ }
        refrescarNotificaciones();
      }
    });

    document.getElementById('btn-refrescar-campana').addEventListener('click', (e) => {
      e.stopPropagation();
      refrescarNotificaciones();
    });

    document.addEventListener('click', (e) => {
      if (campanaAbierta && !e.target.closest('.nav-campana')) {
        campanaAbierta = false;
        dropdown.hidden = true;
      }
    });
  }

  function renderNotificaciones(lista) {
    const ul = document.getElementById('lista-notificaciones');
    const contador = document.getElementById('contador-campana');
    if (!ul) return;

    const noLeidas = lista.filter((n) => !n.leida).length;
    contador.hidden = noLeidas === 0;
    if (noLeidas > 0) contador.textContent = noLeidas > 99 ? '99+' : String(noLeidas);

    if (!lista.length) {
      ul.innerHTML = '<li class="n-vacio">Sin notificaciones todavía.</li>';
      return;
    }

    ul.innerHTML = lista
      .map(
        (n) => `
      <li class="n-item ${n.leida ? '' : 'no-leida'}" data-id="${n.id_notificacion}"
          ${n.id_incidencia ? `data-inc="${n.id_incidencia}"` : ''}>
        <span class="n-icono">${ICONOS_NOTIFICACION[n.tipo] || '🔔'}</span>
        <div>
          <div class="n-texto">${n.mensaje}</div>
          <div class="n-fecha">${formatearFecha(n.fecha_creacion)}</div>
        </div>
      </li>`
      )
      .join('');

    ul.querySelectorAll('.n-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const inc = item.dataset.inc;
        if (id) {
          try { await window.api.marcarNotificacionLeida(Number(id)); } catch (e) { /* ignore */ }
        }
        campanaAbierta = false;
        const dropdown = document.getElementById('dropdown-notificaciones');
        if (dropdown) dropdown.hidden = true;
        if (inc) window.location.href = `detalle.html?id=${inc}`;
      });
    });
  }

  async function refrescarNotificaciones() {
    try {
      const lista = await window.api.getNotificaciones();
      renderNotificaciones(lista);
    } catch (e) {
      /* sin sesión u otro error: ignorar */
    }
  }

  // ---------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------
  (async function initChrome() {
    if (document.body.classList.contains('login-body')) return;

    aplicarTema();
    inyectarTema();
    inyectarCampana();

    if (window.api && window.api.getNotificaciones) {
      refrescarNotificaciones();
      setInterval(refrescarNotificaciones, 30000);
      window.addEventListener('focus', refrescarNotificaciones);
    }
  })();
})();