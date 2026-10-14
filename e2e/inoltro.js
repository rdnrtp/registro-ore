// Nel Compose il frontend è http://web, che per il browser non è un'origine
// "sicura": niente service worker. Le prove usano allora http://localhost:8088
// e questo inoltro TCP lo collega a web:80 (WEB_INTERNO=web:80).
const net = require('node:net');

module.exports = async function avviaInoltro() {
  const interno = process.env.WEB_INTERNO;
  if (!interno) return undefined;
  const [host, porta] = interno.split(':');
  const server = net.createServer((entrata) => {
    const uscita = net.connect(Number(porta), host);
    entrata.pipe(uscita).pipe(entrata);
    const chiudi = () => {
      entrata.destroy();
      uscita.destroy();
    };
    entrata.on('error', chiudi);
    uscita.on('error', chiudi);
  });
  await new Promise((resolve) => server.listen(8088, '127.0.0.1', resolve));
  return () => new Promise((resolve) => server.close(resolve));
};
