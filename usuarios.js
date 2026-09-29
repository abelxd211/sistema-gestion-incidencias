// usuarios.js
// Página de gestión de usuarios (solo Administrador).
// Permite crear, editar y activar/desactivar cuentas sin tocar código ni la BD a mano.

let usuarios = [];
let roles = [];
let areas = [];
let usuarioSesion = null;
let editandoId = null;

const tbody = document.getElementById('tbody-usuarios');
const filtroBusqueda = document.getElementById('filtro-usuarios');
const filtroRol = document.getElementById('filtro-rol');
const filtroEstado = document.getElementById('filtro-estado');
const contador = document.getElementById('contador-usuarios');
const modal = document.getElementById('modal-usuario');
const formUsuario = document.getElementById('form-usuario');

async function protegerSesionYMostrarUsuario() {
  const usuario = await window.api.getCurrentUser();
  if (!usuario) {
    window.location.href = 'login.html';
    return null;
  }

  document.getElementById('usuario-actual').textContent =
    `${usuario.nombre} ${usuario.apellido} (${usuario.rol})`;

  // Esta página es exclusiva del Administrador.
  if (usuario.rol !== 'Administrador') {
    document.querySelector('main').innerHTML =
      '<p>No tienes permiso para ver esta sección. <a href="dashboard.html">Volver al dashboard</a>.</p>';
    document.querySelectorAll('.link-nav').forEach((l) => (l.style.display = 'none'));
    return null;
  }

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await window.api.logout();
    window.location.href = 'login.html';
  });

  return usuario;
}

const COLOR_ROL = {
  'Administrador': '#4f46e5',
  'Encargado': '#0ea5e9',
  'Empleado': '#64748b'
};

function aplicarFiltros() {
  const q = filtroBusqueda.value.trim().toLowerCase();
  const rol = filtroRol.value;
  const estado = filtroEstado.value;

  const visibles = usuarios.filter((u) => {
    if (rol && u.rol !== rol) return false;
    if (estado === 'activos' && !u.activo) return false;
    if (estado === 'inactivos' && u.activo) return false;
    if (q) {
      const campos = [u.nombre, u.apellido, u.email, u.area];
      if (!campos.some((v) => String(v || '').toLowerCase().includes(q))) return false;
    }
    return true;
  });

  renderTabla(visibles);
}

function renderTabla(lista) {
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="vacio">Sin resultados con los filtros actuales.</td></tr>';
    contador.textContent = '0 usuarios';
    return;
  }

  tbody.innerHTML = lista
    .map((u) => {
      const estadoBadge = u.activo
        ? obtenerBadge('Activo', '#10b981')
        : obtenerBadge('Inactivo', '#94a3b8');
      const esYo = usuarioSesion && u.id_usuario === usuarioSesion.id_usuario;

      return `
      <tr>
        <td>${u.nombre} ${u.apellido}${esYo ? ' <span class="sla-detalle">(tú)</span>' : ''}</td>
        <td>${u.email}</td>
        <td>${obtenerBadge(u.rol, COLOR_ROL[u.rol] || '#64748b')}</td>
        <td>${u.area || '—'}</td>
        <td>${estadoBadge}</td>
        <td class="acciones-celda">
          <button type="button" class="btn-eliminar-chico" data-password="${u.id_usuario}" title="Cambiar contraseña">🔑</button>
          <button type="button" class="btn-eliminar-chico" data-editar="${u.id_usuario}" title="Editar usuario">✏️</button>
          <button type="button" class="btn-eliminar-chico" data-alternar="${u.id_usuario}" data-activo="${u.activo ? 1 : 0}"
            title="${u.activo ? 'Desactivar' : 'Activar'}" ${esYo ? 'disabled' : ''}>${u.activo ? '🚫' : '✅'}</button>
        </td>
      </tr>`;
    })
    .join('');

  contador.textContent = `${lista.length} ${pluralizar(lista.length, 'usuario', 'usuarios')}`;

  tbody.querySelectorAll('[data-password]').forEach((b) =>
    b.addEventListener('click', () => abrirModalPassword(Number(b.dataset.password)))
  );
  tbody.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => abrirModalEditar(Number(b.dataset.editar)))
  );
  tbody.querySelectorAll('[data-alternar]').forEach((b) =>
    b.addEventListener('click', () => alternarActivo(Number(b.dataset.alternar), b.dataset.activo === '1'))
  );
}

