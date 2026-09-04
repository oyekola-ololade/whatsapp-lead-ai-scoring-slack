const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const evidenceDir = path.resolve('evidence');
const port = Number(process.env.PORT || 8080);
const n8nPort = 5678;
const n8nBaseUrl = `http://127.0.0.1:${n8nPort}`;
const ownerEmail = 'validation-owner@example.com';

function contentType(file) {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webm')) return 'video/webm';
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.txt') || file.endsWith('.log')) return 'text/plain; charset=utf-8';
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

function makePassword() {
  return `${crypto.randomBytes(18).toString('base64url')}Aa1!`;
}

function bcryptHash(password) {
  const result = spawnSync('htpasswd', ['-bnBC', '12', '', password], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`htpasswd failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim().replace(/^:/, '').replace(/:$/, '');
}

function waitForN8n(timeoutMs = 180000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${n8nBaseUrl}/healthz`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(3000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for n8n to start'));
      setTimeout(check, 1500);
    };
    check();
  });
}

function startEvidenceServer(exitCode) {
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    if (raw === '/' || raw === '/index.html') {
      const items = walk(evidenceDir).map((f) => `<li><a href="/evidence/${encodeURI(f)}">${f}</a></li>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>n8n Playwright Evidence</title></head><body><h1>n8n Playwright Evidence</h1><p>Playwright exit code: ${exitCode}</p><ul>${items}</ul></body></html>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
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
  server.listen(port, '0.0.0.0', () => console.log(`[EVIDENCE_SERVER] listening on ${port}`));
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const password = makePassword();
  const passwordHash = bcryptHash(password);
  const encryptionKey = crypto.randomBytes(32).toString('hex');

  const n8nEnv = {
    ...process.env,
    N8N_PORT: String(n8nPort),
    N8N_PROTOCOL: 'http',
    N8N_HOST: '127.0.0.1',
    N8N_LISTEN_ADDRESS: '0.0.0.0',
    N8N_EDITOR_BASE_URL: n8nBaseUrl,
    N8N_WEBHOOK_URL: n8nBaseUrl,
    N8N_SECURE_COOKIE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_ENCRYPTION_KEY: encryptionKey,
    N8N_INSTANCE_OWNER_MANAGED_BY_ENV: 'true',
    N8N_INSTANCE_OWNER_EMAIL: ownerEmail,
    N8N_INSTANCE_OWNER_FIRST_NAME: 'Validation',
    N8N_INSTANCE_OWNER_LAST_NAME: 'Owner',
    N8N_INSTANCE_OWNER_PASSWORD_HASH: passwordHash,
  };

  const n8nLog = fs.createWriteStream(path.join(evidenceDir, 'n8n.log'), { flags: 'a' });
  const n8n = spawn('./node_modules/.bin/n8n', ['start'], { env: n8nEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  n8n.stdout.pipe(n8nLog);
  n8n.stderr.pipe(n8nLog);
  n8n.stdout.on('data', (chunk) => process.stdout.write(`[n8n] ${chunk}`));
  n8n.stderr.on('data', (chunk) => process.stderr.write(`[n8n] ${chunk}`));

  let playwrightExit = 1;
  try {
    await waitForN8n();
    console.log('[VALIDATION] n8n is ready; starting Playwright');
    const testEnv = { ...process.env, N8N_BASE_URL: n8nBaseUrl, N8N_EMAIL: ownerEmail, N8N_PASSWORD: password };
    const pwLog = fs.createWriteStream(path.join(evidenceDir, 'playwright.log'), { flags: 'a' });
    const child = spawn('./node_modules/.bin/playwright', ['test', 'e2e/n8n-evidence.spec.js', '--project=chromium'], { env: testEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(pwLog);
    child.stderr.pipe(pwLog);
    child.stdout.on('data', (chunk) => process.stdout.write(`[playwright] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[playwright] ${chunk}`));
    playwrightExit = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });
  } catch (error) {
    fs.writeFileSync(path.join(evidenceDir, 'runner-error.txt'), `${error.stack || error}\n`);
    console.error('[VALIDATION_ERROR]', error);
  } finally {
    if (!n8n.killed) n8n.kill('SIGTERM');
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({
      playwrightExitCode: playwrightExit,
      completedAt: new Date().toISOString(),
      workflow: 'T1_WhatsApp_Lead_AI_Scoring_Slack',
      mode: 'disposable-local-n8n-plus-playwright'
    }, null, 2));
    console.log(`[EVIDENCE_RESULT] playwright_exit_code=${playwrightExit}`);
    for (const f of walk(evidenceDir)) console.log(`[EVIDENCE_FILE] ${f}`);
    startEvidenceServer(playwrightExit);
  }
}

main().catch((error) => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'fatal-error.txt'), `${error.stack || error}\n`);
  console.error('[FATAL]', error);
  startEvidenceServer(1);
});
