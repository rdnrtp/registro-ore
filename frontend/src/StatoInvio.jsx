import { numero } from './date.js';
import { dataOra } from './GestioneUtenti.jsx';

const STATI_EMAIL = {
  in_attesa: 'email in partenza',
  inviata: 'email consegnata al server di posta',
  errore: 'email non partita',
};

function TestoEmail({ email }) {
  return (
    <span className={`stato-email ${email.stato}`}>
      {STATI_EMAIL[email.stato] ?? email.stato}
      {email.stato === 'inviata' && email.inviata_il && ` il ${dataOra(email.inviata_il)}`}
      {email.stato === 'in_attesa' && email.errore && ' (nuovo tentativo a breve: il server di posta non risponde)'}
      {email.stato === 'errore' && ': avvisa l’amministratore'}
    </span>
  );
}

// Stato dell'invio di un mese e versioni inviate (dalla più recente).
// io = true nel proprio mese (i testi parlano al collaboratore).
// onScarica(versione) scarica il file di una versione.
export default function StatoInvio({ stato, invii, io, onScarica }) {
  if (!invii?.length) return null;
  const ultimo = invii[0];
  const riaperto = stato !== 'inviato' && ultimo.riaperto_il;
  return (
    <section className="sezione stato-invio" aria-labelledby="titolo-invio">
      <h2 id="titolo-invio">{stato === 'inviato' ? 'Mese inviato' : 'Mese riaperto'}</h2>
      {stato === 'inviato' ? (
        <p>
          {invii.length > 1 ? `Versione ${ultimo.versione}, inviata` : 'Inviato'} il <b>{dataOra(ultimo.inviato_il)}</b> a{' '}
          <b>{ultimo.destinatario}</b>
          {ultimo.copia.length > 0 && <> e in copia a {ultimo.copia.join(', ')}</>}. <TestoEmail email={ultimo.email} />.
        </p>
      ) : (
        riaperto && (
          <div className="avviso">
            <p>
              Riaperto il {dataOra(ultimo.riaperto_il)}
              {ultimo.riaperto_da && ` da ${ultimo.riaperto_da}`}. Motivazione: <q>{ultimo.motivazione}</q>
            </p>
            <p>
              {io ? 'Correggi le registrazioni e invia di nuovo il mese' : 'Il collaboratore deve correggere e inviare di nuovo il mese'}: la
              nuova email dirà che sostituisce quella del {dataOra(ultimo.inviato_il)}.
            </p>
          </div>
        )
      )}
      <details>
        <summary>
          {invii.length === 1 ? 'File inviato' : `Tutte le versioni inviate (${invii.length})`}
        </summary>
        <ul className="elenco-invii">
          {invii.map((v) => (
            <li key={v.versione}>
              <span>
                <b>Versione {v.versione}</b> · {dataOra(v.inviato_il)} · {numero(v.ore)} ore
                {v.sedute > 0 && ` · ${numero(v.sedute)} sedute`}
                <small>
                  <TestoEmail email={v.email} />
                  {v.riaperto_il && ` · riaperta il ${dataOra(v.riaperto_il)}: ${v.motivazione}`}
                </small>
              </span>
              <button type="button" className="collegamento" onClick={() => onScarica(v.versione)}>
                {v.nome_file}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
