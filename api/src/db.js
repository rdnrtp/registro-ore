const { Pool } = require('pg');

// pg restituisce i numeric come stringhe: per le quantità (al massimo 5 cifre,
// un decimale) la conversione a Number è sicura.
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Le date (senza ora) restano stringhe 'AAAA-MM-GG': niente fusi orari.
require('pg').types.setTypeParser(1082, (v) => v);

function creaPool(opzioni = {}) {
  return new Pool({ max: 10, ...opzioni });
}

module.exports = { creaPool };
