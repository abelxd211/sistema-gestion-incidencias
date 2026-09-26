// preload.js
// Puente seguro entre el proceso principal (Node/MySQL) y el frontend (HTML/JS).
// El renderer NUNCA toca Node directamente; solo puede llamar estas funciones expuestas.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credenciales) => ipcRenderer.invoke('login', credenciales),
  getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
  logout: () => ipcRenderer.invoke('logout'),
  getCatalogos: () => ipcRenderer.invoke('get-catalogos'),
  getIncidencias: () => ipcRenderer.invoke('get-incidencias'),
  crearIncidencia: (data) => ipcRenderer.invoke('crear-incidencia', data),
  editarIncidencia: (data) => ipcRenderer.invoke('editar-incidencia', data),
  getIncidenciaDetalle: (id) => ipcRenderer.invoke('get-incidencia-detalle', id),
  cambiarEstado: (data) => ipcRenderer.invoke('cambiar-estado', data),
  asignarResponsable: (data) => ipcRenderer.invoke('asignar-responsable', data),
  agregarComentario: (data) => ipcRenderer.invoke('agregar-comentario', data),
  eliminarComentario: (data) => ipcRenderer.invoke('eliminar-comentario', data),
  eliminarIncidencia: (id) => ipcRenderer.invoke('eliminar-incidencia', id),
  getReportes: () => ipcRenderer.invoke('get-reportes'),
  getUsuarios: () => ipcRenderer.invoke('get-usuarios'),
  crearUsuario: (data) => ipcRenderer.invoke('crear-usuario', data),
  editarUsuario: (data) => ipcRenderer.invoke('editar-usuario', data),
  alternarUsuarioActivo: (data) => ipcRenderer.invoke('alternar-usuario-activo', data),
  cambiarPasswordUsuario: (data) => ipcRenderer.invoke('cambiar-password-usuario', data),
  getNotificaciones: () => ipcRenderer.invoke('get-notificaciones'),
  marcarNotificacionesLeidas: () => ipcRenderer.invoke('marcar-notificaciones-leidas'),
  marcarNotificacionLeida: (id) => ipcRenderer.invoke('marcar-notificacion-leida', id),
  sugerirClasificacion: (data) => ipcRenderer.invoke('sugerir-clasificacion', data),
  generarDiagnostico: (id) => ipcRenderer.invoke('generar-diagnostico', id),
  buscarDuplicados: (data) => ipcRenderer.invoke('buscar-duplicados', data)
});
