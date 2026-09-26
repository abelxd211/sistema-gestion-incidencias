// seed-admin.js
// Corre esto UNA SOLA VEZ con: node seed-admin.js
// Crea el primer usuario administrador para poder iniciar sesión.

const pool = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  const [rolRows] = await pool.query("SELECT id_rol FROM roles WHERE nombre = 'Administrador'");
  const [areaRows] = await pool.query('SELECT id_area FROM areas LIMIT 1');

  if (!rolRows.length || !areaRows.length) {
    console.log('❌ Faltan catálogos (roles/areas). Corre primero el script SQL del modelo de datos.');
    process.exit(1);
  }

  const email = 'admin@empresa.com';
  const passwordPlano = 'admin123'; // cámbiala luego de probar

  const [existente] = await pool.query('SELECT id_usuario FROM usuarios WHERE email = ?', [email]);
  if (existente.length) {
    console.log('⚠️  Ya existe un usuario con ese correo, no se creó otro.');
    process.exit(0);
  }

  const hash = await bcrypt.hash(passwordPlano, 10);

  await pool.query(
    `INSERT INTO usuarios (nombre, apellido, email, password_hash, id_rol, id_area)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['Admin', 'Principal', email, hash, rolRows[0].id_rol, areaRows[0].id_area]
  );

  console.log('✅ Usuario administrador creado:');
  console.log('   Email:    ' + email);
  console.log('   Password: ' + passwordPlano);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Error creando el usuario:', err.message);
  process.exit(1);
});