// Llena un <select> de catálogo. El campo id es distinto en cada catálogo
// (id_rol en roles, id_area en áreas...), así que se recibe como parámetro.
function llenarSelectCatalogo(select, items, campoId, seleccionado) {
  if (!items || !items.length) {
    select.innerHTML = '<option value="">— sin opciones —</option>';
    return;
  }
  select.innerHTML = items
    .map((i) => {
      const valor = i[campoId];
      const marcado = String(valor) === String(seleccionado) ? ' selected' : '';
      return `<option value="${valor}"${marcado}>${i.nombre}</option>`;
    })
    .join('');
}

function cerrarModal() {
  modal.hidden = true;
  editandoId = null;
  formUsuario.reset();
  document.getElementById('wrap-password').style.display = '';
  actualizarAreaSegunRol();
}

// El área solo se elige para Empleados. Para Encargado/Administrador se autocompleta
// con "Tecnología / TI" (el backend lo vuelve a resolver, esto solo es la vista).
function actualizarAreaSegunRol() {
  const rol = document.getElementById('u-rol').value;
  const nombreRol = roles.find((r) => String(r.id_rol) === String(rol))?.nombre;
  const selectArea = document.getElementById('u-area');
  const notaArea = document.getElementById('nota-area');
  const esEmpleado = nombreRol === 'Empleado';

  selectArea.disabled = !esEmpleado;
  selectArea.required = esEmpleado;

  if (!esEmpleado) {
    const areaTI = areas.find((a) => a.nombre === 'Tecnología / TI');
    if (areaTI) selectArea.value = areaTI.id_area;
    notaArea.textContent = 'Asignada automáticamente: Encargados y Administradores pertenecen a Tecnología / TI.';
  } else {
    notaArea.textContent = 'El empleado solo podrá registrar incidencias de esta área.';
  }
}

function abrirModalNuevo() {
  editandoId = null;
  document.getElementById('modal-titulo').textContent = '➕ Nuevo usuario';
  document.getElementById('wrap-password').style.display = '';
  document.getElementById('u-password').required = true;

  formUsuario.reset();
  llenarSelectCatalogo(
    document.getElementById('u-rol'),
    roles,
    'id_rol',
    roles.find((r) => r.nombre === 'Empleado')?.id_rol
  );
  llenarSelectCatalogo(document.getElementById('u-area'), areas, 'id_area', areas[0]?.id_area);
  actualizarAreaSegunRol();
  modal.hidden = false;
}

function abrirModalEditar(id) {
  const u = usuarios.find((x) => x.id_usuario === id);
  if (!u) return;

  editandoId = id;
  document.getElementById('modal-titulo').textContent = `✏️ Editar: ${u.nombre} ${u.apellido}`;
  // Al editar no se toca la contraseña.
  document.getElementById('wrap-password').style.display = 'none';
  document.getElementById('u-password').required = false;

  document.getElementById('u-nombre').value = u.nombre;
  document.getElementById('u-apellido').value = u.apellido;
  document.getElementById('u-email').value = u.email;
  llenarSelectCatalogo(document.getElementById('u-rol'), roles, 'id_rol', u.id_rol);
  llenarSelectCatalogo(document.getElementById('u-area'), areas, 'id_area', u.id_area);
  actualizarAreaSegunRol();

  modal.hidden = false;
}

async function alternarActivo(id, activoActual) {
  const u = usuarios.find((x) => x.id_usuario === id);
  if (!u) return;

  const accion = activoActual ? 'desactivar' : 'activar';
  const aviso =
    activoActual
      ? `¿Desactivar a ${u.nombre} ${u.apellido}?\n\nNo podrá entrar al sistema, pero su historial se conserva.`
      : `¿Activar de nuevo a ${u.nombre} ${u.apellido}?`;

  if (!confirm(aviso)) return;

  try {
    await window.api.alternarUsuarioActivo({ id_usuario: id, activo: !activoActual });
    mostrarToast(`Usuario ${accion}ado`, 'success');
    await cargarUsuarios();
  } catch (err) {
    mostrarToast(err.message || 'No se pudo cambiar el estado', 'error');
  }
}

