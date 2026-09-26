// tablero.js
// Vista Kanban: incidencias agrupadas por estado, con arrastre y soltado
// para cambiar de estado (los Empleados no pueden arrastrar: solo consultan).

let usuarioActual = null;
let incidencias = [];
let estados = [];
let idEstadoPorNombre = {};

async function protegerSesionYMostrarUsuario() {
  const usuario = await window.api.getCurrentUser();
  if (!usuario) {
    window.location.href = 'login.html';
    return null;
  }

  document.getElementById('usuario-actual').textContent =
    `${usuario.nombre} ${usuario.apellido} (${usuario.rol})`;

  if (usuario.rol !== 'Administrador') {
    document.querySelectorAll('.link-nav').forEach((l) => (l.style.display = 'none'));
  }

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await window.api.logout();
    window.location.href = 'login.html';
  });

  return usuario;
}

function tarjetaHTML(inc) {
  const arrastrable = usuarioActual.rol !== 'Empleado';
  const sla = infoSLA(inc);
  return `
    <div class="kanban-tarjeta" draggable="${arrastrable}" data-id="${inc.id_incidencia}" data-estado="${inc.estado}">
      <div class="kt-id">#${inc.id_incidencia}</div>
      <div class="kt-titulo">${inc.titulo}</div>
      <div class="kt-pie">
        <span>${obtenerBadge(inc.prioridad, inc.prioridad_color)}</span>
        <span class="kt-area">${inc.area}</span>
      </div>
      ${sla ? `<div class="kt-sla" style="--sla-color: ${sla.color}">${sla.texto}</div>` : ''}
    </div>`;
}

function construirTablero() {
  const kanban = document.getElementById('kanban');

  kanban.innerHTML = estados
    .map((est) => {
      const items = incidencias.filter((i) => i.estado === est.nombre);
      const cuerpo = items.length
        ? items.map(tarjetaHTML).join('')
        : '<div class="n-vacio">Sin incidencias</div>';
      return `
        <div class="kanban-columna" data-estado="${est.nombre}">
          <div class="kanban-cabecera">
            <span>${est.nombre}</span>
            <span class="kanban-contador">${items.length}</span>
          </div>
          ${cuerpo}
        </div>`;
    })
    .join('');

  enlazarDragDrop();
  enlazarClicks();
}

function enlazarClicks() {
  document.querySelectorAll('.kanban-tarjeta').forEach((tarjeta) => {
    tarjeta.addEventListener('click', () => {
      window.location.href = `detalle.html?id=${tarjeta.dataset.id}`;
    });
  });
}

function enlazarDragDrop() {
  document.querySelectorAll('.kanban-tarjeta[draggable="true"]').forEach((tarjeta) => {
    tarjeta.addEventListener('dragstart', (e) => {
      tarjeta.classList.add('arrastrando');
      e.dataTransfer.setData('text/incidencia', tarjeta.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    tarjeta.addEventListener('dragend', () => tarjeta.classList.remove('arrastrando'));
  });

  document.querySelectorAll('.kanban-columna').forEach((columna) => {
    columna.addEventListener('dragover', (e) => {
      e.preventDefault();
      columna.classList.add('encima');
    });
    columna.addEventListener('dragleave', () => columna.classList.remove('encima'));
    columna.addEventListener('drop', async (e) => {
      e.preventDefault();
      columna.classList.remove('encima');

      const id = e.dataTransfer.getData('text/incidencia');
      if (!id) return;

      const nuevoEstado = columna.dataset.estado;
      const idEstadoNuevo = idEstadoPorNombre[nuevoEstado];
      const inc = incidencias.find((x) => String(x.id_incidencia) === id);
      if (!idEstadoNuevo || !inc || inc.estado === nuevoEstado) return;

      try {
        await window.api.cambiarEstado({ id_incidencia: Number(id), id_estado_nuevo: idEstadoNuevo });
        inc.estado = nuevoEstado;
        construirTablero();
        mostrarToast(`#${id} movida a "${nuevoEstado}"`, 'success');
      } catch (err) {
        mostrarToast(err.message || 'No se pudo mover la incidencia', 'error');
      }
    });
  });
}

async function cargarDatos() {
  const catalogo = await window.api.getCatalogos();
  estados = catalogo.estados;
  idEstadoPorNombre = {};
  estados.forEach((est) => { idEstadoPorNombre[est.nombre] = est.id_estado; });

  incidencias = await window.api.getIncidencias();
  construirTablero();
}

protegerSesionYMostrarUsuario().then((usuario) => {
  usuarioActual = usuario;
  if (usuario) cargarDatos();
});