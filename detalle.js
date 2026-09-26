// detalle.js
const params = new URLSearchParams(window.location.search);
const idIncidencia = params.get('id');

const panelInfo = document.getElementById('panel-info');
const selectResponsable = document.getElementById('select-responsable');
const listaHistorial = document.getElementById('lista-historial');
const listaComentarios = document.getElementById('lista-comentarios');
const formComentario = document.getElementById('form-comentario');
const modalEditar = document.getElementById('modal-editar');
const formEditar = document.getElementById('form-editar');

let incidenciaActual = null;
let catalogosEditar = null;

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

function renderInfo(inc) {
  const sla = infoSLA(inc);
  const slaHTML = sla
    ? `<span class="badge" style="--badge-color: ${sla.color}">${sla.texto}</span>
       <span class="sla-detalle">plazo ${sla.objetivoHoras} h${
         sla.objetivoHoras >= 24 ? ` (${formatoDuracionSLA(sla.objetivoHoras)})` : ''}</span>`
    : '—';

  panelInfo.innerHTML = `
    <div class="detalle-header">
      <h2>#${inc.id_incidencia} — ${inc.titulo}</h2>
      <div class="badges">
        ${obtenerBadge(inc.prioridad, inc.prioridad_color)}
        ${obtenerBadge(inc.impacto, inc.impacto_color)}
        ${obtenerBadgeEstado(inc.estado, inc.estado_color)}
      </div>
    </div>
    <p class="descripcion">${inc.descripcion}</p>
    <div class="meta-grid">
      <div><strong>Área:</strong> ${inc.area}</div>
      <div><strong>Categoría:</strong> ${inc.categoria}</div>
      <div><strong>Reportado por:</strong> ${inc.reporta_nombre} ${inc.reporta_apellido}</div>
      <div><strong>Responsable:</strong> ${inc.asignado_nombre ? `${inc.asignado_nombre} ${inc.asignado_apellido}` : 'Sin asignar'}</div>
      <div><strong>Creada:</strong> ${formatearFecha(inc.fecha_creacion)}</div>
      <div><strong>Resuelta:</strong> ${inc.fecha_resolucion ? formatearFecha(inc.fecha_resolucion) : '—'}</div>
      <div class="sla-fila"><strong>SLA:</strong> ${slaHTML}</div>
    </div>
  `;

  // Solo Encargado/Administrador pueden corregir los datos (el backend lo valida igual).
  if (usuarioActual && usuarioActual.rol !== 'Empleado' && !document.getElementById('btn-editar')) {
    panelInfo.insertAdjacentHTML(
      'beforeend',
      `<div class="editar-caja">
        <button type="button" id="btn-editar" class="btn-editar">✏️ Editar datos de la incidencia</button>
        <p class="editar-nota">Corrige título, descripción, área, categoría, prioridad o impacto. Queda registrado en el historial.</p>
      </div>`
    );
    document.getElementById('btn-editar').addEventListener('click', abrirModalEditar);
  }

  if (!document.getElementById('btn-diagnostico-ia')) {
    panelInfo.insertAdjacentHTML(
      'beforeend',
      `<div class="diagnostico-caja">
        <button type="button" id="btn-diagnostico-ia" class="btn-ia">🤖 Generar diagnóstico con IA</button>
        <div id="diagnostico-ia" class="diagnostico-ia" hidden></div>
      </div>`
    );
    document.getElementById('btn-diagnostico-ia').addEventListener('click', generarDiagnosticoIA);
  }
}

