// toast.js
// Notificación breve de feedback tras una acción del usuario (registrar,
// cambiar estado, comentar, etc). Se usa desde los demás scripts así:
//   mostrarToast('Incidencia registrada', 'success')

function mostrarToast(mensaje, tipo = 'success') {
  const contenedor = document.getElementById('toast-container');
  if (!contenedor) return;

  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 2800);
}
