// seed-usuarios-prueba.js
// Corre esto UNA SOLA VEZ con: node seed-usuarios-prueba.js
// Crea un usuario Empleado y un usuario Encargado de prueba, para poder
// comparar cómo se ve la app con cada rol.

const pool = require('./db');
const bcrypt = require('bcryptjs');

const USUARIOS_A_CREAR = [
  {
    nombre: 'Elena',
    apellido: 'Empleada',
    email: 'empleado@empresa.com',
    password: 'empleado123',
    rol: 'Empleado'
  },
  {
    nombre: 'Carlos',
    apellido: 'Encargado',
    email: 'encargado@empresa.com',
    password: 'encargado123',
    rol: 'Encargado'
  }
];

async function seed() {
  const [areaRows] = await pool.query('SELECT id_area FROM areas LIMIT 1');

  if (!areaRows.length) {
    console.log('❌ Faltan catálogos (areas). Corre primero el script SQL del modelo de datos.');
    process.exit(1);
  }

  for (const u of USUARIOS_A_CREAR) {
    const [rolRows] = await pool.query('SELECT id_rol FROM roles WHERE nombre = ?', [u.rol]);

    if (!rolRows.length) {
      console.log(`❌ No existe el rol "${u.rol}" en la tabla roles. Salté a ${u.email}.`);
      continue;
    }

    const [existente] = await pool.query('SELECT id_usuario FROM usuarios WHERE email = ?', [u.email]);
    if (existente.length) {
      console.log(`⚠️  Ya existe un usuario con el correo ${u.email}, no se creó otro.`);
      continue;
    }

    const hash = await bcrypt.hash(u.password, 10);

    await pool.query(
      `INSERT INTO usuarios (nombre, apellido, email, password_hash, id_rol, id_area)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [u.nombre, u.apellido, u.email, hash, rolRows[0].id_rol, areaRows[0].id_area]
    );

    console.log(`✅ Usuario ${u.rol} creado:`);
    console.log(`   Email:    ${u.email}`);
    console.log(`   Password: ${u.password}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error('Error creando los usuarios:', err.message);
  process.exit(1);
});