function escaparHTML(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatearDiagnostico(texto) {
  const lineas = escaparHTML(texto)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let html = '';
  let enLista = false;

  lineas.forEach((linea) => {
    const esItem = /^[-•*]\s/.test(linea) || /^\d+[.)]\s/.test(linea);
    if (esItem && !enLista) { html += '<ul>'; enLista = true; }
    if (!esItem && enLista) { html += '</ul>'; enLista = false; }
    if (esItem) {
      html += `<li>${linea.replace(/^[-•*]\s*|\d+[.)]\s*/, '')}</li>`;
    } else {
      html += `<p>${linea.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
    }
  });
  if (enLista) html += '</ul>';

  return html;
}

async function generarDiagnosticoIA() {
  const btn = document.getElementById('btn-diagnostico-ia');
  const caja = document.getElementById('diagnostico-ia');
  if (!btn || !caja) return;

  btn.disabled = true;
  btn.textContent = '🤖 Analizando…';
  caja.hidden = false;
  caja.innerHTML = '<p style="color:var(--ink-muted)">Analizando la incidencia con IA…</p>';

  try {
    const { diagnostico } = await window.api.generarDiagnostico(idIncidencia);
    caja.innerHTML = `<h3>🤖 Diagnóstico sugerido por IA</h3>${formatearDiagnostico(diagnostico)}`;
  } catch (err) {
    caja.innerHTML = `<p style="color:var(--danger)">${escaparHTML(err.message || 'No se pudo generar el diagnóstico.')}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Generar diagnóstico con IA';
  }
}

function renderHistorial(historial) {
  if (!historial.length) {
    listaHistorial.innerHTML = '<li class="vacio">Sin cambios registrados todavía.</li>';
    return;
  }
  listaHistorial.innerHTML = historial
    .map(
      (h) => `
      <li>
        <strong>${h.nombre} ${h.apellido}</strong> cambió <em>${h.campo_modificado}</em>
        de "${h.valor_anterior}" a "${h.valor_nuevo}"
        <div class="fecha-pequena">${formatearFecha(h.fecha)}</div>
      </li>
    `
    )
    .join('');
}

function renderComentarios(comentarios) {
  if (!comentarios.length) {
    listaComentarios.innerHTML = '<li class="vacio">Todavía no hay comentarios.</li>';
    return;
  }
  listaComentarios.innerHTML = comentarios
    .map((c) => {
      const puedeBorrar =
        usuarioActual && (usuarioActual.rol !== 'Empleado' || usuarioActual.id_usuario === c.id_usuario);
      return `
      <li>
        <div class="comentario-cabecera">
          <strong>${c.nombre} ${c.apellido}</strong>
          <div class="fecha-pequena">${formatearFecha(c.fecha)}</div>
          ${puedeBorrar ? `<button type="button" class="btn-eliminar-chico" data-id-comentario="${c.id_comentario}" title="Eliminar comentario">🗑️</button>` : ''}
        </div>
        <p>${c.comentario}</p>
      </li>
    `;
    })
    .join('');
}

async function cargarTodo(usuario) {
  let data;
  try {
    data = await window.api.getIncidenciaDetalle(idIncidencia);
  } catch (err) {
    panelInfo.innerHTML = `<p>No tienes permiso para ver esta incidencia.</p>`;
    document.getElementById('panel-gestion').style.display = 'none';
    return;
  }

  if (!data) {
    panelInfo.innerHTML = '<p>No se encontró esta incidencia.</p>';
    return;
  }

  incidenciaActual = data.incidencia;
  renderInfo(data.incidencia);
  renderHistorial(data.historial);
  renderComentarios(data.comentarios);

  // Un Empleado solo consulta: no puede asignar responsable ni eliminar
  if (usuario.rol === 'Empleado') {
    document.getElementById('panel-gestion').style.display = 'none';
    document.getElementById('panel-peligro').style.display = 'none';
    return;
  }

  selectResponsable.innerHTML =
    '<option value="">-- Selecciona --</option>' +
    data.usuariosParaAsignar
      .map((u) => `<option value="${u.id_usuario}">${u.nombre} ${u.apellido}</option>`)
      .join('');
}

document.getElementById('btn-asignar').addEventListener('click', async () => {
  if (!selectResponsable.value) return;
  await window.api.asignarResponsable({
    id_incidencia: idIncidencia,
    id_usuario_asignado: selectResponsable.value
  });
  await cargarTodo(usuarioActual);
  mostrarToast('Responsable asignado', 'success');
});

formComentario.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = document.getElementById('nuevo-comentario').value;
  await window.api.agregarComentario({ id_incidencia: idIncidencia, comentario: texto });
  formComentario.reset();
  await cargarTodo(usuarioActual);
  mostrarToast('Comentario agregado', 'success');
});

