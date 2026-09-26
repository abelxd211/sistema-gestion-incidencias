# Sistema de Gestión de Incidencias

Aplicación de escritorio para registrar, asignar y dar seguimiento a incidencias
laborales (TI, soporte, mantenimiento). Construida con **Electron + MySQL**, sin
depender de servicios cloud.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Funcionalidades

**Ciclo de vida de la incidencia**
- Registro con **detección de duplicados** en tiempo real mientras se escribe.
- Clasificación por **área**, **categoría**, **prioridad** e **impacto**.
- Flujo de estados **Pendiente → En proceso → Resuelta → Cerrada**, gestionado con un
  tablero **Kanban** (arrastrar y soltar).
- **Historial completo** de cada cambio: quién, qué campo, valor anterior y nuevo.

**Encargado responsable obligatorio**
- Toda incidencia nace con un responsable asignado; el sistema **no permite cambiar el
  estado** si no hay uno.
- Un Empleado solo puede reportar incidencias **de su propia área**.

**Roles y permisos**
| Capacidad | Empleado | Encargado | Administrador |
|---|:--:|:--:|:--:|
| Registrar incidencia (su área) | ✅ | ✅ | ✅ |
| Ver todas las incidencias | ❌ | ✅ | ✅ |
| Cambiar estado (Kanban) | ❌ | ✅ | ✅ |
| Asignar responsable | ❌ | ✅ | ✅ |
| Comentar / eliminar los propios | ✅ | ✅ | ✅ |
| Editar datos de una incidencia | ❌ | ✅ | ✅ |
| Reportes y análisis | ❌ | ❌ | ✅ |
| Gestión de usuarios | ❌ | ❌ | ✅ |

**Gestión de usuarios (solo Administrador)**
- Alta, edición y **activación/desactivación** de usuarios (desactivar no borra: el
  historial se conserva).
- **Restablecimiento de contraseñas** con cifrado **bcrypt**.
- El área se deriva del rol: Encargados y Administradores se asignan automáticamente a
  *Tecnología / TI*; el Empleado tiene un área propia que limita dónde puede reportar.

**SLA y calidad de servicio**
- Plazos por prioridad: Baja 72 h · Media 48 h · Alta 24 h · Crítica 6 h.
- Alertas de vencimiento en el dashboard, el Kanban y la ficha de la incidencia.
- **Cumplimiento del SLA** en reportes: porcentaje global, por área, por responsable y
  por prioridad, más las abiertas que ya vencieron.

**Inteligencia artificial (opcional)**
- Sugiere **categoría y prioridad** a partir del título y la descripción.
- Genera un **diagnóstico técnico** leyendo el historial y los comentarios.

**Interfaz**
- Modo oscuro, búsqueda global (`Ctrl + K`) y notificaciones internas con campana.

---

## Requisitos

- **Node.js 20+**
- **MySQL** (por ejemplo, [XAMPP](https://www.apachefriends.org/))

## Instalación

```bash
# 1. Clonar
git clone https://github.com/abelxd211/sistema-gestion-incidencias.git
cd sistema-gestion-incidencias

# 2. Instalar dependencias
npm install
```

## Configuración

### 1. Base de datos

Crea la base de datos `gestion_incidencias` y sus tablas. La estructura completa está
documentada en [`docs/esquema-bd.sql`](docs/esquema-bd.sql) (comentarios `CREATE TABLE`
y `INSERT` listos para ejecutar).

```bash
mysql -u root -e "CREATE DATABASE gestion_incidencias CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 2. Credenciales de la base de datos

Por defecto el proyecto usa los valores de XAMPP (`root` sin contraseña). Para
configurar otro servidor, copia `.env.example` y ajusta:

```bash
cp .env.example .env
```

| Variable | Por defecto |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `root` |
| `DB_PASSWORD` | *(vacío)* |
| `DB_NAME` | `gestion_incidencias` |

### 3. Usuario administrador inicial

```bash
npm run seed:admin      # crea admin@empresa.com / admin123
npm run seed:usuarios   # opcional: usuarios de prueba (empleado123, encargado123)
```

> Las contraseñas de los scripts de prueba son **solo para desarrollo**.
> Cámbialas desde la aplicación (Usuarios → 🔑) antes de usar el sistema con datos reales.

### 4. Integración con IA (opcional)

Copia el archivo de ejemplo y pega tu clave:

```bash
cp ia.config.example.json ia.config.json
```

```json
{
  "url": "https://api.groq.com/openai/v1/chat/completions",
  "key": "TU_API_KEY",
  "model": "openai/gpt-oss-120b"
}
```

También puedes usar las variables de entorno `IA_API_URL`, `IA_API_KEY` e `IA_MODEL`
(cualquier endpoint compatible con la API de OpenAI). **Sin clave, el resto del sistema
funciona con normalidad**: solo se deshabilitan las funciones de IA.

## Uso

```bash
npm start
```

Inicia sesión con las credenciales del administrador.

---

## Estructura del proyecto

```
├── main.js              # Proceso principal: ventana, IPC, MySQL, IA
├── preload.js           # Puente seguro (contextIsolation) hacia el renderer
├── db.js                # Pool de conexiones MySQL
├── ui.js                # Helpers compartidos (badges, SLA, fechas, descargas)
├── chrome.js            # Campana de notificaciones, modo oscuro, Ctrl+K
├── toast.js             # Notificaciones visuales
├── styles.css           # Hoja de estilos única (tema claro/oscuro)

├── login.html/js        # Inicio de sesión
├── dashboard.html/js    # Resumen y KPIs  (renderer.js)
├── tablero.html/js      # Kanban con drag & drop
├── nueva.html/js        # Registro de incidencias
├── detalle.html/js      # Ficha: historial, comentarios, edición, IA
├── reportes.html/js     # Reportes, SLA y exportación CSV/Excel
└── usuarios.html/js     # Gestión de usuarios (solo Administrador)
```

## Seguridad

- `contextIsolation` activado y `nodeIntegration` desactivado: el renderer no tiene
  acceso directo a Node.
- Toda consulta pasa por handlers IPC validados en el proceso principal.
- Contraseñas cifradas con **bcrypt**; nunca se almacenan ni se devuelven en claro.
- **Los secrets no se versionan**: `ia.config.json` y `.env` están en `.gitignore`.
  Usa los archivos `*.example.json` / `.env.example` como plantilla.
- Autorización por rol validada **en el backend**, no solo ocultando botones.

## Licencia

MIT © [abelxd211](https://github.com/abelxd211)
