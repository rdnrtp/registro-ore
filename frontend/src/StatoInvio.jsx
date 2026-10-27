import { numero } from './date.js';
import { dataOra } from './GestioneUtenti.jsx';
import { euro } from './Spese.jsx';

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

// Storico degli invii di un mese: stato attuale e tutte le versioni inviate
// (dalla più recente), con sostituzioni, riaperture e file da scaricare.
// io = true nel proprio mese (i testi parlano al collaboratore).
// onScarica(versione) scarica il file di una versione, onScaricaSpese(versione)
// il PDF delle spese partito con lei.
export default function StatoInvio({ stato, invii, io, onScarica, onScaricaSpese }) {
  if (!invii?.length) return null;
  const ultimo = invii[0];
  const riaperto = stato !== 'inviato';
  return (
    <section className="sezione stato-invio" aria-labelledby="titolo-invio">
      <h2 id="titolo-invio">Storico degli invii</h2>
      {riaperto ? (
        <p className="avviso">
          <b>Mese riaperto</b> il {dataOra(ultimo.riaperto_il)}
          {ultimo.riaperto_da && ` da ${ultimo.riaperto_da}`}.{' '}
          {io ? 'Correggi le registrazioni e invia di nuovo il mese' : 'Il collaboratore deve correggere e inviare di nuovo il mese'}: la
          nuova email dirà che sostituisce la versione {ultimo.versione}.
        </p>
      ) : (
        <p>
          Inviato il <b>{dataOra(ultimo.inviato_il)}</b> a <b>{ultimo.destinatario}</b>
          {ultimo.copia.length > 0 && <>, in copia a {ultimo.copia.join(', ')}</>}.
        </p>
      )}
      <ol className="elenco-invii" reversed>
        {invii.map((v) => (
          <li key={v.versione}>
            <div className="invio-testa">
              <b>Versione {v.versione}</b>
              {v.versione === ultimo.versione && !riaperto && <span className="etichetta inviato">in vigore</span>}
              {v.riaperto_il && <span className="etichetta riaperto">riaperta</span>}
            </div>
            <span>
              Inviata il {dataOra(v.inviato_il)}
              {v.versione > 1 ? ` · sostituisce la versione ${v.versione - 1}` : ' · primo invio'} · {numero(v.ore)} ore
              {v.sedute > 0 && ` · ${numero(v.sedute)} sedute`}
            </span>
            <small>
              <TestoEmail email={v.email} />
            </small>
            {v.riaperto_il && (
              <small className="motivazione">
                Riaperta il {dataOra(v.riaperto_il)}
                {v.riaperto_da && ` da ${v.riaperto_da}`}. Motivazione: «{v.motivazione}»
              </small>
            )}
            <button type="button" className="piccolo neutro scarica-versione" onClick={() => onScarica(v.versione)}>
              Scarica {v.nome_file}
            </button>
            {v.spese && (
              <>
                <span>
                  {v.spese.annullate
                    ? 'Spese: nessuna (annullate quelle inviate prima)'
                    : `Spese: ${v.spese.numero}, totale ${euro(v.spese.totale_centesimi)}`}
                </span>
                <small>
                  <TestoEmail email={v.spese.email} />
                </small>
                {!v.spese.annullate && (
                  <button type="button" className="piccolo neutro scarica-versione" onClick={() => onScaricaSpese(v.versione)}>
                    Scarica {v.spese.nome_file}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