formUsuario.addEventListener('submit', async (e) => {
  e.preventDefault();

  const datos = {
    nombre: document.getElementById('u-nombre').value,
    apellido: document.getElementById('u-apellido').value,
    email: document.getElementById('u-email').value,
    id_rol: document.getElementById('u-rol').value,
    id_area: document.getElementById('u-area').value
  };

  const btn = document.getElementById('btn-guardar-usuario');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    if (editandoId) {
      await window.api.editarUsuario({ id_usuario: editandoId, ...datos });
      mostrarToast('Usuario actualizado', 'success');
    } else {
      datos.password = document.getElementById('u-password').value;
      await window.api.crearUsuario(datos);
      mostrarToast('Usuario creado correctamente', 'success');
    }
    cerrarModal();
    await cargarUsuarios();
  } catch (err) {
    mostrarToast(err.message || 'No se pudo guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
});

document.querySelectorAll('[data-cerrar-modal]').forEach((b) =>
  b.addEventListener('click', cerrarModal)
);
modal.addEventListener('click', (e) => {
  if (e.target === modal) cerrarModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!modalPassword.hidden) cerrarModalPassword();
  else cerrarModal();
});

document.getElementById('btn-nuevo-usuario').addEventListener('click', abrirModalNuevo);
document.getElementById('u-rol').addEventListener('change', actualizarAreaSegunRol);
filtroBusqueda.addEventListener('input', aplicarFiltros);
filtroRol.addEventListener('change', aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);

async function cargarUsuarios() {
  usuarios = await window.api.getUsuarios();
  aplicarFiltros();
}

protegerSesionYMostrarUsuario().then(async (usuario) => {
  usuarioSesion = usuario;
  if (!usuario) return;

  try {
    const catalogo = await window.api.getCatalogos();
    roles = catalogo.roles || [];
    areas = catalogo.areas || [];

    filtroRol.innerHTML =
      '<option value="">Todos los roles</option>' +
      roles.map((r) => `<option value="${r.nombre}">${r.nombre}</option>`).join('');

    await cargarUsuarios();
  } catch (err) {
    mostrarToast(err.message || 'No pudieron cargar los datos', 'error');
  }
});

// ---------------------------------------------------------------------
// CAMBIO DE CONTRASEÑA (solo Administrador)
// El backend también valida el permiso: exigirAdministrador().
// ---------------------------------------------------------------------
const modalPassword = document.getElementById('modal-password');
const formPassword = document.getElementById('form-password');
let passwordUsuarioId = null;

function cerrarModalPassword() {
  modalPassword.hidden = true;
  passwordUsuarioId = null;
  formPassword.reset();
}

function abrirModalPassword(id) {
  const u = usuarios.find((x) => x.id_usuario === id);
  if (!u) return;

  passwordUsuarioId = id;
  document.getElementById('modal-password-titulo').textContent =
    `🔑 Contraseña de ${u.nombre} ${u.apellido}`;

  formPassword.reset();
  modalPassword.hidden = false;
  document.getElementById('p-password').focus();
}

formPassword.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nueva = document.getElementById('p-password').value;
  const repetir = document.getElementById('p-password2').value;

  if (nueva.length < 6) {
    mostrarToast('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (nueva !== repetir) {
    mostrarToast('Las dos contraseñas no coinciden.', 'error');
    return;
  }

  const btn = document.getElementById('btn-guardar-password');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    await window.api.cambiarPasswordUsuario({ id_usuario: passwordUsuarioId, password: nueva });
    mostrarToast('Contraseña actualizada', 'success');
    cerrarModalPassword();
  } catch (err) {
    mostrarToast(err.message || 'No se pudo cambiar la contraseña', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cambiar contraseña';
  }
});

document.querySelectorAll('[data-cerrar-modal-password]').forEach((b) =>
  b.addEventListener('click', cerrarModalPassword)
);
modalPassword.addEventListener('click', (e) => {
  if (e.target === modalPassword) cerrarModalPassword();
});