// Eliminación de un comentario (delegación de eventos)
listaComentarios.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-eliminar-chico');
  if (!btn) return;

  const idComentario = btn.dataset.idComentario;
  if (!confirm('¿Eliminar este comentario? Esta acción no se puede deshacer.')) return;

  try {
    await window.api.eliminarComentario({ id_incidencia: idIncidencia, id_comentario: idComentario });
    await cargarTodo(usuarioActual);
    mostrarToast('Comentario eliminado', 'success');
  } catch (err) {
    mostrarToast(err.message || 'No se pudo eliminar el comentario', 'error');
  }
});

// Eliminación completa de la incidencia
document.getElementById('btn-eliminar-incidencia').addEventListener('click', async () => {
  if (!confirm('¿Eliminar esta incidencia junto con su historial y comentarios? Esta acción no se puede deshacer.')) return;

  try {
    await window.api.eliminarIncidencia(idIncidencia);
    mostrarToast('Incidencia eliminada', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 900);
  } catch (err) {
    mostrarToast(err.message || 'No se pudo eliminar la incidencia', 'error');
  }
});

let usuarioActual = null;

// ---------------------------------------------------------------------
// Modal de edición: corrige los datos descriptivos de la incidencia
// ---------------------------------------------------------------------

function llenarSelect(select, items, campoId, campoNombre, seleccionado) {
  select.innerHTML = items
    .map((item) => `<option value="${item[campoId]}" ${String(item[campoId]) === String(seleccionado) ? 'selected' : ''}>${item[campoNombre]}</option>`)
    .join('');
}

function cerrarModalEditar() {
  if (modalEditar) modalEditar.hidden = true;
}

async function abrirModalEditar() {
  if (!incidenciaActual) return;

  if (!catalogosEditar) {
    const c = await window.api.getCatalogos();
    catalogosEditar = { areas: c.areas, categorias: c.categorias, prioridades: c.prioridades, impactos: c.impactos };
  }

  const inc = incidenciaActual;
  document.getElementById('edit-titulo').value = inc.titulo || '';
  document.getElementById('edit-descripcion').value = inc.descripcion || '';
  llenarSelect(document.getElementById('edit-area'), catalogosEditar.areas, 'id_area', 'nombre', inc.id_area);
  llenarSelect(document.getElementById('edit-categoria'), catalogosEditar.categorias, 'id_categoria', 'nombre', inc.id_categoria);
  llenarSelect(document.getElementById('edit-prioridad'), catalogosEditar.prioridades, 'id_prioridad', 'nombre', inc.id_prioridad);
  llenarSelect(document.getElementById('edit-impacto'), catalogosEditar.impactos, 'id_impacto', 'nombre', inc.id_impacto);

  modalEditar.hidden = false;
}

formEditar.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!incidenciaActual) return;

  const btn = formEditar.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const res = await window.api.editarIncidencia({
      id_incidencia: idIncidencia,
      titulo: document.getElementById('edit-titulo').value,
      descripcion: document.getElementById('edit-descripcion').value,
      id_area: document.getElementById('edit-area').value,
      id_categoria: document.getElementById('edit-categoria').value,
      id_prioridad: document.getElementById('edit-prioridad').value,
      id_impacto: document.getElementById('edit-impacto').value
    });

    cerrarModalEditar();
    mostrarToast(res.mensaje, res.cambios > 0 ? 'success' : 'info');

    if (res.cambios > 0) await cargarTodo(usuarioActual);
  } catch (err) {
    mostrarToast(err.message || 'No se pudo guardar la edición', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
});

// Cerrar el modal con los botones ✕ / Cancelar o clic fuera del cuadro.
document.querySelectorAll('[data-cerrar-modal]').forEach((b) =>
  b.addEventListener('click', cerrarModalEditar)
);
modalEditar.addEventListener('click', (e) => {
  if (e.target === modalEditar) cerrarModalEditar();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModalEditar();
});

protegerSesionYMostrarUsuario().then((usuario) => {
  usuarioActual = usuario;
  if (usuario) cargarTodo(usuario);
});
