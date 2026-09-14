import { createServer } from 'node:http';

export function startHttp(port: number, getSessionCount: () => number) {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: getSessionCount() }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, '0.0.0.0');
  return server;
}
