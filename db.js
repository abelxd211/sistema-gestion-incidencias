// db.js
// Conexión a la base de datos MySQL creada en XAMPP (gestion_incidencias).
// Usa un pool de conexiones: más eficiente que abrir/cerrar conexión en cada consulta.
//
// Los datos de conexión se pueden sobreescribir con variables de entorno
// (ver .env.example). Los valores por defecto son los de XAMPP en local.

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',          // usuario por defecto de XAMPP
  password: process.env.DB_PASSWORD || '',      // XAMPP no trae contraseña por defecto
  database: process.env.DB_NAME || 'gestion_incidencias',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
