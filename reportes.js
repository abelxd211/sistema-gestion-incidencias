// reportes.js

let datosReporte = null;

// Color según qué tan bueno es el cumplimiento: verde >=80, ámbar >=50, rojo <50.
function colorCumplimiento(pct) {
  if (pct >= 80) return '#10b981';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function badgeCumplimiento(pct) {
  if (pct === null || pct === undefined) return obtenerBadge('Sin datos', '#94a3b8');
  const texto = `${pct}%`;
  const color = colorCumplimiento(pct);
  return obtenerBadge(texto, color);
}

// Fila con barra de progreso del % de cumplimiento.
function filaCumplimiento(nombre, total, aTiempo, pct, promedioHoras) {
  const barra = `<div class="barra-track" style="width:110px; display:inline-block; vertical-align:middle;">
      <div class="barra-fill" style="width:${pct}%; background:${colorCumplimiento(pct)}"></div>
    </div>`;
  const prom = promedioHoras === null || promedioHoras === undefined ? '—' : formatoDuracionSLA(promedioHoras);
  return `
    <tr>
      <td><strong>${nombre}</strong></td>
      <td>${aTiempo} de ${total}</td>
      <td class="sla-cumplimiento-celda">${barra} ${badgeCumplimiento(pct)}</td>
      <td>${prom}</td>
    </tr>`;
}

function renderCumplimientoSla(sla) {
  if (!sla) return;

  // Tarjetas de resumen
  const elCumpl = document.getElementById('sla-cumplimiento');
  if (sla.porcentaje !== null && sla.total > 0) {
    elCumpl.textContent = `${sla.porcentaje}%`;
    elCumpl.style.color = colorCumplimiento(sla.porcentaje);
  } else {
    elCumpl.textContent = 'Sin datos';
    elCumpl.style.color = '';
  }

  const elVencidas = document.getElementById('sla-vencidas');
  elVencidas.textContent = sla.abiertasVencidas;
  elVencidas.style.color = sla.abiertasVencidas > 0 ? '#ef4444' : '#10b981';

  // Resumen narrativo
  const resumen = document.getElementById('sla-resumen');
  if (sla.total === 0) {
    resumen.innerHTML =
      '<p class="vacio">Todavía no hay incidencias resueltas, así que aún no se puede medir el cumplimiento del SLA.</p>';
  } else {
    const fueraDePlazo = sla.total - sla.aTiempo;
    resumen.innerHTML = `
      <div class="sla-chip" style="border-left-color:${colorCumplimiento(sla.porcentaje)}">
        <strong>${sla.aTiempo}</strong> de <strong>${sla.total}</strong> incidencias resueltas
        llegaron dentro del plazo (<strong style="color:${colorCumplimiento(sla.porcentaje)}">${sla.porcentaje}%</strong>).
      </div>
      <div class="sla-chip" style="border-left-color:${fueraDePlazo > 0 ? '#ef4444' : '#10b981'}">
        <strong>${fueraDePlazo}</strong> se resolvieron fuera de plazo.
        ${
          fueraDePlazo > 0
            ? 'Prioriza revisar los compromisos de SLA de las áreas con peor cumplimiento.'
            : 'Ningún incumplimiento registrado.'
        }
      </div>`;
  }

  // Barras por prioridad
  const contPrioridad = document.getElementById('sla-por-prioridad');
  if (!sla.porPrioridad.length) {
    contPrioridad.innerHTML = '';
  } else {
    contPrioridad.innerHTML =
      '<p class="subtexto" style="margin:0 0 8px;">% de cumplimiento por prioridad:</p>' +
      sla.porPrioridad
        .map(
          (p, i) => `
          <div class="barra-fila">
            <span class="barra-etiqueta">${p.prioridad} <span class="sla-detalle">(${p.slaHoras} h)</span></span>
            <div class="barra-track">
              <div class="barra-fill" style="width:${p.porcentaje}%; background:${colorCumplimiento(p.porcentaje)}; transition-delay:${i * 60}ms"></div>
            </div>
            <span class="barra-valor">${p.porcentaje}%</span>
          </div>`
        )
        .join('');
  }

  // Tabla por área
  const tbodyArea = document.getElementById('tbody-sla-area');
  tbodyArea.innerHTML = sla.porArea.length
    ? sla.porArea
        .map((r) => filaCumplimiento(r.area, r.total, r.aTiempo, r.porcentaje, r.promedioHoras))
        .join('')
    : '<tr><td colspan="4" class="vacio">Sin incidencias resueltas por área.</td></tr>';

  // Tabla por responsable
  const tbodyResp = document.getElementById('tbody-sla-responsable');
  tbodyResp.innerHTML = sla.porResponsable.length
    ? sla.porResponsable
        .map((r) => filaCumplimiento(r.responsable, r.total, r.aTiempo, r.porcentaje, r.promedioHoras))
        .join('')
    : '<tr><td colspan="4" class="vacio">Ninguna incidencia resuelta tiene responsable asignado.</td></tr>';

  // Abiertas vencidas
  const tbodyVenc = document.getElementById('tbody-sla-vencidas');
  tbodyVenc.innerHTML = sla.vencidasDetalle.length
    ? sla.vencidasDetalle
        .map(
          (v) => `
          <tr>
            <td>${v.area}</td>
            <td>${obtenerBadge(v.prioridad, '#ef4444')}</td>
            <td>${v.slaHoras} h</td>
            <td><strong>${v.cantidad}</strong></td>
            <td>${formatoDuracionSLA(v.retrasoPromedioHoras)}</td>
            <td>${formatoDuracionSLA(v.retrasoMaximoHoras)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="vacio">🎉 Ninguna incidencia abierta ha superado su SLA.</td></tr>';
}

async function protegerSesionYMostrarUsuario() {
  const usuario = await window.api.getCurrentUser();
  if (!usuario) {
    window.location.href = 'login.html';
    return null;
  }
  document.getElementById('usuario-actual').textContent =
    `${usuario.nombre} ${usuario.apellido} (${usuario.rol})`;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await window.api.logout();
    window.location.href = 'login.html';
  });
  return usuario;
}

// Dibuja un mini gráfico de barras horizontales usando solo HTML/CSS (sin librerías externas)
function dibujarBarras(contenedor, datos, colorPorDefecto) {  if (!datos.length) {
    contenedor.innerHTML = '<p class="vacio">Sin datos todavía.</p>';
    return;
  }

  const maximo = Math.max(...datos.map((d) => d.cantidad), 1);

  contenedor.innerHTML = datos
    .map((d, i) => {
      const porcentaje = Math.round((d.cantidad / maximo) * 100);
      const color = d.color || colorPorDefecto;
      return `
        <div class="barra-fila">
          <span class="barra-etiqueta">${d.etiqueta}</span>
          <div class="barra-track">
            <div class="barra-fill" style="width:${porcentaje}%; background:${color}; transition-delay:${i * 60}ms"></div>
          </div>
          <span class="barra-valor">${d.cantidad}</span>
        </div>
      `;
    })
    .join('');
}

// Dibuja un gráfico de dona (anillos) usando SVG puro, sin librerías externas
function dibujarDona(contenedor, datos) {
  const total = datos.reduce((s, d) => s + d.cantidad, 0);
  if (!datos.length || !total) {
    contenedor.innerHTML = '<p class="vacio">Sin datos todavía.</p>';
    return;
  }

  const radio = 70;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  const segmentos = datos.map((d) => {
    const longitud = (d.cantidad / total) * circunferencia;
    const seg = { ...d, longitud, offset: acumulado };
    acumulado += longitud;
    return seg;
  });

  contenedor.innerHTML = `
    <div class="dona-caja">
      <svg viewBox="0 0 200 200" class="dona">
        <g transform="rotate(-90 100 100)">
          ${segmentos
            .map(
              (s) => `
            <circle
              cx="100" cy="100" r="${radio}" fill="none"
              stroke="${s.color || '#95a5a6'}" stroke-width="28"
              stroke-dasharray="${s.longitud} ${circunferencia - s.longitud}"
              stroke-dashoffset="${-s.offset}"
              class="dona-segmento"
            ></circle>`
            )
            .join('')}
        </g>
        <text x="100" y="94" text-anchor="middle" class="dona-total">${total}</text>
        <text x="100" y="112" text-anchor="middle" class="dona-label">incidencias</text>
      </svg>
      <ul class="leyenda">
        ${datos
          .map(
            (d) => `
          <li>
            <span class="leyenda-dot" style="background:${d.color || '#95a5a6'}"></span>
            ${d.etiqueta}
            <strong>${d.cantidad}</strong> (${Math.round((d.cantidad / total) * 100)}%)
          </li>`
          )
          .join('')}
      </ul>
    </div>
  `;
}

async function cargarReportes() {
  let data;
  try {
    data = await window.api.getReportes();
    datosReporte = data;
  } catch (err) {
    document.querySelector('main').innerHTML =
      '<p>No tienes permiso para ver esta sección. <a href="dashboard.html">Volver al dashboard</a>.</p>';
    return;
  }

  animarContador(document.getElementById('total-incidencias'), data.total, 1300);

  const elPromedio = document.getElementById('tiempo-promedio');
  if (data.promedioHoras !== null && data.promedioHoras !== undefined) {
    animarContador(elPromedio, data.promedioHoras, 1300);
  } else {
    elPromedio.textContent = 'Sin datos aún';
  }

  dibujarDona(document.getElementById('grafico-estado'), data.porEstado);
  dibujarBarras(document.getElementById('grafico-categoria'), data.porCategoria, '#4f46e5');
  dibujarBarras(document.getElementById('grafico-area'), data.porArea, '#0ea5e9');
  animarBarras();

  renderCumplimientoSla(data.cumplimientoSla);

  const tbody = document.getElementById('tbody-recurrentes');
  if (!data.recurrentes.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="vacio">Todavía no hay combinaciones área + categoría repetidas 2 veces o más.</td></tr>';
  } else {
    tbody.innerHTML = data.recurrentes
      .map(
        (r) => `
        <tr>
          <td>${r.area}</td>
          <td>${r.categoria}</td>
          <td><strong>${r.cantidad}</strong></td>
          <td>${formatearFecha(r.ultima_fecha)}</td>
        </tr>
      `
      )
      .join('');
  }

  // Áreas con 2+ incidencias: si hay una sola categoría, es el mismo problema
  // repitiéndose; si hay varias, son problemas distintos acumulados.
  const tbodyCalientes = document.getElementById('tbody-areas-calientes');
  if (!data.areasCalientes.length) {
    tbodyCalientes.innerHTML = '<tr><td colspan="5" class="vacio">Ninguna área tiene 2 o más incidencias registradas.</td></tr>';
  } else {
    tbodyCalientes.innerHTML = data.areasCalientes
      .map((a) => {
        const misma = a.categorias_distintas === 1;
        const tipo = misma ? obtenerBadge('Mismo problema repetido', '#dc2626') : obtenerBadge('Varios problemas distintos', '#f59e0b');
        return `
        <tr>
          <td>${a.area}</td>
          <td><strong>${a.cantidad}</strong></td>
          <td>${a.categorias_distintas}</td>
          <td>${tipo}</td>
          <td>${formatearFecha(a.ultima_fecha)}</td>
        </tr>`;
      })
      .join('');
  }
}

protegerSesionYMostrarUsuario().then((usuario) => {
  if (usuario) cargarReportes();
});

// ---------------------------------------------------------------------
// Exportación de reportes (CSV / Excel / PDF / Impresión)
// ---------------------------------------------------------------------

function seccionCSV(titulo, cabecera, filas) {
  const lineas = [titulo, cabecera.join(';')];
  filas.forEach((fila) => {
    lineas.push(
      fila
        .map((celda) => {
          const s = String(celda ?? '').replace(/"/g, '""');
          return /[";,\n]/.test(s) ? `"${s}"` : s;
        })
        .join(';')
    );
  });
  return lineas.join('\r\n');
}

function exportarCSVReporte() {
  if (!datosReporte) return mostrarToast('Aún no hay datos de reportes', 'error');
  const d = datosReporte;

  const bloque = [
    'REPORTE Y ANALISIS DE INCIDENCIAS',
    `Generado el;${formatearFecha(new Date())}`,
    `Total de incidencias;${d.total}`,
    `Horas promedio de resolucion;${d.promedioHoras ?? 'Sin datos'}`,
    '',
    seccionCSV('Incidencias por estado', ['Estado', 'Cantidad'], d.porEstado.map((x) => [x.etiqueta, x.cantidad])),
    '',
    seccionCSV('Incidencias por categoria', ['Categoria', 'Cantidad'], d.porCategoria.map((x) => [x.etiqueta, x.cantidad])),
    '',
    seccionCSV('Incidencias por area', ['Area', 'Cantidad'], d.porArea.map((x) => [x.etiqueta, x.cantidad])),
    '',
    seccionCSV('Incidencias recurrentes (area + categoria)', ['Area', 'Categoria', 'Veces', 'Ultima vez'], d.recurrentes.map((x) => [x.area, x.categoria, x.cantidad, formatearFecha(x.ultima_fecha)])),
    '',
    seccionCSV('Areas con incidencias repetidas (2 o mas)', ['Area', 'Incidencias', 'Categorias distintas', 'Diagnostico', 'Ultima vez'],
      d.areasCalientes.map((x) => [x.area, x.cantidad, x.categorias_distintas, x.categorias_distintas === 1 ? 'Mismo problema repetido' : 'Varios problemas distintos', formatearFecha(x.ultima_fecha)])),
    '',
    seccionCSV('CUMPLIMIENTO DEL SLA', ['Indicador', 'Valor'], [
      ['Incidencias resueltas', d.cumplimientoSla.total],
      ['Resueltas a tiempo', d.cumplimientoSla.aTiempo],
      ['Cumplimiento (%)', d.cumplimientoSla.porcentaje ?? 'Sin datos'],
      ['Promedio de resolucion (horas)', d.cumplimientoSla.promedioHoras ?? 'Sin datos'],
      ['Abiertas ya vencidas', d.cumplimientoSla.abiertasVencidas]
    ]),
    '',
    seccionCSV('Cumplimiento del SLA por area', ['Area', 'Resueltas', 'A tiempo', '% Cumplimiento', 'Promedio (horas)'],
      d.cumplimientoSla.porArea.map((x) => [x.area, x.total, x.aTiempo, x.porcentaje, x.promedioHoras ?? '-'])),
    '',
    seccionCSV('Cumplimiento del SLA por responsable', ['Responsable', 'Resueltas', 'A tiempo', '% Cumplimiento', 'Promedio (horas)'],
      d.cumplimientoSla.porResponsable.map((x) => [x.responsable, x.total, x.aTiempo, x.porcentaje, x.promedioHoras ?? '-'])),
    '',
    seccionCSV('Cumplimiento del SLA por prioridad', ['Prioridad', 'Plazo (h)', 'Resueltas', 'A tiempo', '% Cumplimiento'],
      d.cumplimientoSla.porPrioridad.map((x) => [x.prioridad, x.slaHoras, x.total, x.aTiempo, x.porcentaje])),
    '',
    seccionCSV('Abiertas que ya superaron su SLA', ['Area', 'Prioridad', 'Plazo (h)', 'Vencidas', 'Retraso prom. (h)', 'Peor retraso (h)'],
      d.cumplimientoSla.vencidasDetalle.map((x) => [x.area, x.prioridad, x.slaHoras, x.cantidad, x.retrasoPromedioHoras ?? '-', x.retrasoMaximoHoras ?? '-']))
  ].join('\r\n');

  descargarArchivo('reportes.csv', '\uFEFF' + bloque, 'text/csv;charset=utf-8');
  mostrarToast('CSV exportado', 'success');
}

function tablaHTML(titulo, cabecera, filas) {
  const thead = cabecera.map((c) => `<th>${c}</th>`).join('');
  const tbody = filas.map((f) => `<tr>${f.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('');
  return `<h3>${titulo}</h3><table border="1"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function exportarExcelReporte() {
  if (!datosReporte) return mostrarToast('Aún no hay datos de reportes', 'error');
  const d = datosReporte;

  const cuerpo =
    '<h2>Reporte y análisis de incidencias</h2>' +
    `<p>Generado: ${formatearFecha(new Date())} — Total: ${d.total} — Promedio resolución (horas): ${d.promedioHoras ?? 'Sin datos'}</p>` +
    tablaHTML('Incidencias por estado', ['Estado', 'Cantidad'], d.porEstado.map((x) => [x.etiqueta, x.cantidad])) +
    tablaHTML('Incidencias por categoría', ['Categoría', 'Cantidad'], d.porCategoria.map((x) => [x.etiqueta, x.cantidad])) +
    tablaHTML('Incidencias por área', ['Área', 'Cantidad'], d.porArea.map((x) => [x.etiqueta, x.cantidad])) +
    tablaHTML('Incidencias recurrentes (área + categoría)', ['Área', 'Categoría', 'Veces', 'Última vez'], d.recurrentes.map((x) => [x.area, x.categoria, x.cantidad, formatearFecha(x.ultima_fecha)])) +
    tablaHTML('Áreas con incidencias repetidas (2 o más)', ['Área', 'Incidencias', 'Categorías distintas', 'Diagnóstico', 'Última vez'],
      d.areasCalientes.map((x) => [x.area, x.cantidad, x.categorias_distintas, x.categorias_distintas === 1 ? 'Mismo problema repetido' : 'Varios problemas distintos', formatearFecha(x.ultima_fecha)])) +
    tablaHTML('Cumplimiento del SLA', ['Indicador', 'Valor'], [
      ['Incidencias resueltas', d.cumplimientoSla.total],
      ['Resueltas a tiempo', d.cumplimientoSla.aTiempo],
      ['Cumplimiento (%)', d.cumplimientoSla.porcentaje ?? 'Sin datos'],
      ['Promedio de resolución (horas)', d.cumplimientoSla.promedioHoras ?? 'Sin datos'],
      ['Abiertas ya vencidas', d.cumplimientoSla.abiertasVencidas]
    ]) +
    tablaHTML('Cumplimiento del SLA por área', ['Área', 'Resueltas', 'A tiempo', '% Cumplimiento', 'Promedio (h)'],
      d.cumplimientoSla.porArea.map((x) => [x.area, x.total, x.aTiempo, x.porcentaje, x.promedioHoras ?? '-'])) +
    tablaHTML('Cumplimiento del SLA por responsable', ['Responsable', 'Resueltas', 'A tiempo', '% Cumplimiento', 'Promedio (h)'],
      d.cumplimientoSla.porResponsable.map((x) => [x.responsable, x.total, x.aTiempo, x.porcentaje, x.promedioHoras ?? '-'])) +
    tablaHTML('Cumplimiento del SLA por prioridad', ['Prioridad', 'Plazo (h)', 'Resueltas', 'A tiempo', '% Cumplimiento'],
      d.cumplimientoSla.porPrioridad.map((x) => [x.prioridad, x.slaHoras, x.total, x.aTiempo, x.porcentaje])) +
    tablaHTML('Abiertas que ya superaron su SLA', ['Área', 'Prioridad', 'Plazo (h)', 'Vencidas', 'Retraso prom. (h)', 'Peor retraso (h)'],
      d.cumplimientoSla.vencidasDetalle.map((x) => [x.area, x.prioridad, x.slaHoras, x.cantidad, x.retrasoPromedioHoras ?? '-', x.retrasoMaximoHoras ?? '-']));

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8" />
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
      <x:Name>Reportes</x:Name><x:WorksheetOptions></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head><body>${cuerpo}</body></html>`;

  descargarArchivo('reportes.xls', html, 'application/vnd.ms-excel');
  mostrarToast('Excel exportado', 'success');
}

function abrirImpresionReporte() {
  if (!datosReporte) return mostrarToast('Aún no hay datos de reportes', 'error');
  const d = datosReporte;

  function tabla(titulo, cabecera, filas) {
    const thead = cabecera.map((c) => `<th>${c}</th>`).join('');
    const tbody = filas.map((f) => `<tr>${f.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('');
    return `<h3>${titulo}</h3><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte y análisis de incidencias</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 32px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 6px; }
    h3 { font-size: 13px; margin: 18px 0 6px; color: #475569; }
    .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
    .kpis { display: flex; gap: 16px; margin-bottom: 8px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 18px; min-width: 200px; }
    .kpi strong { display: block; font-size: 24px; }
    .kpi span { font-size: 12px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
    th { background: #f1f5f9; text-transform: uppercase; font-size: 10.5px; letter-spacing: .05em; }
    .firma { margin-top: 24px; font-size: 11px; color: #94a3b8; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>Reporte y análisis de incidencias</h1>
  <div class="sub">Generado el ${formatearFecha(new Date())}</div>
  <div class="kpis">
    <div class="kpi"><strong>${d.total}</strong><span>Incidencias totales</span></div>
    <div class="kpi"><strong>${d.promedioHoras ?? '—'}</strong><span>Horas promedio de resolución</span></div>
  </div>
  ${tabla('Incidencias por estado', ['Estado', 'Cantidad'], d.porEstado.map((x) => [x.etiqueta, x.cantidad]))}
  ${tabla('Incidencias por categoría', ['Categoría', 'Cantidad'], d.porCategoria.map((x) => [x.etiqueta, x.cantidad]))}
  ${tabla('Incidencias por área', ['Área', 'Cantidad'], d.porArea.map((x) => [x.etiqueta, x.cantidad]))}
  ${tabla('Incidencias recurrentes (área + categoría)', ['Área', 'Categoría', 'Veces', 'Última vez'], d.recurrentes.map((x) => [x.area, x.categoria, x.cantidad, formatearFecha(x.ultima_fecha)]))}
  ${tabla('Áreas con incidencias repetidas (2 o más)', ['Área', 'Incidencias', 'Categorías distintas', 'Diagnóstico', 'Última vez'],
    d.areasCalientes.map((x) => [x.area, x.cantidad, x.categorias_distintas, x.categorias_distintas === 1 ? 'Mismo problema repetido' : 'Varios problemas distintos', formatearFecha(x.ultima_fecha)]))}
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

document.getElementById('btn-csv').addEventListener('click', exportarCSVReporte);
document.getElementById('btn-excel').addEventListener('click', exportarExcelReporte);
document.getElementById('btn-pdf').addEventListener('click', abrirImpresionReporte);
document.getElementById('btn-imprimir').addEventListener('click', abrirImpresionReporte);
