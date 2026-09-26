// main.js
// Proceso principal de Electron: crea la ventana y expone operaciones de base de datos
// al proceso de renderizado (frontend) mediante IPC, nunca acceso directo a Node desde el HTML.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pool = require('./db');

// Usuario logueado en la sesión actual (app de escritorio = un solo usuario a la vez).
let currentUser = null;

// Caché en memoria del catálogo (áreas, categorías, prioridades, impactos, estados).
// Son datos que cambian rara vez, así que evitamos consultar MySQL en cada navegación.
let cacheCatalogos = null;

// ---------------------------------------------------------------------
// Inicialización de esquema: crea la tabla de notificaciones si no existe
// ---------------------------------------------------------------------
async function inicializarSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id_notificacion INT AUTO_INCREMENT PRIMARY KEY,
      id_incidencia INT NULL,
      id_usuario_destino INT NOT NULL,
      tipo VARCHAR(40) NOT NULL,
      mensaje VARCHAR(255) NOT NULL,
      leida TINYINT(1) NOT NULL DEFAULT 0,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_destino (id_usuario_destino, leida)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // SLA: agrega sla_horas a prioridades si no existe (migración idempotente).
  // Los valores solo se siembran cuando la columna es nueva, para no pisar cambios.
  try {
    const [cols] = await pool.query(
      `SELECT COUNT(*) AS existe FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prioridades' AND COLUMN_NAME = 'sla_horas'`
    );
    if (!cols[0].existe) {
      await pool.query('ALTER TABLE prioridades ADD COLUMN sla_horas INT NOT NULL DEFAULT 24');
      await pool.query(`
        UPDATE prioridades SET sla_horas = CASE nombre
          WHEN 'Baja'    THEN 72
          WHEN 'Media'   THEN 48
          WHEN 'Alta'    THEN 24
          WHEN 'Crítica' THEN 6
          ELSE 24
        END
      `);
      console.log('Migración SLA aplicada: columna sla_horas agregada a prioridades.');
    }
  } catch (err) {
    console.error('No se pudo aplicar la migración SLA:', err.message);
  }
}

// Crea una notificación para un usuario; si falla, no debe romper la operación principal.
async function crearNotificacion({ id_incidencia = null, id_usuario_destino, tipo, mensaje }) {
  try {
    await pool.query(
      'INSERT INTO notificaciones (id_incidencia, id_usuario_destino, tipo, mensaje) VALUES (?, ?, ?, ?)',
      [id_incidencia, id_usuario_destino, tipo, mensaje]
    );
  } catch (err) {
    console.error('No se pudo crear la notificación:', err.message);
  }
}

async function registrarCambioHistorial(id_incidencia, campo, anterior, nuevo) {
  if (anterior === nuevo || (anterior === null && nuevo === '')) return false;
  await pool.query(
    `INSERT INTO historial_incidencias (id_incidencia, id_usuario, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, ?, ?, ?)`,
    [id_incidencia, currentUser.id_usuario, campo, anterior ?? '', nuevo ?? '']
  );
  return true;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // seguridad: aísla el contexto de Node del de la página
      nodeIntegration: false,
      spellcheck: false,      // ahorra CPU/memoria: no revisar ortografía
      webgl: false            // ahorra CPU/GPU: la app no usa WebGL
    }
  });

  win.loadFile('login.html');
}

