const bcrypt = require('bcryptjs');

const COSTO = 12;
const LUNGHEZZA_MINIMA = 10;

function hashPassword(password) {
  return bcrypt.hash(password, COSTO);
}

function verificaPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verificaPassword, LUNGHEZZA_MINIMA };
