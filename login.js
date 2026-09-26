// login.js
const form = document.getElementById('form-login');
const mensajeError = document.getElementById('mensaje-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  mensajeError.textContent = '';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const resultado = await window.api.login({ email, password });

  if (resultado.success) {
    window.location.href = 'dashboard.html';
  } else {
    mensajeError.textContent = resultado.message;
  }
});