app.whenReady().then(async () => {
  try {
    await inicializarSchema();
  } catch (err) {
    console.error('Error al inicializar el esquema:', err.message);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------
// Handlers IPC: cada uno responde a una llamada hecha desde el frontend
// vía window.api.xxx() (definido en preload.js)
// ---------------------------------------------------------------------

// Login: valida email + password contra la tabla usuarios (password_hash con bcrypt)
ipcMain.handle('login', async (event, { email, password }) => {
  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.password_hash, u.activo, u.id_area,
            r.nombre AS rol, a.nombre AS area
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN areas a ON a.id_area = u.id_area
     WHERE u.email = ?`,
    [email]
  );

  if (!rows.length) {
    return { success: false, message: 'Correo o contraseña incorrectos.' };
  }

  const usuario = rows[0];

  if (!usuario.activo) {
    return { success: false, message: 'Este usuario está inactivo.' };
  }

  const coincide = await bcrypt.compare(password, usuario.password_hash);
  if (!coincide) {
    return { success: false, message: 'Correo o contraseña incorrectos.' };
  }

  currentUser = {
    id_usuario: usuario.id_usuario,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    rol: usuario.rol,
    id_area: usuario.id_area,
    area: usuario.area
  };

  return { success: true, usuario: currentUser };
});

// Devuelve el usuario logueado actualmente (para mostrarlo en el dashboard)
ipcMain.handle('get-current-user', () => currentUser);

// Cierra sesión
ipcMain.handle('logout', () => {
  currentUser = null;
  return { success: true };
});

// Trae todos los catálogos de una vez (áreas, categorías, prioridades, impactos, estados)
async function obtenerCatalogos() {
  if (cacheCatalogos) return cacheCatalogos;

  const [areas] = await pool.query('SELECT id_area, nombre FROM areas WHERE activo = 1');
  const [categorias] = await pool.query('SELECT id_categoria, nombre FROM categorias WHERE activo = 1');
  const [prioridades] = await pool.query('SELECT id_prioridad, nombre, color, sla_horas FROM prioridades ORDER BY nivel');
  const [impactos] = await pool.query('SELECT id_impacto, nombre, color FROM impactos ORDER BY nivel');
  const [estados] = await pool.query('SELECT id_estado, nombre, color FROM estados ORDER BY orden');
  const [roles] = await pool.query('SELECT id_rol, nombre FROM roles ORDER BY id_rol');

  // Posibles responsables: Encargados y Administradores activos. Es el catálogo que
  // usa "Nueva incidencia" para el campo obligatorio de encargado.
  const [responsables] = await pool.query(
    `SELECT u.id_usuario, CONCAT(u.nombre, ' ', u.apellido) AS nombre, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     WHERE r.nombre IN ('Encargado', 'Administrador') AND u.activo = 1
     ORDER BY r.nombre, u.nombre`
  );

  cacheCatalogos = { areas, categorias, prioridades, impactos, estados, roles, responsables };
  return cacheCatalogos;
}

ipcMain.handle('get-catalogos', () => obtenerCatalogos());

// Trae la lista de incidencias con los nombres de sus catálogos ya resueltos (JOIN).
// Un Empleado solo ve las que él mismo reportó; Encargado y Administrador ven todas.
ipcMain.handle('get-incidencias', async () => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const esEmpleado = currentUser.rol === 'Empleado';

  const [rows] = await pool.query(
    `SELECT
      i.id_incidencia,
      i.titulo,
      i.descripcion,
      i.id_estado,
      i.fecha_creacion,
      i.fecha_resolucion,
      i.fecha_cierre,
      a.nombre  AS area,
      c.nombre  AS categoria,
      p.nombre  AS prioridad,
      p.color   AS prioridad_color,
      p.sla_horas,
      im.nombre AS impacto,
      im.color  AS impacto_color,
      e.nombre  AS estado,
      e.color   AS estado_color
    FROM incidencias i
    JOIN areas a        ON a.id_area = i.id_area
    JOIN categorias c   ON c.id_categoria = i.id_categoria
    JOIN prioridades p  ON p.id_prioridad = i.id_prioridad
    JOIN impactos im    ON im.id_impacto = i.id_impacto
    JOIN estados e      ON e.id_estado = i.id_estado
    ${esEmpleado ? 'WHERE i.id_usuario_reporta = ?' : ''}
    ORDER BY i.fecha_creacion DESC`,
    esEmpleado ? [currentUser.id_usuario] : []
  );
  return rows;
});

// Crea una nueva incidencia, usando al usuario realmente logueado como reportero.
ipcMain.handle('crear-incidencia', async (event, data) => {
  if (!currentUser) {
    throw new Error('No hay una sesión activa.');
  }

  const { titulo, descripcion, id_area, id_categoria, id_prioridad, id_impacto, id_usuario_asignado } = data;

  // Un Empleado solo puede reportar incidencias de su propia área.
  // Encargado y Administrador pueden reportar en cualquier área.
  let idAreaFinal = id_area;
  if (currentUser.rol === 'Empleado') {
    if (!currentUser.id_area) {
      throw new Error('Tu usuario no tiene un área asignada. Avisa al Administrador.');
    }
    if (Number(id_area) !== Number(currentUser.id_area)) {
      throw new Error(`Como Empleado solo puedes registrar incidencias de tu área (${currentUser.area}).`);
    }
    idAreaFinal = currentUser.id_area;
  }

  // El encargado responsable es OBLIGATORIO: sin él la incidencia no puede avanzar
  // de estado. Se valida que exista, esté activo y sea Encargado o Administrador.
  if (!id_usuario_asignado) {
    throw new Error('Debes asignar un encargado responsable.');
  }
  const [[responsable]] = await pool.query(
    `SELECT u.id_usuario FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     WHERE u.id_usuario = ? AND u.activo = 1 AND r.nombre IN ('Encargado', 'Administrador')`,
    [id_usuario_asignado]
  );
  if (!responsable) {
    throw new Error('El encargado seleccionado no es válido o está inactivo.');
  }

  // Toda nueva incidencia nace en estado "Pendiente" (id_estado = 1, según el seed del script SQL)
  const [result] = await pool.query(
    `INSERT INTO incidencias
      (titulo, descripcion, id_area, id_categoria, id_prioridad, id_impacto, id_estado,
       id_usuario_reporta, id_usuario_asignado)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [titulo, descripcion, idAreaFinal, id_categoria, id_prioridad, id_impacto,
     currentUser.id_usuario, responsable.id_usuario]
  );

  // Avisa solo al encargado responsable que se acaba de asignar.
  // Antes se notificaba a todos los gestores, pero con el responsable obligatorio
  // cada incidencia tiene un dueño claro.
  await crearNotificacion({
    id_incidencia: result.insertId,
    id_usuario_destino: responsable.id_usuario,
    tipo: 'asignacion',
    mensaje: `Se te asignó la incidencia: ${titulo}`
  });

  return { id_incidencia: result.insertId };
});

// Edita los datos descriptivos de una incidencia (título, descripción, área,
// categoría, prioridad, impacto). NO toca estado ni responsable: eso se gestiona
// por Kanban y por el panel de asignación del detalle.
// Cada campo modificado se registra automáticamente en el historial.
ipcMain.handle('editar-incidencia', async (event, data) => {
  if (!currentUser) throw new Error('No hay una sesión activa.');
  if (currentUser.rol === 'Empleado') {
    throw new Error('No tienes permiso para editar incidencias.');
  }

  const { id_incidencia, titulo, descripcion, id_area, id_categoria, id_prioridad, id_impacto } = data;

  if (!titulo || !titulo.trim()) throw new Error('El título es obligatorio.');
  if (!descripcion || !descripcion.trim()) throw new Error('La descripción es obligatoria.');

  // Trae los valores actuales (con los nombres legibles de los catálogos).
  const [actuales] = await pool.query(
    `SELECT i.id_incidencia, i.titulo, i.descripcion,
            i.id_area,     a.nombre  AS area,
            i.id_categoria, c.nombre  AS categoria,
            i.id_prioridad, p.nombre  AS prioridad,
            i.id_impacto,   im.nombre AS impacto
     FROM incidencias i
     JOIN areas a        ON a.id_area = i.id_area
     JOIN categorias c   ON c.id_categoria = i.id_categoria
     JOIN prioridades p  ON p.id_prioridad = i.id_prioridad
     JOIN impactos im    ON im.id_impacto = i.id_impacto
     WHERE i.id_incidencia = ?`,
    [id_incidencia]
  );

  if (!actuales.length) throw new Error('La incidencia no existe.');

  const antes = actuales[0];

  // Resuelve los nombres nuevos de los catálogos para poder detectar cambios reales.
  const nombresNuevos = {};
  await Promise.all(
    [
      ['area', 'SELECT nombre FROM areas WHERE id_area = ?', id_area],
      ['categoria', 'SELECT nombre FROM categorias WHERE id_categoria = ?', id_categoria],
      ['prioridad', 'SELECT nombre FROM prioridades WHERE id_prioridad = ?', id_prioridad],
      ['impacto', 'SELECT nombre FROM impactos WHERE id_impacto = ?', id_impacto]
    ].map(async ([campo, sql, id]) => {
      const [r] = await pool.query(sql, [id]);
      if (!r.length) throw new Error(`El valor de ${campo} no es válido.`);
      nombresNuevos[campo] = r[0].nombre;
    })
  );

  // Detecta qué campos cambian de verdad (ignora eltrim y espacios de más).
  const cambios = [];
  const registrar = (campo, valorAnterior, valorNuevo) => {
    if (String(valorAnterior).trim() !== String(valorNuevo).trim()) {
      cambios.push({ campo, anterior: valorAnterior, nuevo: valorNuevo });
    }
  };

  registrar('titulo', antes.titulo, titulo.trim());
  registrar('descripcion', antes.descripcion, descripcion.trim());
  registrar('area', antes.area, nombresNuevos.area);
  registrar('categoria', antes.categoria, nombresNuevos.categoria);
  registrar('prioridad', antes.prioridad, nombresNuevos.prioridad);
  registrar('impacto', antes.impacto, nombresNuevos.impacto);

  if (!cambios.length) {
    return { success: true, cambios: 0, mensaje: 'No hay cambios que guardar.' };
  }

  await pool.query(
    `UPDATE incidencias SET
       titulo = ?, descripcion = ?, id_area = ?, id_categoria = ?, id_prioridad = ?, id_impacto = ?,
       fecha_actualizacion = NOW()
     WHERE id_incidencia = ?`,
    [titulo.trim(), descripcion.trim(), id_area, id_categoria, id_prioridad, id_impacto, id_incidencia]
  );

  for (const c of cambios) {
    await registrarCambioHistorial(id_incidencia, c.campo, c.anterior, c.nuevo);
  }

  return {
    success: true,
    cambios: cambios.length,
    mensaje: `Incidencia actualizada (${cambios.length} campo(s) modificado(s)).`
  };
});

// -----------------------------------------------------------------------
// GESTIÓN DE USUARIOS (solo Administrador)
// Permite dar de alta empleados y encargados, editar sus datos y
// activar/desactivar cuentas sin tocar código ni la base a mano.
// Desactivar NO borra: conserva el historial de sus incidencias y comentarios.
// -----------------------------------------------------------------------

function exigirAdministrador() {
  if (!currentUser) throw new Error('No hay una sesión activa.');
  if (currentUser.rol !== 'Administrador') {
    throw new Error('Solo el Administrador puede gestionar usuarios.');
  }
}

function validarEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!re.test(email)) throw new Error('El correo no tiene un formato válido.');
}

