import http from 'node:http';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const match = req.url?.match(/^\/worlds\/(wrld_[0-9a-f-]+)$/i);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    return;
  }
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        id: match[1].toLowerCase(),
        name: 'Mock Live World / 月の桟橋',
        authorName: 'Proxy Tester',
        thumbnailUrl: null,
        description: 'This response came from the local mock backend proxy, not the demo registry.',
        capacity: 24,
      }),
    );
  }, 450);
});

server.listen(5199, '127.0.0.1', () => console.log('mock world api on http://127.0.0.1:5199'));
