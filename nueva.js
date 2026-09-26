// nueva.js
// Página dedicada al registro de incidencias (sección propia en la barra lateral).

const selectArea = document.getElementById('id_area');
const selectCategoria = document.getElementById('id_categoria');
const selectPrioridad = document.getElementById('id_prioridad');
const selectImpacto = document.getElementById('id_impacto');
const selectResponsable = document.getElementById('id_usuario_asignado');
const form = document.getElementById('form-incidencia');

const tituloEl = document.getElementById('titulo');
const descripcionEl = document.getElementById('descripcion');
const avisoDuplicados = document.getElementById('aviso-duplicados');
const btnSugerirIA = document.getElementById('btn-sugerir-ia');

// --- Aviso de posibles duplicados (no bloqueante) ---
let temporizadorDuplicados = null;

descripcionEl.addEventListener('input', () => {
  clearTimeout(temporizadorDuplicados);
  temporizadorDuplicados = setTimeout(verificarDuplicados, 900);
});

async function verificarDuplicados() {
  const desc = descripcionEl.value.trim();
  if (desc.length < 10) {
    avisoDuplicados.hidden = true;
    return;
  }

  try {
    const dups = await window.api.buscarDuplicados({
      titulo: tituloEl.value.trim(),
      descripcion: desc
    });

    if (dups.length) {
      avisoDuplicados.innerHTML =
        `<div class="ad-titulo">⚠️ Posibles incidencias duplicadas</div>
         <ul>${dups
           .map(
             (d) =>
               `<li><a href="detalle.html?id=${d.id_incidencia}">#${d.id_incidencia} — ${d.titulo}</a> <span style="opacity:.75">(${d.estado})</span></li>`
           )
           .join('')}</ul>
         <div style="margin-top:6px;opacity:.85">Revisa antes de registrar si alguna coincide con lo que quieres reportar.</div>`;
      avisoDuplicados.hidden = false;
    } else {
      avisoDuplicados.hidden = true;
    }
  } catch (err) {
    /* silencioso: si falla la búsqueda no bloqueamos el registro */
  }
}

// --- Sugerencia de categoría y prioridad con IA ---
btnSugerirIA.addEventListener('click', async () => {
  const desc = descripcionEl.value.trim();
  if (desc.length < 10) {
    mostrarToast('Escribe una descripción primero', 'error');
    return;
  }

  btnSugerirIA.disabled = true;
  btnSugerirIA.textContent = '✨ Analizando…';

  try {
    const s = await window.api.sugerirClasificacion({
      titulo: tituloEl.value.trim(),
      descripcion: desc
    });

    const aplicadas = [];
    if (s.categoria) {
      selectCategoria.value = s.categoria.id;
      aplicadas.push('categoría');
    }
    if (s.prioridad) {
      selectPrioridad.value = s.prioridad.id;
      aplicadas.push('prioridad');
    }

    if (aplicadas.length) {
      mostrarToast(`IA: ${aplicadas.join(' y ')} sugerida(s) — revisa que sea correcta`, 'success');
    } else {
      mostrarToast('La IA no encontró una coincidencia clara; sigue manual.', 'error');
    }
  } catch (err) {
    mostrarToast(err.message || 'No se pudo usar la IA', 'error');
  } finally {
    btnSugerirIA.disabled = false;
    btnSugerirIA.textContent = '✨ Sugerir categoría y prioridad con IA';
  }
});

// --- Protección de sesión ---
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

function llenarSelect(select, items, valueField, textField) {
  select.innerHTML = items
    .map((item) => `<option value="${item[valueField]}">${item[textField]}</option>`)
    .join('');
}

async function cargarCatalogos(usuario) {
  const { areas, categorias, prioridades, impactos, responsables } = await window.api.getCatalogos();
  llenarSelect(selectArea, areas, 'id_area', 'nombre');
  llenarSelect(selectCategoria, categorias, 'id_categoria', 'nombre');
  llenarSelect(selectPrioridad, prioridades, 'id_prioridad', 'nombre');
  llenarSelect(selectImpacto, impactos, 'id_impacto', 'nombre');

  // El encargado responsable es obligatorio. Solo Encargados/Administradores activos.
  selectResponsable.innerHTML = responsables && responsables.length
    ? '<option value="">Selecciona un encargado…</option>' +
      responsables
        .map((r) => `<option value="${r.id_usuario}">${r.nombre} (${r.rol})</option>`)
        .join('')
    : '<option value="">— No hay encargados disponibles —</option>';

  // Un Empleado solo reporta en su propia área: se preselecciona y se bloquea.
  // El backend también lo valida, esto es solo la ayuda visual.
  if (usuario && usuario.rol === 'Empleado') {
    if (usuario.id_area) {
      selectArea.value = usuario.id_area;
    }
    selectArea.disabled = true;
    const nota = document.createElement('span');
    nota.className = 'sla-detalle';
    nota.textContent = `Registras en el área ${usuario.area || 'asignada a tu usuario'}.`;
    selectArea.parentElement.appendChild(nota);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = {
    titulo: tituloEl.value,
    descripcion: descripcionEl.value,
    id_area: selectArea.value,
    id_categoria: selectCategoria.value,
    id_prioridad: selectPrioridad.value,
    id_impacto: selectImpacto.value,
    id_usuario_asignado: selectResponsable.value
  };

  if (!data.id_usuario_asignado) {
    mostrarToast('Debes asignar un encargado responsable.', 'error');
    selectResponsable.focus();
    return;
  }

  try {
    await window.api.crearIncidencia(data);
    mostrarToast('Incidencia registrada correctamente', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 900);
  } catch (err) {
    mostrarToast('No se pudo registrar la incidencia: ' + err.message, 'error');
  }
});

protegerSesionYMostrarUsuario().then((usuario) => {
  if (usuario) cargarCatalogos(usuario);
});