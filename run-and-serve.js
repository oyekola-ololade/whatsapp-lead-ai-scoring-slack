const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const evidenceDir = path.resolve('evidence');
const port = Number(process.env.PORT || 8080);

function contentType(file) {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webm')) return 'video/webm';
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

function startServer(exitCode) {
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    if (raw === '/' || raw === '/index.html') {
      const files = walk(evidenceDir);
      const items = files.map(f => `<li><a href="/evidence/${encodeURI(f)}">${f}</a></li>`).join('');
      const html = `<!doctype html><html><body><h1>n8n Playwright Evidence</h1><p>Playwright exit code: ${exitCode}</p><ul>${items}</ul></body></html>`;
      res.writeHead(exitCode === 0 ? 200 : 500, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (raw.startsWith('/evidence/')) {
      const rel = raw.slice('/evidence/'.length);
      const full = path.resolve(evidenceDir, rel);
      if (!full.startsWith(evidenceDir + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); return res.end('Not found');
      }
      res.writeHead(200, { 'content-type': contentType(full) });
      return fs.createReadStream(full).pipe(res);
    }

    res.writeHead(404); res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[EVIDENCE_SERVER] listening on ${port}`);
    console.log(`[EVIDENCE_RESULT] playwright_exit_code=${exitCode}`);
    for (const f of walk(evidenceDir)) console.log(`[EVIDENCE_FILE] ${f}`);
  });
}

fs.mkdirSync(evidenceDir, { recursive: true });
const child = spawn('npx', ['playwright', 'test', 'e2e/n8n-evidence.spec.js', '--project=chromium'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => startServer(code ?? 1));
child.on('error', (err) => {
  console.error('[PLAYWRIGHT_SPAWN_ERROR]', err);
  startServer(1);
});
