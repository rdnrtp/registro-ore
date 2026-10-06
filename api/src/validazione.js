const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(valore) {
  return typeof valore === 'string' && UUID.test(valore);
}

function normalizzaEmail(email) {
  return String(email).trim().toLowerCase();
}

module.exports = { isUuid, normalizzaEmail };
