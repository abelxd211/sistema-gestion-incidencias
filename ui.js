// ui.js
// Utilidades compartidas de UI usadas por todas las páginas (dashboard, detalle, reportes).

function pluralizar(n, singular, plural) {
  return Number(n) === 1 ? singular : plural;
}

function obtenerBadgeEstado(estado, colorDesdeBD) {
  const normalizado = (estado || '').toLowerCase().replace(/\s+/g, ' ');
  const colores = {
    'abierta': '#ef4444',
    'pendiente': '#ef4444',
    'en proceso': '#f59e0b',
    'enproceso': '#f59e0b',
    'resuelta': '#10b981',
    'cerrada': '#64748b'
  };
  const color = colores[normalizado] || colorDesdeBD || '#64748b';
  return `<span class="badge" style="--badge-color: ${color}">${estado}</span>`;
}

function obtenerBadge(etiqueta, color) {
  const c = color || '#64748b';
  return `<span class="badge" style="--badge-color: ${c}">${etiqueta}</span>`;
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  try {
    return new Date(fecha).toLocaleString('es-DO');
  } catch (e) {
    return fecha;
  }
}

/* --- SLA: cálculo de plazos y alertas de vencimiento --- */
const HORA_MS = 3600 * 1000;

function formatoDuracionSLA(horas) {
  horas = Math.max(0, horas);
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 48) return `${Math.floor(horas)} h`;
  const dias = Math.floor(horas / 24);
  const rest = Math.round(horas % 24);
  return rest ? `${dias} d ${rest} h` : `${dias} d`;
}

// Calcula el estado de SLA de una incidencia. Requiere sla_horas (objetivo en horas),
// fecha_creacion y estado. Devuelve null si la incidencia no tiene SLA definido.
function infoSLA(inc) {
  const sla = Number(inc && inc.sla_horas);
  if (!sla || sla <= 0) return null;

  const creada = new Date(inc.fecha_creacion).getTime();
  if (Number.isNaN(creada)) return null;

  const cerrada = inc.estado === 'Resuelta' || inc.estado === 'Cerrada';
  const fin = cerrada ? (inc.fecha_resolucion || inc.fecha_cierre || null) : null;
  const usadoHoras = fin ? (new Date(fin).getTime() - creada) / HORA_MS : (Date.now() - creada) / HORA_MS;
  const restanteHoras = sla - usadoHoras;
  const vencida = restanteHoras < 0;
  const pct = Math.min(100, (usadoHoras / sla) * 100);

  let texto;
  let color;
  if (cerrada) {
    texto = vencida ? 'Fuera de SLA' : 'SLA cumplido';
    color = vencida ? '#dc2626' : '#10b981';
  } else if (vencida) {
    texto = `Vencida hace ${formatoDuracionSLA(-restanteHoras)}`;
    color = '#dc2626';
  } else if (pct >= 75) {
    texto = `Restan ${formatoDuracionSLA(restanteHoras)}`;
    color = '#f59e0b';
  } else {
    texto = `Restan ${formatoDuracionSLA(restanteHoras)}`;
    color = '#64748b';
  }

  return { objetivoHoras: sla, usadoHoras, restanteHoras, vencida, cerrada, pct, texto, color };
}

function badgeSLA(inc) {
  const info = infoSLA(inc);
  return info ? `<span class="badge" style="--badge-color: ${info.color}">${info.texto}</span>` : '';
}

// Número de incidencias ABIERTAS y vencidas por SLA (para el banner del dashboard).
function contarSLAVencidas(incidencias) {
  return incidencias.filter((inc) => {
    const info = infoSLA(inc);
    return info && !info.cerrada && info.vencida;
  }).length;
}

function descargarArchivo(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --- Anima ancho de barras cuando entran en viewport --- */
function animarBarras(selector = '.barra-fill') {
  const bars = document.querySelectorAll(selector);
  if (!bars.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const el = e.target;
          const destino = el.dataset.width || el.style.width;
          el.style.transition = 'none';
          el.style.width = '0%';
          void el.offsetWidth; // fuerza reflow para re-animar
          el.style.transition = 'width 1s cubic-bezier(.16,1,.3,1)';
          el.style.width = destino;
          io.unobserve(el);
        }
      });
    },
    { threshold: 0.2 }
  );

  bars.forEach((b) => io.observe(b));
}

/* --- Contador animado para tarjetas (soporta decimales) --- */
function animarContador(el, target, duration = 1200) {
  if (!el) return;
  const esDecimal = String(target).includes('.');
  const t0 = performance.now();

  function step(now) {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const valor = target * eased;
    el.textContent = esDecimal ? valor.toFixed(1) : String(Math.round(valor));
    if (p < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}