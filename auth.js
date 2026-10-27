// Login for Claude: customer enters their mobile → Nearle login API → their
// customer id. No database: clients, codes and tokens are signed with SECRET_KEY.
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import * as api from './nearle.js';

const ACCESS_TTL = 24 * 3600; // 1 day
const REFRESH_TTL = 180 * 24 * 3600; // 6 months
const CODE_TTL = 5 * 60;
const LOGIN_TTL = 15 * 60;

// ── Signed blobs ──────────────────────────────────────────────────────────

const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (s) => crypto.createHmac('sha256', config.secretKey).update(s).digest('base64url');

function sign(obj) {
  const body = b64(JSON.stringify(obj));
  return `${body}.${mac(body)}`;
}

function verify(token, type) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = mac(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (o.t !== type) return null;
    if (o.exp && o.exp < Date.now() / 1000) return null;
    return o;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

function tokens(customerId) {
  return {
    access_token: sign({ t: 'a', c: customerId, exp: now() + ACCESS_TTL }),
    token_type: 'bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign({ t: 'r', c: customerId, exp: now() + REFRESH_TTL }),
  };
}

// ── OAuth provider (used by the SDK's mcpAuthRouter) ──────────────────────

export const provider = {
  clientsStore: {
    // The client id itself carries the client's details (signed).
    getClient(clientId) {
      const o = verify(clientId, 'cl');
      if (!o) return undefined;
      return { client_id: clientId, client_name: o.n, redirect_uris: o.r, token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
    },
    registerClient(client) {
      const id = sign({ t: 'cl', r: client.redirect_uris, n: client.client_name ?? 'Claude' });
      const { client_secret, client_secret_expires_at, ...rest } = client;
      return { ...rest, client_id: id, client_id_issued_at: now(), token_endpoint_auth_method: 'none' };
    },
  },

  // Show the Nearle login page.
  async authorize(client, params, res) {
    const req = sign({
      t: 'lr', cid: hash(client.client_id), r: params.redirectUri, s: params.state ?? '',
      ch: params.codeChallenge, exp: now() + LOGIN_TTL,
    });
    res.status(200).type('html').send(page({ req }));
  },

  async challengeForAuthorizationCode(client, code) {
    const o = verify(code, 'code');
    if (!o || o.cid !== hash(client.client_id)) throw new Error('Invalid code');
    return o.ch;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const o = verify(code, 'code');
    if (!o || o.cid !== hash(client.client_id)) throw new Error('Invalid code');
    if (redirectUri && redirectUri !== o.r) throw new Error('redirect_uri mismatch');
    return tokens(o.c);
  },

  async exchangeRefreshToken(_client, refreshToken) {
    const o = verify(refreshToken, 'r');
    if (!o) throw new Error('Invalid refresh token');
    return tokens(o.c);
  },

  async verifyAccessToken(token) {
    const o = verify(token, 'a');
    if (!o) {
      const { InvalidTokenError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');
      throw new InvalidTokenError('Invalid or expired token');
    }
    return { token, clientId: 'claude', scopes: [], expiresAt: o.exp, extra: { customerId: o.c } };
  },
};

const hash = (s) => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 16);

// ── Login page ────────────────────────────────────────────────────────────

export const loginRouter = express.Router();
loginRouter.use(express.urlencoded({ extended: false }));

// Simple per-IP limit so numbers can't be tried in bulk.
const tries = new Map();
function limited(ip) {
  const t = Date.now();
  const list = (tries.get(ip) ?? []).filter((x) => t - x < 10 * 60 * 1000);
  list.push(t);
  tries.set(ip, list);
  return list.length > 10;
}

loginRouter.post('/login', async (req, res) => {
  const lr = verify(req.body.req, 'lr');
  if (!lr) return res.status(400).type('html').send(page({ error: 'This login link expired. Go back to Claude and connect again.' }));

  const phone = `${req.body.phone ?? ''}`.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.type('html').send(page({ req: req.body.req, error: 'Enter a valid 10-digit mobile number.' }));
  }
  if (limited(req.ip)) {
    return res.status(429).type('html').send(page({ req: req.body.req, error: 'Too many tries. Wait a few minutes.' }));
  }

  let customerId = null;
  try {
    customerId = await api.loginByPhone(phone);
  } catch {}
  if (!customerId) {
    return res.type('html').send(page({ req: req.body.req, error: 'Could not sign in with this number. Try again.' }));
  }

  const code = sign({ t: 'code', c: customerId, cid: lr.cid, r: lr.r, ch: lr.ch, exp: now() + CODE_TTL });
  const back = new URL(lr.r);
  back.searchParams.set('code', code);
  if (lr.s) back.searchParams.set('state', lr.s);
  res.redirect(302, back.href);
});

const esc = (s) => `${s}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page({ req = '', error = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Nearle Daily · Sign in</title>
<style>
:root{--ink:#1d1630;--muted:#6b6480;--brand:#6c3fd1;--bg:#f6f3fc;--card:#fff;--err:#c62828}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);
font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);padding:16px}
.card{width:100%;max-width:380px;background:var(--card);border-radius:20px;padding:28px 24px;box-shadow:0 8px 30px rgba(60,30,120,.08)}
h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px;font-size:14px}
label{font-size:13px;font-weight:600}
.row{display:flex;align-items:center;border:1.5px solid #ddd5ef;border-radius:12px;margin:6px 0 16px;overflow:hidden}
.row span{padding:0 10px 0 14px;color:var(--muted)}
input{flex:1;border:0;outline:0;padding:14px 12px 14px 0;font-size:17px;letter-spacing:.5px;background:transparent}
.row:focus-within{border-color:var(--brand)}
button{width:100%;border:0;border-radius:12px;padding:14px;background:var(--brand);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.err{background:#fdecec;color:var(--err);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:14px}
small{display:block;margin-top:14px;color:var(--muted);font-size:12px;text-align:center}
</style></head><body><main class="card">
<h1>Nearle Daily</h1><p>Sign in with your Nearle mobile number to order from Claude.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
${req ? `<form method="post" action="/login">
<input type="hidden" name="req" value="${esc(req)}">
<label for="phone">Mobile number</label>
<div class="row"><span>+91</span><input id="phone" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" required autofocus></div>
<button type="submit">Continue</button></form>
<small>Orders go to your saved Nearle address · Cash on Delivery</small>` : ''}
</main></body></html>`;
}