// Lista todos los usuarios con su rol y área, para la página de gestión.
ipcMain.handle('get-usuarios', async () => {
  exigirAdministrador();
  const [usuarios] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.activo,
            r.nombre AS rol, r.id_rol,
            a.nombre AS area, a.id_area
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN areas a ON a.id_area = u.id_area
     ORDER BY u.activo DESC, u.nombre ASC`
  );
  return usuarios;
});

// Área técnica (Tecnología / TI) que se asigna automáticamente a Encargados y Administradores.
async function idAreaTecnologia() {
  const [[area]] = await pool.query("SELECT id_area FROM areas WHERE nombre = 'Tecnología / TI' AND activo = 1 LIMIT 1");
  return area ? area.id_area : null;
}

// El área de un usuario se deriva del rol:
//   - Encargado / Administrador -> siempre Tecnología / TI (gestionan toda la empresa).
//   - Empleado -> la elige el Administrador al darlo de alta, porque limita
//     las incidencias que puede reportar (ver 'crear-incidencia').
async function resolverAreaSegunRol(idRol, idAreaElegido) {
  const [[rol]] = await pool.query('SELECT nombre FROM roles WHERE id_rol = ?', [idRol]);
  if (!rol) throw new Error('El rol seleccionado no es válido.');

  if (rol.nombre === 'Encargado' || rol.nombre === 'Administrador') {
    return await idAreaTecnologia();
  }

  if (!idAreaElegido) throw new Error('Debes indicar el área del empleado.');
  const [[area]] = await pool.query('SELECT id_area FROM areas WHERE id_area = ? AND activo = 1', [idAreaElegido]);
  if (!area) throw new Error('El área seleccionada no es válida.');
  return area.id_area;
}

// Crea un usuario nuevo. La contraseña se cifra con bcrypt antes de guardarse.
ipcMain.handle('crear-usuario', async (event, data) => {
  exigirAdministrador();

  const { nombre, apellido, email, password, id_rol, id_area } = data;
  const nombreLimpio = (nombre || '').trim();
  const apellidoLimpio = (apellido || '').trim();
  const emailLimpio = (email || '').trim().toLowerCase();

  if (!nombreLimpio) throw new Error('El nombre es obligatorio.');
  if (!apellidoLimpio) throw new Error('El apellido es obligatorio.');
  if (!emailLimpio) throw new Error('El correo es obligatorio.');
  validarEmail(emailLimpio);
  if (!password || password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const [existente] = await pool.query('SELECT id_usuario FROM usuarios WHERE email = ?', [emailLimpio]);
  if (existente.length) throw new Error('Ya existe un usuario con ese correo.');

  const idAreaFinal = await resolverAreaSegunRol(id_rol, id_area);

  const hash = await bcrypt.hash(password, 10);
  const [resultado] = await pool.query(
    'INSERT INTO usuarios (nombre, apellido, email, password_hash, id_rol, id_area) VALUES (?, ?, ?, ?, ?, ?)',
    [nombreLimpio, apellidoLimpio, emailLimpio, hash, id_rol, idAreaFinal]
  );

  return { id_usuario: resultado.insertId };
});

// Edita los datos de un usuario. NO toca la contraseña ni el estado activo.
ipcMain.handle('editar-usuario', async (event, data) => {
  exigirAdministrador();

  const { id_usuario, nombre, apellido, email, id_rol, id_area } = data;
  const nombreLimpio = (nombre || '').trim();
  const apellidoLimpio = (apellido || '').trim();
  const emailLimpio = (email || '').trim().toLowerCase();

  if (!nombreLimpio) throw new Error('El nombre es obligatorio.');
  if (!apellidoLimpio) throw new Error('El apellido es obligatorio.');
  if (!emailLimpio) throw new Error('El correo es obligatorio.');
  validarEmail(emailLimpio);

  const idAreaFinal = await resolverAreaSegunRol(id_rol, id_area);

  const [duplicado] = await pool.query(
    'SELECT id_usuario FROM usuarios WHERE email = ? AND id_usuario <> ?',
    [emailLimpio, id_usuario]
  );
  if (duplicado.length) throw new Error('Ya existe otro usuario con ese correo.');

  await pool.query(
    'UPDATE usuarios SET nombre = ?, apellido = ?, email = ?, id_rol = ?, id_area = ? WHERE id_usuario = ?',
    [nombreLimpio, apellidoLimpio, emailLimpio, id_rol, idAreaFinal, id_usuario]
  );

  return { success: true };
});

// Activa o desactiva una cuenta. No borra nada: el historial del usuario se conserva.
// Protecciones: nadie puede desactivarse a sí mismo ni quedarse sin administradores activos.
ipcMain.handle('alternar-usuario-activo', async (event, { id_usuario, activo }) => {
  exigirAdministrador();

  if (Number(id_usuario) === currentUser.id_usuario && !activo) {
    throw new Error('No puedes desactivar tu propia cuenta.');
  }

  if (!activo) {
    const [[rolActual]] = await pool.query(
      'SELECT r.nombre AS rol FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE u.id_usuario = ?',
      [id_usuario]
    );
    if (rolActual && rolActual.rol === 'Administrador') {
      const [[otros]] = await pool.query(
        "SELECT COUNT(*) AS total FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE r.nombre = 'Administrador' AND u.activo = 1 AND u.id_usuario <> ?",
        [id_usuario]
      );
      if (!otros.total) {
        throw new Error('No se puede desactivar: debe quedar al menos un Administrador activo.');
      }
    }
  }

  await pool.query('UPDATE usuarios SET activo = ? WHERE id_usuario = ?', [activo ? 1 : 0, id_usuario]);
  return { success: true, activo: !!activo };
});

// El Administrador cambia la contraseña de cualquier usuario (la suya incluida).
// La contraseña nunca se guarda en claro: se re-cifra con bcrypt.
ipcMain.handle('cambiar-password-usuario', async (event, data) => {
  exigirAdministrador();

  const { id_usuario, password } = data;
  const nueva = typeof password === 'string' ? password : '';

  if (nueva.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }
  if (nueva.length > 100) {
    throw new Error('La contraseña no puede superar 100 caracteres.');
  }

  const [[u]] = await pool.query(
    'SELECT nombre, apellido FROM usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  if (!u) throw new Error('El usuario no existe.');

  const hash = await bcrypt.hash(nueva, 10);
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id_usuario = ?', [hash, id_usuario]);

  // Se avisa al propio usuario para que sepa que su clave cambió.
  await crearNotificacion({
    id_usuario_destino: id_usuario,
    tipo: 'password',
    mensaje: `El Administrador restablecer tu contraseña de ${u.nombre} ${u.apellido}.`
  });

  return { success: true };
});

// -----------------------------------------------------------------------
// DETALLE DE INCIDENCIA: datos completos + historial + comentarios
// -----------------------------------------------------------------------

async function cargarDetalleBasico(idIncidencia) {
  const [incRows] = await pool.query(
    `SELECT
      i.*,
      a.nombre AS area, c.nombre AS categoria,
      p.nombre AS prioridad, p.color AS prioridad_color, p.sla_horas,
      im.nombre AS impacto, im.color AS impacto_color,
      e.nombre AS estado, e.color AS estado_color,
      ur.nombre AS reporta_nombre, ur.apellido AS reporta_apellido,
      ua.nombre AS asignado_nombre, ua.apellido AS asignado_apellido
    FROM incidencias i
    JOIN areas a ON a.id_area = i.id_area
    JOIN categorias c ON c.id_categoria = i.id_categoria
    JOIN prioridades p ON p.id_prioridad = i.id_prioridad
    JOIN impactos im ON im.id_impacto = i.id_impacto
    JOIN estados e ON e.id_estado = i.id_estado
    JOIN usuarios ur ON ur.id_usuario = i.id_usuario_reporta
    LEFT JOIN usuarios ua ON ua.id_usuario = i.id_usuario_asignado
    WHERE i.id_incidencia = ?`,
    [idIncidencia]
  );

  if (!incRows.length) return null;

  if (currentUser.rol === 'Empleado' && incRows[0].id_usuario_reporta !== currentUser.id_usuario) {
    throw new Error('No tienes permiso para ver esta incidencia.');
  }

  const [historial] = await pool.query(
    `SELECT h.*, u.nombre, u.apellido
     FROM historial_incidencias h
     JOIN usuarios u ON u.id_usuario = h.id_usuario
     WHERE h.id_incidencia = ?
     ORDER BY h.fecha DESC`,
    [idIncidencia]
  );

  const [comentarios] = await pool.query(
    `SELECT co.*, u.nombre, u.apellido
     FROM comentarios_incidencias co
     JOIN usuarios u ON u.id_usuario = co.id_usuario
     WHERE co.id_incidencia = ?
     ORDER BY co.fecha ASC`,
    [idIncidencia]
  );

  return { incidencia: incRows[0], historial, comentarios };
}

ipcMain.handle('get-incidencia-detalle', async (event, idIncidencia) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const base = await cargarDetalleBasico(idIncidencia);
  if (!base) return null;

  const [estados] = await pool.query('SELECT id_estado, nombre FROM estados ORDER BY orden');

  const [usuariosParaAsignar] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.apellido
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     WHERE r.nombre IN ('Encargado', 'Administrador') AND u.activo = 1`
  );

  return { ...base, estados, usuariosParaAsignar };
});

