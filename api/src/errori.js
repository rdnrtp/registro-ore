// Errore con codice HTTP e messaggio per l'utente: il gestore degli errori in
// app.js lo trasforma in { errore: messaggio }.
class ErroreHttp extends Error {
  constructor(stato, messaggio) {
    super(messaggio);
    this.stato = stato;
  }
}

module.exports = { ErroreHttp };
