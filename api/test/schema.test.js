// Vincoli dello schema sulle quantità.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparaAmbiente } = require('./helpers');

describe('quantità in time_entries', () => {
  let pool, A;
  let giorno = 0;

  before(async () => {
    ({ pool, A } = await preparaAmbiente());
  });
  after(() => pool.end());

  const inserisci = (attivita, quantita) => {
    giorno += 1;
    return pool.query(
      `INSERT INTO time_entries (organization_id, user_id, activity_id, entry_date, quantity)
       VALUES ($1, $2, $3, make_date(2026, 10, $4), $5)`,
      [A.id, A.collaboratore.id, attivita, giorno, quantita],
    );
  };

  it('le ore accettano i passi di mezz\'ora', async () => {
    await inserisci(A.attivitaOre, 0.5);
    await inserisci(A.attivitaOre, 3);
    await inserisci(A.attivitaOre, 7.5);
  });

  it('le ore rifiutano frazioni diverse dalla mezz\'ora', async () => {
    await assert.rejects(inserisci(A.attivitaOre, 1.2), { code: '23514' });
  });

  it('le sedute accettano solo numeri interi', async () => {
    await inserisci(A.attivitaSedute, 2);
    await assert.rejects(inserisci(A.attivitaSedute, 1.5), { code: '23514' });
  });

  it('zero e valori negativi sono rifiutati', async () => {
    await assert.rejects(inserisci(A.attivitaOre, 0), { code: '23514' });
    await assert.rejects(inserisci(A.attivitaOre, -1), { code: '23514' });
  });

  it('una sola riga per utente, data e attività', async () => {
    const q = `INSERT INTO time_entries (organization_id, user_id, activity_id, entry_date, quantity)
               VALUES ($1, $2, $3, '2026-11-02', 1)`;
    await pool.query(q, [A.id, A.collaboratore.id, A.attivitaOre]);
    await assert.rejects(pool.query(q, [A.id, A.collaboratore.id, A.attivitaOre]), { code: '23505' });
  });
});