// Cambia el estado y deja constancia automática en el historial
ipcMain.handle('cambiar-estado', async (event, { id_incidencia, id_estado_nuevo }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');
  if (currentUser.rol === 'Empleado') throw new Error('No tienes permiso para cambiar el estado de una incidencia.');

  const [[actual]] = await pool.query(
    `SELECT i.id_usuario_reporta, i.id_usuario_asignado, e.nombre AS estado_actual
     FROM incidencias i JOIN estados e ON e.id_estado = i.id_estado
     WHERE i.id_incidencia = ?`,
    [id_incidencia]
  );

  // Sin encargado asignado la incidencia no puede avanzar: primero hay que
  // asignarle un responsable (botón "Asignar responsable" en el detalle).
  if (!actual.id_usuario_asignado) {
    throw new Error(
      'No se puede cambiar el estado: la incidencia no tiene un encargado responsable asignado. ' +
      'Asigna uno primero desde la ficha de la incidencia.'
    );
  }

  const [[nuevo]] = await pool.query('SELECT nombre FROM estados WHERE id_estado = ?', [id_estado_nuevo]);

  let camposExtra = '';
  if (nuevo.nombre === 'Resuelta') camposExtra = ', fecha_resolucion = NOW()';
  if (nuevo.nombre === 'Cerrada') camposExtra = ', fecha_cierre = NOW()';

  await pool.query(
    `UPDATE incidencias SET id_estado = ?, fecha_actualizacion = NOW()${camposExtra} WHERE id_incidencia = ?`,
    [id_estado_nuevo, id_incidencia]
  );

  await pool.query(
    `INSERT INTO historial_incidencias (id_incidencia, id_usuario, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, 'estado', ?, ?)`,
    [id_incidencia, currentUser.id_usuario, actual.estado_actual, nuevo.nombre]
  );

  if (actual.id_usuario_reporta != null) {
    await crearNotificacion({
      id_incidencia,
      id_usuario_destino: actual.id_usuario_reporta,
      tipo: 'estado',
      mensaje: `El estado de tu incidencia #${id_incidencia} cambió a "${nuevo.nombre}"`
    });
  }

  return { success: true };
});

