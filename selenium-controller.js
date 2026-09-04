const http = require('http');

const PORT = Number(process.env.PORT || 8080);
const SELENIUM_URL = (process.env.SELENIUM_URL || 'http://interactive-browser.railway.internal:4444').replace(/\/$/, '');
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || '';
const VNC_URL = process.env.VNC_URL || '';
const SITE = (process.env.DISCOURSE_SITE || 'https://community.n8n.io').replace(/\/$/, '');
const TOPIC_TITLE = process.env.TOPIC_TITLE || '';
const TOPIC_BODY = process.env.TOPIC_BODY || '';
const TOPIC_CATEGORY = Number(process.env.TOPIC_CATEGORY || 13);

let sessionId = null;
let postResult = null;
let postError = null;
let preparing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interactive Browser Controller</title></head><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.5">${body}</body></html>`);
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

async function wd(method, path, body) {
  const r = await fetch(`${SELENIUM_URL}${path}`, {
    method,
    headers: body == null ? {} : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { value: text }; }
  if (!r.ok || (data && data.value && data.value.error)) {
    const err = new Error(`WebDriver ${method} ${path} failed: ${r.status} ${text.slice(0, 1200)}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function waitForSelenium(timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`${SELENIUM_URL}/status`);
      if (r.ok) {
        const j = await r.json();
        if (j?.value?.ready) return;
      }
    } catch {}
    await sleep(1500);
  }
  throw new Error('Timed out waiting for Selenium');
}

async function sessionAlive() {
  if (!sessionId) return false;
  try {
    await wd('GET', `/session/${sessionId}/url`);
    return true;
  } catch {
    sessionId = null;
    return false;
  }
}

async function ensureSession() {
  if (await sessionAlive()) return sessionId;
  await waitForSelenium();
  const created = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: ['--disable-dev-shm-usage', '--window-size=1440,900'],
        },
      },
    },
  });
  sessionId = created?.value?.sessionId || created?.sessionId;
  if (!sessionId) throw new Error(`No Selenium session id returned: ${JSON.stringify(created).slice(0, 800)}`);
  await wd('POST', `/session/${sessionId}/timeouts`, { script: 30000, pageLoad: 60000, implicit: 0 });
  return sessionId;
}

async function navigate(target) {
  await ensureSession();
  await wd('POST', `/session/${sessionId}/url`, { url: target });
}

async function executeSync(script, args = []) {
  await ensureSession();
  const out = await wd('POST', `/session/${sessionId}/execute/sync`, { script, args });
  return out?.value;
}

async function executeAsync(script, args = []) {
  await ensureSession();
  const out = await wd('POST', `/session/${sessionId}/execute/async`, { script, args });
  return out?.value;
}

async function prepareBrowser() {
  if (preparing) {
    for (let i = 0; i < 30 && preparing; i++) await sleep(500);
    return { sessionId, vncUrl: VNC_URL };
  }
  preparing = true;
  try {
    await navigate(`${SITE}/login`);
    await sleep(1200);
    return { sessionId, vncUrl: VNC_URL };
  } finally {
    preparing = false;
  }
}

async function currentLogin() {
  await ensureSession();
  const href = await executeSync('return location.href');
  if (!String(href || '').startsWith(SITE)) {
    return { loggedIn: false, href, reason: 'browser is not on the Discourse site' };
  }
  return await executeAsync(`
    const done = arguments[arguments.length - 1];
    fetch('/session/current.json', { credentials: 'same-origin' })
      .then(async (r) => {
        let data = null;
        try { data = await r.json(); } catch {}
        done({ status: r.status, href: location.href, loggedIn: !!(data && data.current_user), currentUser: data && data.current_user ? { username: data.current_user.username, name: data.current_user.name } : null });
      })
      .catch((e) => done({ error: e.message, href: location.href, loggedIn: false }));
  `);
}

async function createTopic() {
  if (postResult) return postResult;
  if (!TOPIC_TITLE || !TOPIC_BODY) throw new Error('TOPIC_TITLE or TOPIC_BODY missing');
  await navigate(`${SITE}/c/jobs/${TOPIC_CATEGORY}`);
  await sleep(1400);
  const login = await currentLogin();
  if (!login?.loggedIn) {
    const err = new Error(`Not logged in to Discourse. Current URL: ${login?.href || 'unknown'}`);
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }

  const result = await executeAsync(`
    const title = arguments[0];
    const raw = arguments[1];
    const category = arguments[2];
    const done = arguments[arguments.length - 1];
    (async () => {
      try {
        const csrfResponse = await fetch('/session/csrf.json', { credentials: 'same-origin' });
        const csrfData = await csrfResponse.json();
        if (!csrfResponse.ok || !csrfData.csrf) {
          return done({ ok: false, stage: 'csrf', status: csrfResponse.status, data: csrfData });
        }
        const response = await fetch('/posts.json', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfData.csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ title, raw, category })
        });
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        done({ ok: response.ok, status: response.status, data });
      } catch (e) {
        done({ ok: false, error: e.message });
      }
    })();
  `, [TOPIC_TITLE, TOPIC_BODY, TOPIC_CATEGORY]);

  if (!result?.ok) throw new Error(`Discourse post failed: ${JSON.stringify(result).slice(0, 1600)}`);
  const d = result.data || {};
  const topicId = d.topic_id || d.topicId;
  const postNumber = d.post_number || 1;
  postResult = {
    ok: true,
    topicId,
    postId: d.id || null,
    postNumber,
    url: topicId ? `${SITE}/t/${topicId}/${postNumber}` : null,
    createdAt: new Date().toISOString(),
  };
  postError = null;
  return postResult;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/') {
    return html(res, 200, `<h1>Interactive Browser Controller</h1><p>Service is running.</p>`);
  }

  if (url.pathname === '/prepare') {
    if (!requireControl(url, res)) return;
    try {
      const prepared = await prepareBrowser();
      return html(res, 200, `<h1>Remote browser ready</h1><p>The browser is open on the n8n Community login page.</p>${prepared.vncUrl ? `<p><a href="${prepared.vncUrl}">Open interactive browser</a></p>` : ''}`);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (url.pathname === '/status') {
    if (!requireControl(url, res)) return;
    try {
      const login = await currentLogin();
      return json(res, 200, { sessionId, login, postResult, postError });
    } catch (e) {
      return json(res, 500, { error: e.message, sessionId, postResult, postError });
    }
  }

  if (url.pathname === '/post') {
    if (!requireControl(url, res)) return;
    try {
      const result = await createTopic();
      return html(res, 200, `<h1>Post created</h1><p>The n8n Community topic was created successfully.</p>${result.url ? `<p><a href="${result.url}">Open the new topic</a></p>` : ''}`);
    } catch (e) {
      postError = e.message;
      const status = e.code === 'NOT_LOGGED_IN' ? 409 : 500;
      return json(res, status, { error: e.message, sessionId, postResult });
    }
  }

  if (url.pathname === '/close') {
    if (!requireControl(url, res)) return;
    try {
      if (sessionId) await wd('DELETE', `/session/${sessionId}`);
    } catch {}
    sessionId = null;
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CONTROLLER] listening on ${PORT}`);
  console.log(`[CONTROLLER] selenium=${SELENIUM_URL}`);
  console.log(`[CONTROLLER] discourse=${SITE}`);

  // Prepare the browser automatically so the user only needs the VNC link.
  (async () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        const prepared = await prepareBrowser();
        console.log(`[CONTROLLER] browser prepared session=${prepared.sessionId}`);
        break;
      } catch (e) {
        console.error(`[CONTROLLER] prepare attempt ${attempt} failed: ${e.message}`);
        await sleep(3000);
      }
    }
  })();

  // Keep the Selenium session active while the user completes login.
  const keepAlive = setInterval(async () => {
    if (!sessionId) return;
    try {
      await wd('GET', `/session/${sessionId}/url`);
    } catch (e) {
      console.error(`[CONTROLLER] keepalive failed: ${e.message}`);
      sessionId = null;
    }
  }, 60000);
  keepAlive.unref();
});
