// renderer.js
// Dashboard: lista de incidencias con búsqueda, filtros, ordenamiento y exportación.
// El registro de incidencias vive ahora en su propia página (nueva.html / nueva.js).

let todasIncidencias = [];
let filasVisibles = [];

let ordenColumna = 'fecha';
let ordenDireccion = 'desc';

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

const tbody = document.getElementById('tbody-incidencias');

const filtroBusqueda = document.getElementById('filtro-busqueda');
const filtroEstado = document.getElementById('filtro-estado');
const filtroPrioridad = document.getElementById('filtro-prioridad');
const filtroImpacto = document.getElementById('filtro-impacto');
const filtroArea = document.getElementById('filtro-area');
const contadorResultados = document.getElementById('contador-resultados');

function llenarFiltro(select, items, valueField, textField) {
  select.innerHTML =
    '<option value="">Todos</option>' +
    items
      .map((item) => `<option value="${item[valueField]}">${item[textField]}</option>`)
      .join('');
}

async function cargarCatalogos() {
  const { areas, categorias, prioridades, impactos, estados } = await window.api.getCatalogos();
  llenarFiltro(filtroEstado, estados, 'nombre', 'nombre');
  llenarFiltro(filtroPrioridad, prioridades, 'nombre', 'nombre');
  llenarFiltro(filtroImpacto, impactos, 'nombre', 'nombre');
  llenarFiltro(filtroArea, areas, 'nombre', 'nombre');
}

function obtenerValor(inc, col) {
  switch (col) {
    case 'id': return inc.id_incidencia;
    case 'titulo': return inc.titulo;
    case 'area': return inc.area;
    case 'categoria': return inc.categoria;
    case 'prioridad': return inc.prioridad;
    case 'impacto': return inc.impacto;
    case 'estado': return inc.estado;
    case 'fecha': return new Date(inc.fecha_creacion);
    default: return '';
  }
}

function compararFilas(a, b) {
  const va = obtenerValor(a, ordenColumna);
  const vb = obtenerValor(b, ordenColumna);
  let resultado;

  if (ordenColumna === 'id' || ordenColumna === 'fecha') {
    resultado = va < vb ? -1 : va > vb ? 1 : 0;
  } else {
    resultado = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
  }

  return ordenDireccion === 'asc' ? resultado : -resultado;
}

function aplicarFiltros() {
  const q = filtroBusqueda.value.trim().toLowerCase();
  const e = filtroEstado.value;
  const p = filtroPrioridad.value;
  const im = filtroImpacto.value;
  const a = filtroArea.value;

  filasVisibles = todasIncidencias.filter((inc) => {
    if (e && inc.estado !== e) return false;
    if (p && inc.prioridad !== p) return false;
    if (im && inc.impacto !== im) return false;
    if (a && inc.area !== a) return false;
    if (q) {
      const campos = [inc.titulo, inc.descripcion, inc.area, inc.categoria, inc.estado, inc.prioridad, inc.impacto];
      const coincide = campos.some((v) => String(v || '').toLowerCase().includes(q));
      if (!coincide) return false;
    }
    return true;
  });

  filasVisibles.sort(compararFilas);
  renderTabla(filasVisibles);
}

function renderTabla(incidencias) {
  if (!incidencias.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="vacio">Sin resultados con los filtros actuales.</td></tr>';
    contadorResultados.textContent = '0 incidencias';
    actualizarBannerSLA();
    return;
  }

  tbody.innerHTML = incidencias
    .map(
      (inc) => `
      <tr class="fila-clicable" data-id="${inc.id_incidencia}">
        <td>${inc.id_incidencia}</td>
        <td>${inc.titulo}</td>
        <td>${inc.area}</td>
        <td>${inc.categoria}</td>
        <td>${obtenerBadge(inc.prioridad, inc.prioridad_color)}</td>
        <td>${obtenerBadge(inc.impacto, inc.impacto_color)}</td>
        <td>${obtenerBadgeEstado(inc.estado, inc.estado_color)}</td>
        <td>${badgeSLA(inc)}</td>
        <td>${formatearFecha(inc.fecha_creacion)}</td>
      </tr>
    `
    )
    .join('');

  contadorResultados.textContent = `${incidencias.length} ${pluralizar(incidencias.length, 'incidencia', 'incidencias')}`;
  actualizarBannerSLA();

  document.querySelectorAll('.fila-clicable').forEach((fila) => {
    fila.addEventListener('click', () => {
      window.location.href = `detalle.html?id=${fila.dataset.id}`;
    });
  });
}

// Banner de alerta: incidencias abiertas que ya superaron su plazo SLA.
function actualizarBannerSLA() {
  const banner = document.getElementById('banner-sla');
  if (!banner) return;
  const vencidas = contarSLAVencidas(filasVisibles);
  if (vencidas > 0) {
    banner.hidden = false;
    banner.textContent = `⚠️ ${vencidas} ${pluralizar(vencidas, 'incidencia vencida', 'incidencias vencidas')} por SLA — requieren atención urgente.`;
  } else {
    banner.hidden = true;
  }
}

async function cargarIncidencias() {
  todasIncidencias = await window.api.getIncidencias();
  aplicarFiltros();
}