// Asigna o reasigna un responsable, también con registro en el historial
ipcMain.handle('asignar-responsable', async (event, { id_incidencia, id_usuario_asignado }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');
  if (currentUser.rol === 'Empleado') throw new Error('No tienes permiso para asignar responsables.');

  const [[actual]] = await pool.query(
    `SELECT i.titulo,
            CONCAT(u.nombre, ' ', u.apellido) AS asignado_actual
     FROM incidencias i LEFT JOIN usuarios u ON u.id_usuario = i.id_usuario_asignado
     WHERE i.id_incidencia = ?`,
    [id_incidencia]
  );
  const [[nuevo]] = await pool.query(
    `SELECT CONCAT(nombre, ' ', apellido) AS nombre_completo FROM usuarios WHERE id_usuario = ?`,
    [id_usuario_asignado]
  );

  await pool.query(
    'UPDATE incidencias SET id_usuario_asignado = ?, fecha_actualizacion = NOW() WHERE id_incidencia = ?',
    [id_usuario_asignado, id_incidencia]
  );

  await pool.query(
    `INSERT INTO historial_incidencias (id_incidencia, id_usuario, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, 'responsable asignado', ?, ?)`,
    [id_incidencia, currentUser.id_usuario, actual.asignado_actual || 'Sin asignar', nuevo.nombre_completo]
  );

  // Notifica al nuevo responsable (si no es quien está haciendo la asignación).
  if (Number(id_usuario_asignado) !== currentUser.id_usuario) {
    await crearNotificacion({
      id_incidencia,
      id_usuario_destino: id_usuario_asignado,
      tipo: 'asignacion',
      mensaje: `Te asignaron la incidencia "${actual.titulo}"`
    });
  }

  return { success: true };
});

// Agrega un comentario a la incidencia
ipcMain.handle('agregar-comentario', async (event, { id_incidencia, comentario }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const [[inc]] = await pool.query(
    'SELECT id_usuario_reporta, id_usuario_asignado FROM incidencias WHERE id_incidencia = ?',
    [id_incidencia]
  );

  if (currentUser.rol === 'Empleado') {
    if (!inc || inc.id_usuario_reporta !== currentUser.id_usuario) {
      throw new Error('No tienes permiso para comentar en esta incidencia.');
    }
  }

  await pool.query(
    'INSERT INTO comentarios_incidencias (id_incidencia, id_usuario, comentario) VALUES (?, ?, ?)',
    [id_incidencia, currentUser.id_usuario, comentario]
  );

  // Notifica al reportero y al responsable (evitando notificar al autor).
  const destinos = new Set([inc.id_usuario_reporta, inc.id_usuario_asignado].filter((v) => v != null));
  destinos.delete(currentUser.id_usuario);
  for (const destino of destinos) {
    await crearNotificacion({
      id_incidencia,
      id_usuario_destino: destino,
      tipo: 'comentario',
      mensaje: `Nuevo comentario en la incidencia #${id_incidencia}`
    });
  }

  return { success: true };
});

// -----------------------------------------------------------------------
// ELIMINACIÓN (parte del CRUD)
// -----------------------------------------------------------------------

// Elimina un comentario. Un Empleado solo puede borrar los suyos; gestores, cualquiera.
ipcMain.handle('eliminar-comentario', async (event, { id_incidencia, id_comentario }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const [fila] = await pool.query(
    'SELECT id_usuario FROM comentarios_incidencias WHERE id_comentario = ? AND id_incidencia = ?',
    [id_comentario, id_incidencia]
  );
  if (!fila.length) return { success: false, message: 'El comentario ya no existe.' };

  const esAutor = fila[0].id_usuario === currentUser.id_usuario;
  if (currentUser.rol === 'Empleado' && !esAutor) {
    throw new Error('Solo puedes eliminar tus propios comentarios.');
  }

  await pool.query(
    'DELETE FROM comentarios_incidencias WHERE id_comentario = ? AND id_incidencia = ?',
    [id_comentario, id_incidencia]
  );

  return { success: true };
});

