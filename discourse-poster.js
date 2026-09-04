const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const SITE = (process.env.DISCOURSE_SITE || 'https://community.n8n.io').replace(/\/$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || '';
const CLIENT_ID = process.env.DISCOURSE_CLIENT_ID || 'oyekola-browser-action-runner';
const APPLICATION_NAME = process.env.DISCOURSE_APPLICATION_NAME || 'Oyekola Browser Action Runner';
const TOPIC_TITLE = process.env.TOPIC_TITLE || '';
const TOPIC_BODY = process.env.TOPIC_BODY || '';
const TOPIC_CATEGORY = Number(process.env.TOPIC_CATEGORY || 13);

if (!PUBLIC_BASE_URL) console.warn('[WARN] PUBLIC_BASE_URL is not set yet');
if (!CONTROL_TOKEN) console.warn('[WARN] CONTROL_TOKEN is not set');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const nonce = crypto.randomBytes(24).toString('hex');
const state = crypto.randomBytes(24).toString('hex');

let userApiKey = null;
let authInfo = null;
let postResult = null;
let postError = null;
let posting = false;

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser Action Runner</title></head><body style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.5">${body}</body></html>`);
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj, null, 2));
}

function requireControl(url, res) {
  if (!CONTROL_TOKEN || url.searchParams.get('token') !== CONTROL_TOKEN) {
    json(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}

function requestJson(method, targetUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers: {
        'user-agent': 'Oyekola-Browser-Action-Runner/1.0',
        'accept': 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          resolve({ status: resp.statusCode, headers: resp.headers, data: parsed });
        } else {
          const err = new Error(`HTTP ${resp.statusCode}: ${typeof parsed === 'string' ? parsed.slice(0, 1000) : JSON.stringify(parsed)}`);
          err.status = resp.statusCode;
          err.data = parsed;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createTopic() {
  if (!userApiKey || posting || postResult) return;
  if (!TOPIC_TITLE || !TOPIC_BODY) {
    postError = 'TOPIC_TITLE or TOPIC_BODY missing';
    return;
  }
  posting = true;
  postError = null;
  try {
    const response = await requestJson('POST', `${SITE}/posts.json`, {
      'User-Api-Key': userApiKey,
      'User-Api-Client-Id': CLIENT_ID,
    }, {
      title: TOPIC_TITLE,
      raw: TOPIC_BODY,
      category: TOPIC_CATEGORY,
    });
    const d = response.data || {};
    const topicId = d.topic_id || d.topicId;
    const postNumber = d.post_number || 1;
    postResult = {
      ok: true,
      topicId,
      postId: d.id,
      postNumber,
      url: topicId ? `${SITE}/t/${topicId}/${postNumber}` : null,
      createdAt: new Date().toISOString(),
    };
    console.log('[POST_SUCCESS]', JSON.stringify({ topicId, postId: d.id, postNumber }));
  } catch (err) {
    postError = err.message;
    console.error('[POST_ERROR]', err.message);
  } finally {
    posting = false;
  }
}

function buildAuthUrl() {
  if (!PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is missing');
  const callback = `${PUBLIC_BASE_URL}/auth/callback?state=${encodeURIComponent(state)}`;
  const u = new URL(`${SITE}/user-api-key/new`);
  u.searchParams.set('auth_redirect', callback);
  u.searchParams.set('application_name', APPLICATION_NAME);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('scopes', 'read,write');
  u.searchParams.set('public_key', publicKey);
  u.searchParams.set('padding', 'oaep');
  return u.toString();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/') {
    return html(res, 200, `<h1>Browser Action Runner</h1><p>Service is running.</p>`);
  }

  if (url.pathname === '/auth/start') {
    if (!requireControl(url, res)) return;
    try {
      const target = buildAuthUrl();
      res.writeHead(302, { location: target, 'cache-control': 'no-store' });
      return res.end();
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/auth/callback') {
    if (url.searchParams.get('state') !== state) return html(res, 403, '<h1>Invalid authorization state</h1>');
    const encrypted = url.searchParams.get('payload');
    if (!encrypted) return html(res, 400, '<h1>Authorization payload missing</h1>');
    try {
      const normalized = encrypted.replace(/ /g, '+');
      const decrypted = crypto.privateDecrypt({
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1',
      }, Buffer.from(normalized, 'base64')).toString('utf8');
      const payload = JSON.parse(decrypted);
      if (payload.nonce !== nonce) throw new Error('Nonce mismatch');
      if (!payload.key) throw new Error('User API key missing from payload');
      userApiKey = payload.key;
      authInfo = { api: payload.api || null, authorizedAt: new Date().toISOString() };
      await createTopic();
      if (postResult && postResult.url) {
        return html(res, 200, `<h1>Authorized and posted</h1><p>The n8n Community topic was created successfully.</p><p><a href="${postResult.url}">Open the new topic</a></p><p>You can close this tab.</p>`);
      }
      return html(res, 500, `<h1>Authorized, but posting failed</h1><p>${String(postError || 'Unknown posting error').replace(/[<&>]/g, '')}</p>`);
    } catch (err) {
      console.error('[AUTH_ERROR]', err.message);
      return html(res, 400, `<h1>Authorization failed</h1><p>${String(err.message).replace(/[<&>]/g, '')}</p>`);
    }
  }

  if (url.pathname === '/status') {
    if (!requireControl(url, res)) return;
    return json(res, 200, {
      ready: Boolean(PUBLIC_BASE_URL && CONTROL_TOKEN && TOPIC_TITLE && TOPIC_BODY),
      authorized: Boolean(userApiKey),
      authInfo,
      posting,
      postResult,
      postError,
      site: SITE,
      category: TOPIC_CATEGORY,
      title: TOPIC_TITLE,
    });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[RUNNER] listening on ${PORT}`);
  console.log(`[RUNNER] target=${SITE} category=${TOPIC_CATEGORY}`);
});
