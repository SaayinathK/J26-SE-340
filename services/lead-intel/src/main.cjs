const http = require('node:http');
const service = process.env.COMPONENT_NAME;
const server = http.createServer((request, response) => {
  response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ service, status: 'not_implemented', ready: false }));
});
server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log(service + ': awaiting implementation.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