// Elimina una incidencia completa en una transacción: historial, comentarios y la incidencia.
ipcMain.handle('eliminar-incidencia', async (event, id_incidencia) => {
  if (!currentUser) throw new Error('No hay sesión activa.');
  if (currentUser.rol === 'Empleado') throw new Error('No tienes permiso para eliminar incidencias.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM historial_incidencias WHERE id_incidencia = ?', [id_incidencia]);
    await conn.query('DELETE FROM comentarios_incidencias WHERE id_incidencia = ?', [id_incidencia]);
    await conn.query('DELETE FROM notificaciones WHERE id_incidencia = ?', [id_incidencia]);
    const [resultado] = await conn.query('DELETE FROM incidencias WHERE id_incidencia = ?', [id_incidencia]);
    await conn.commit();
    return { success: true, affected: resultado.affectedRows };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// -----------------------------------------------------------------------
// REPORTES Y ANÁLISIS
// -----------------------------------------------------------------------

ipcMain.handle('get-reportes', async () => {
  if (!currentUser) throw new Error('No hay sesión activa.');
  if (currentUser.rol !== 'Administrador') throw new Error('No tienes permiso para ver los reportes.');

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM incidencias');

  const [porEstado] = await pool.query(`
    SELECT e.nombre AS etiqueta, e.color, COUNT(i.id_incidencia) AS cantidad
    FROM estados e
    LEFT JOIN incidencias i ON i.id_estado = e.id_estado
    GROUP BY e.id_estado
    ORDER BY e.orden
  `);

  const [porCategoria] = await pool.query(`
    SELECT c.nombre AS etiqueta, COUNT(i.id_incidencia) AS cantidad
    FROM incidencias i
    JOIN categorias c ON c.id_categoria = i.id_categoria
    GROUP BY c.id_categoria
    ORDER BY cantidad DESC
  `);

  const [porArea] = await pool.query(`
    SELECT a.nombre AS etiqueta, COUNT(i.id_incidencia) AS cantidad
    FROM incidencias i
    JOIN areas a ON a.id_area = i.id_area
    GROUP BY a.id_area
    ORDER BY cantidad DESC
  `);

  const [[{ promedio_horas }]] = await pool.query(`
    SELECT AVG(TIMESTAMPDIFF(HOUR, fecha_creacion, fecha_resolucion)) AS promedio_horas
    FROM incidencias
    WHERE fecha_resolucion IS NOT NULL
  `);

  // Recurrencias por combinación área + categoría: el mismo tipo de problema
  // repetido en la misma área (2+ veces). Señala problemas estructurales.
  const [recurrentes] = await pool.query(`
    SELECT
      a.nombre AS area,
      c.nombre AS categoria,
      COUNT(*) AS cantidad,
      MAX(i.fecha_creacion) AS ultima_fecha
    FROM incidencias i
    JOIN areas a ON a.id_area = i.id_area
    JOIN categorias c ON c.id_categoria = i.id_categoria
    GROUP BY i.id_area, i.id_categoria
    HAVING COUNT(*) >= 2
    ORDER BY cantidad DESC
  `);

  // Recurrencias solo por área: cualquier área con 2+ incidencias, sin importar
  // si son del mismo tipo. Señala dónde se concentra el trabajo (áreas "calientes").
  const [areasCalientes] = await pool.query(`
    SELECT
      a.nombre AS area,
      COUNT(*) AS cantidad,
      COUNT(DISTINCT i.id_categoria) AS categorias_distintas,
      MAX(i.fecha_creacion) AS ultima_fecha
    FROM incidencias i
    JOIN areas a ON a.id_area = i.id_area
    GROUP BY i.id_area
    HAVING COUNT(*) >= 2
    ORDER BY cantidad DESC
  `);

  // ---------------------------------------------------------------------
  // CUMPLIMIENTO DE SLA
  // De las incidencias ya resueltas, cuántas se resolvieron dentro del plazo
  // pactado por su prioridad. Se usa MINUTE (no HOUR) para que un plazo de 6 h
  // no se altere por redondeo. Solo cuenta fecha_resolucion, es decir,
  // incidencias que pasaron por el estado "Resuelta".
  // ---------------------------------------------------------------------
  const SLA_CLAUSE = 'TIMESTAMPDIFF(MINUTE, i.fecha_creacion, i.fecha_resolucion) <= p.sla_horas * 60';
  const SLA_CUMPLIDO = `SUM(CASE WHEN ${SLA_CLAUSE} THEN 1 ELSE 0 END)`;
  // JOINs base: luego cada consulta añade sus propios JOIN y el WHERE va al final.
  const SLA_FROM = `FROM incidencias i
     JOIN prioridades p ON p.id_prioridad = i.id_prioridad`;
  const SLA_WHERE = 'WHERE i.fecha_resolucion IS NOT NULL';

  const [[cumplimientoGlobal]] = await pool.query(`
    SELECT COUNT(*) AS total, ${SLA_CUMPLIDO} AS a_tiempo,
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, i.fecha_creacion, i.fecha_resolucion)) / 60, 1) AS promedio_horas
    ${SLA_FROM}
    ${SLA_WHERE}
  `);

  const [cumplimientoPorArea] = await pool.query(`
    SELECT a.nombre AS area, COUNT(*) AS total, ${SLA_CUMPLIDO} AS a_tiempo,
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, i.fecha_creacion, i.fecha_resolucion)) / 60, 1) AS promedio_horas,
           ROUND(${SLA_CUMPLIDO} / COUNT(*) * 100, 1) AS porcentaje
    ${SLA_FROM}
     JOIN areas a ON a.id_area = i.id_area
    ${SLA_WHERE}
    GROUP BY a.id_area
    ORDER BY porcentaje ASC
  `);

  const [cumplimientoPorResponsable] = await pool.query(`
    SELECT CONCAT(u.nombre, ' ', u.apellido) AS responsable, COUNT(*) AS total,
           ${SLA_CUMPLIDO} AS a_tiempo,
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, i.fecha_creacion, i.fecha_resolucion)) / 60, 1) AS promedio_horas,
           ROUND(${SLA_CUMPLIDO} / COUNT(*) * 100, 1) AS porcentaje
    ${SLA_FROM}
     JOIN usuarios u ON u.id_usuario = i.id_usuario_asignado
    ${SLA_WHERE}
    GROUP BY u.id_usuario
    ORDER BY porcentaje ASC
  `);

  const [cumplimientoPorPrioridad] = await pool.query(`
    SELECT p.nombre AS prioridad, p.color, p.sla_horas, COUNT(*) AS total,
           ${SLA_CUMPLIDO} AS a_tiempo,
           ROUND(${SLA_CUMPLIDO} / COUNT(*) * 100, 1) AS porcentaje
    ${SLA_FROM}
    ${SLA_WHERE}
    GROUP BY p.id_prioridad
    ORDER BY p.nivel DESC
  `);

  // Abiertas que YA superaron su SLA: el riesgo actual, no el histórico.
  const [abiertasVencidas] = await pool.query(`
    SELECT a.nombre AS area, p.nombre AS prioridad, p.sla_horas,
           COUNT(*) AS cantidad,
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, i.fecha_creacion, NOW()) - p.sla_horas * 60) / 60, 1) AS retraso_promedio_h,
           ROUND(MAX(TIMESTAMPDIFF(MINUTE, i.fecha_creacion, NOW()) - p.sla_horas * 60) / 60, 1) AS retraso_maximo_h
    FROM incidencias i
    JOIN areas a      ON a.id_area = i.id_area
    JOIN prioridades p ON p.id_prioridad = i.id_prioridad
    JOIN estados e    ON e.id_estado = i.id_estado
    WHERE i.fecha_resolucion IS NULL
      AND e.nombre NOT IN ('Resuelta', 'Cerrada')
      AND TIMESTAMPDIFF(MINUTE, i.fecha_creacion, NOW()) > p.sla_horas * 60
    GROUP BY a.id_area, p.id_prioridad
    ORDER BY cantidad DESC
  `);

  const [[{ total_vencidas }]] = await pool.query(`
    SELECT COUNT(*) AS total_vencidas
    FROM incidencias i
    JOIN prioridades p ON p.id_prioridad = i.id_prioridad
    JOIN estados e    ON e.id_estado = i.id_estado
    WHERE i.fecha_resolucion IS NULL
      AND e.nombre NOT IN ('Resuelta', 'Cerrada')
      AND TIMESTAMPDIFF(MINUTE, i.fecha_creacion, NOW()) > p.sla_horas * 60
  `);

  // MySQL devuelve SUM() y ROUND() como DECIMAL (string). Se normalizan a number
  // para que el frontend pueda comparar y formatear sin sorpresas.
  const num = (v, porDefecto = 0) => (v === null || v === undefined ? porDefecto : Number(v));

  const cumplimientoSla = {
    total: num(cumplimientoGlobal.total),
    aTiempo: num(cumplimientoGlobal.a_tiempo),
    porcentaje: cumplimientoGlobal.total
      ? Math.round((num(cumplimientoGlobal.a_tiempo) / num(cumplimientoGlobal.total)) * 1000) / 10
      : null,
    promedioHoras:
      cumplimientoGlobal.promedio_horas !== null
        ? Math.round(num(cumplimientoGlobal.promedio_horas) * 10) / 10
        : null,
    abiertasVencidas: num(total_vencidas),
    porArea: cumplimientoPorArea.map((r) => ({
      area: r.area,
      total: num(r.total),
      aTiempo: num(r.a_tiempo),
      promedioHoras: r.promedio_horas !== null ? Math.round(num(r.promedio_horas) * 10) / 10 : null,
      porcentaje: num(r.porcentaje)
    })),
    porResponsable: cumplimientoPorResponsable.map((r) => ({
      responsable: r.responsable,
      total: num(r.total),
      aTiempo: num(r.a_tiempo),
      promedioHoras: r.promedio_horas !== null ? Math.round(num(r.promedio_horas) * 10) / 10 : null,
      porcentaje: num(r.porcentaje)
    })),
    porPrioridad: cumplimientoPorPrioridad.map((r) => ({
      prioridad: r.prioridad,
      color: r.color,
      slaHoras: num(r.sla_horas),
      total: num(r.total),
      aTiempo: num(r.a_tiempo),
      porcentaje: num(r.porcentaje)
    })),
    vencidasDetalle: abiertasVencidas.map((r) => ({
      area: r.area,
      prioridad: r.prioridad,
      slaHoras: num(r.sla_horas),
      cantidad: num(r.cantidad),
      retrasoPromedioHoras: r.retraso_promedio_h !== null ? Math.round(num(r.retraso_promedio_h) * 10) / 10 : null,
      retrasoMaximoHoras: r.retraso_maximo_h !== null ? Math.round(num(r.retraso_maximo_h) * 10) / 10 : null
    }))
  };

  return {
    total,
    porEstado,
    porCategoria,
    porArea,
    promedioHoras: promedio_horas !== null ? Math.round(promedio_horas * 10) / 10 : null,
    recurrentes,
    areasCalientes,
    cumplimientoSla
  };
});

// -----------------------------------------------------------------------
// NOTIFICACIONES INTERNAS
// -----------------------------------------------------------------------

ipcMain.handle('get-notificaciones', async () => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const [filas] = await pool.query(
    `SELECT n.*, i.titulo AS incidencia_titulo
     FROM notificaciones n
     LEFT JOIN incidencias i ON i.id_incidencia = n.id_incidencia
     WHERE n.id_usuario_destino = ?
     ORDER BY n.fecha_creacion DESC
     LIMIT 40`,
    [currentUser.id_usuario]
  );
  return filas;
});

ipcMain.handle('marcar-notificaciones-leidas', async () => {
  if (!currentUser) return;
  await pool.query(
    'UPDATE notificaciones SET leida = 1 WHERE id_usuario_destino = ? AND leida = 0',
    [currentUser.id_usuario]
  );
  return { success: true };
});

ipcMain.handle('marcar-notificacion-leida', async (event, idNotificacion) => {
  if (!currentUser) return;
  await pool.query(
    'UPDATE notificaciones SET leida = 1 WHERE id_notificacion = ? AND id_usuario_destino = ?',
    [idNotificacion, currentUser.id_usuario]
  );
  return { success: true };
});

// -----------------------------------------------------------------------
// ASISTENTE CON IA (endpoint compatible con OpenAI)
// Configuración (prioridad): variables de entorno IA_API_URL / IA_API_KEY /
// IA_MODEL, o el archivo ia.config.json situado junto a la app.
// -----------------------------------------------------------------------

function leerConfigIA() {
  let archivo = {};
  try {
    const ruta = path.join(__dirname, 'ia.config.json');
    if (fs.existsSync(ruta)) archivo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    console.error('ia.config.json inválido:', err.message);
  }
  return {
    url: process.env.IA_API_URL || archivo.url || 'https://api.openai.com/v1/chat/completions',
    key: process.env.IA_API_KEY || archivo.key || '',
    model: process.env.IA_MODEL || archivo.model || 'gpt-4o-mini'
  };
}

async function llamadaIA(sistema, usuario) {
  const cfg = leerConfigIA();
  if (!cfg.key) {
    throw new Error('La clave de IA no está configurada. Define IA_API_KEY o crea el archivo ia.config.json.');
  }

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.key}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario }
      ],
      temperature: 0.2,
      max_tokens: 1024
    })
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`La IA respondió con error ${res.status}: ${detalle.slice(0, 180)}`);
  }

  const data = await res.json();
  const texto = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
  if (!texto) throw new Error('La IA no devolvió contenido.');
  return texto;
}