// ---------------------------------------------------------------------
// Ordenamiento por columnas
// ---------------------------------------------------------------------

document.querySelectorAll('#tabla-incidencias th[data-col]').forEach((th) => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;

    if (ordenColumna === col) {
      ordenDireccion = ordenDireccion === 'asc' ? 'desc' : 'asc';
    } else {
      ordenColumna = col;
      ordenDireccion = col === 'fecha' ? 'desc' : 'asc';
    }

    document.querySelectorAll('#tabla-incidencias th').forEach((t) => {
      t.classList.remove('sort-asc', 'sort-desc');
    });
    th.classList.add(ordenDireccion === 'asc' ? 'sort-asc' : 'sort-desc');

    aplicarFiltros();
  });
});

// ---------------------------------------------------------------------
// Búsqueda y filtros
// ---------------------------------------------------------------------

filtroBusqueda.addEventListener('input', aplicarFiltros);
[filtroEstado, filtroPrioridad, filtroImpacto, filtroArea].forEach((sel) => {
  sel.addEventListener('change', aplicarFiltros);
});

// ---------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------

function filasExportables() {
  return filasVisibles.map((inc) => ({
    id: inc.id_incidencia,
    titulo: inc.titulo,
    area: inc.area,
    categoria: inc.categoria,
    prioridad: inc.prioridad,
    impacto: inc.impacto,
    estado: inc.estado,
    fecha: formatearFecha(inc.fecha_creacion)
  }));
}

function exportarCSV() {
  if (!filasVisibles.length) return mostrarToast('No hay datos para exportar', 'error');

  const cabecera = ['#', 'Titulo', 'Area', 'Categoria', 'Prioridad', 'Impacto', 'Estado', 'Fecha'];
  const filas = filasExportables();

  const texto =
    [cabecera, ...filas.map((f) => [f.id, f.titulo, f.area, f.categoria, f.prioridad, f.impacto, f.estado, f.fecha])]
      .map((fila) =>
        fila
          .map((celda) => {
            const s = String(celda ?? '').replace(/"/g, '""');
            return /[";,\n]/.test(s) ? `"${s}"` : s;
          })
          .join(';')
      )
      .join('\r\n');

  descargarArchivo('incidencias.csv', '\uFEFF' + texto, 'text/csv;charset=utf-8');
  mostrarToast('CSV exportado', 'success');
}

function exportarExcel() {
  if (!filasVisibles.length) return mostrarToast('No hay datos para exportar', 'error');

  const filas = filasExportables().map(
    (f) => `
      <tr>
        <td>${f.id}</td><td>${f.titulo}</td><td>${f.area}</td><td>${f.categoria}</td>
        <td>${f.prioridad}</td><td>${f.impacto}</td><td>${f.estado}</td><td>${f.fecha}</td>
      </tr>`
  );

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head>
      <meta charset="UTF-8" />
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
        <x:Name>Incidencias</x:Name><x:WorksheetOptions></x:WorksheetOptions>
      </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head>
    <body>
      <table border="1">
        <thead><tr>
          <th>#</th><th>Titulo</th><th>Area</th><th>Categoria</th>
          <th>Prioridad</th><th>Impacto</th><th>Estado</th><th>Fecha</th>
        </tr></thead>
        <tbody>${filas.join('')}</tbody>
      </table>
    </body></html>`;

  descargarArchivo('incidencias.xls', html, 'application/vnd.ms-excel');
  mostrarToast('Excel exportado', 'success');
}

function abrirImpresion() {
  if (!filasVisibles.length) return mostrarToast('No hay datos para imprimir', 'error');

  const filas = filasExportables().map(
    (f) => `
      <tr>
        <td>${f.id}</td><td>${f.titulo}</td><td>${f.area}</td><td>${f.categoria}</td>
        <td>${f.prioridad}</td><td>${f.impacto}</td><td>${f.estado}</td><td>${f.fecha}</td>
      </tr>`
  );

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte de Incidencias</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 32px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 12px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; text-transform: uppercase; font-size: 10.5px; letter-spacing: .05em; }
    .firma { margin-top: 24px; font-size: 11px; color: #94a3b8; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>Reporte de Incidencias</h1>
  <div class="sub">Generado el ${new Date().toLocaleString('es-DO')}</div>
  <table>
    <thead><tr>
      <th>#</th><th>Titulo</th><th>Area</th><th>Categoria</th>
      <th>Prioridad</th><th>Impacto</th><th>Estado</th><th>Fecha</th>
    </tr></thead>
    <tbody>${filas.join('')}</tbody>
  </table>
  <div class="firma">Sistema de Gestión de Incidencias</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  } else {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 350);
  }
}

document.getElementById('btn-csv').addEventListener('click', exportarCSV);
document.getElementById('btn-excel').addEventListener('click', exportarExcel);
document.getElementById('btn-pdf').addEventListener('click', abrirImpresion);
document.getElementById('btn-imprimir').addEventListener('click', abrirImpresion);

// Carga inicial al abrir la app: primero confirma sesión, luego carga los datos
protegerSesionYMostrarUsuario().then((usuario) => {
  if (usuario) {
    cargarCatalogos();
    cargarIncidencias();
  }
});