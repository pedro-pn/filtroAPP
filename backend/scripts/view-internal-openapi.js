// Visualizador do contrato da API interna, só para desenvolvimento (spec 042, D2).
// Sobe um servidor em 127.0.0.1 que serve docs/api/openapi.internal.json com o
// Redoc. Não faz parte do app e não existe em produção.
//   npm run contract:view            → http://127.0.0.1:4010
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'api', 'openapi.internal.json');
const port = Number(process.env.CONTRACT_VIEW_PORT || 4010);
const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>API interna — filtroAPP</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<redoc spec-url="/openapi.internal.json"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@2.5.0/bundles/redoc.standalone.js"></script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/openapi.internal.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  return res.end(page);
}).listen(port, '127.0.0.1', () => console.log(`Contrato da API interna em http://127.0.0.1:${port} (Ctrl+C para sair)`));