function extraerJSON(texto) {
  const sinFences = texto.replace(/```(?:json)?/gi, '').trim();
  const inicio = sinFences.indexOf('{');
  const fin = sinFences.lastIndexOf('}');
  if (inicio === -1 || fin === -1) throw new Error('La IA no devolvió JSON válido.');
  return JSON.parse(sinFences.slice(inicio, fin + 1));
}

// Sugiere categoría y prioridad a partir del título y la descripción.
ipcMain.handle('sugerir-clasificacion', async (event, { titulo, descripcion }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const { categorias, prioridades } = await obtenerCatalogos();
  const nombresCat = categorias.map((c) => c.nombre);
  const nombresPr = prioridades.map((p) => p.nombre);

  const sistema =
    'Eres un clasificador de incidencias de TI de un sistema de gestión laboral. ' +
    'Recibes un título y una descripción de una incidencia. Responde ÚNICAMENTE con JSON válido ' +
    'con exactamente esta forma: {"categoria":"<UNA de las categorías listadas>","prioridad":"<UNA de las prioridades listadas>"}. ' +
    'No añadas texto, marcas de cuadro ni explicaciones.';

  const usuario =
    `Categorías disponibles: ${nombresCat.join(', ')}\n` +
    `Prioridades disponibles: ${nombresPr.join(', ')}\n\n` +
    `Título: ${titulo || ''}\n` +
    `Descripción: ${descripcion || ''}`;

  const texto = await llamadaIA(sistema, usuario);
  const sugerido = extraerJSON(texto);

  const categoriaOK = categorias.find(
    (c) => String(sugerido.categoria || '').toLowerCase() === c.nombre.toLowerCase()
  );
  const prioridadOK = prioridades.find(
    (p) => String(sugerido.prioridad || '').toLowerCase() === p.nombre.toLowerCase()
  );

  return {
    categoria: categoriaOK ? { id: categoriaOK.id_categoria, nombre: categoriaOK.nombre } : null,
    prioridad: prioridadOK ? { id: prioridadOK.id_prioridad, nombre: prioridadOK.nombre } : null
  };
});

// Genera un diagnóstico técnico breve a partir de la incidencia completa.
ipcMain.handle('generar-diagnostico', async (event, idIncidencia) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const { incidencia, historial, comentarios } = await cargarDetalleBasico(idIncidencia);
  if (!incidencia) throw new Error('No se encontró la incidencia.');

  const historialTxt =
    historial.slice(-8).map(
      (h) => `- ${h.campo_modificado}: "${h.valor_anterior}" → "${h.valor_nuevo}" (${h.fecha})`
    ).join('\n') || '- Sin cambios aún';

  const comentariosTxt =
    comentarios.slice(-6).map((c) => `- ${c.nombre} ${c.apellido}: ${c.comentario}`).join('\n') ||
    '- Sin comentarios';

  const sistema =
    'Eres un analista senior de soporte TI. Dada una incidencia con su historial y comentarios, ' +
    'redacta en español un DIAGNÓSTICO técnico breve y accionable con dos secciones: ' +
    '"Causa probable" (2-3 líneas) y "Próximos pasos" (lista de 3-4 pasos concretos). ' +
    'Sé concreto, no inventes datos ni nombres, usa buena ortografía. Máximo 220 palabras.';

  const usuario =
    `Título: ${incidencia.titulo}\n` +
    `Descripción: ${incidencia.descripcion}\n` +
    `Área: ${incidencia.area}\nCategoría: ${incidencia.categoria}\n` +
    `Prioridad: ${incidencia.prioridad}\nEstado: ${incidencia.estado}\n\n` +
    `Historial:\n${historialTxt}\n\nComentarios:\n${comentariosTxt}`;

  return { diagnostico: await llamadaIA(sistema, usuario) };
});

// -----------------------------------------------------------------------
// DETECCIÓN DE DUPLICADOS (registro de incidencia)
// -----------------------------------------------------------------------

const PALABRAS_IRRELEVANTES = new Set([
  'para', 'pero', 'como', 'cuando', 'donde', 'este', 'esta', 'estos', 'estas', 'desde',
  'hacia', 'entre', 'sobre', 'hasta', 'porque', 'tambien', 'también', 'algunas', 'ningun',
  'tengo', 'tiene', 'tener', 'hacer', 'poder', 'quiero', 'necesito', 'estaba', 'estado'
]);

function obtenerTokens(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !PALABRAS_IRRELEVANTES.has(t));
}

// Busca incidencias abiertas con palabras compartidas con el borrador (título + descripción).
ipcMain.handle('buscar-duplicados', async (event, { titulo, descripcion }) => {
  if (!currentUser) throw new Error('No hay sesión activa.');

  const tokens = [...new Set([...obtenerTokens(titulo), ...obtenerTokens(descripcion)])].slice(0, 8);
  if (!tokens.length) return [];

  const esEmpleado = currentUser.rol === 'Empleado';
  const condiciones = tokens.map(() => '(i.titulo LIKE ? OR i.descripcion LIKE ?)').join(' OR ');
  const params = [];
  tokens.forEach((t) => params.push(`%${t}%`, `%${t}%`));

  const [rows] = await pool.query(
    `SELECT i.id_incidencia, i.titulo, i.descripcion, e.nombre AS estado, a.nombre AS area,
            i.fecha_creacion
     FROM incidencias i
     JOIN estados e ON e.id_estado = i.id_estado
     JOIN areas a ON a.id_area = i.id_area
     WHERE ${condiciones}
       AND e.nombre NOT IN ('Resuelta', 'Cerrada')
       ${esEmpleado ? 'AND i.id_usuario_reporta = ?' : ''}
     ORDER BY i.fecha_creacion DESC`,
    esEmpleado ? [...params, currentUser.id_usuario] : params
  );

  const puntuadas = rows
    .map((r) => {
      const fuente = `${r.titulo} ${r.descripcion}`.toLowerCase();
      const coincidencias = tokens.filter((t) => fuente.includes(t)).length;
      return { ...r, coincidencias };
    })
    .filter((r) => r.coincidencias >= 1)
    .sort((a, b) => b.coincidencias - a.coincidencias)
    .slice(0, 5);

  return puntuadas;
});
