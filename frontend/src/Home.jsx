const NOMI_RUOLO = {
  collaboratore: 'Collaboratore',
  responsabile: 'Responsabile di settore',
  amministratore: 'Amministratore',
};

export default function Home({ sessione, onEsci }) {
  const { utente, organizzazione } = sessione;
  return (
    <div className="pagina">
      <header className="barra">
        <span className="organizzazione">{organizzazione.nome}</span>
        <button type="button" className="secondario" onClick={onEsci}>
          Esci
        </button>
      </header>
      <main className="contenuto">
        <h1>
          Ciao, {utente.nome} {utente.cognome}
        </h1>
        <p className="dettaglio">
          {NOMI_RUOLO[utente.ruolo] ?? utente.ruolo} · {organizzazione.nome}
        </p>
      </main>
    </div>
  );
}
