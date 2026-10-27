// Nearle Daily MCP server. Add https://YOUR-HOST/mcp in Claude as a custom connector.
import fs from 'node:fs';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { config } from './config.js';
import { provider, loginRouter } from './auth.js';
import { registerTools } from './tools.js';

if (!config.secretKey || config.secretKey.length < 32) {
  console.error('Set SECRET_KEY (32+ random characters) in the environment.');
  process.exit(1);
}

const base = new URL(config.publicUrl);
const mcpUrl = new URL('/mcp', base);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => res.send('Nearle Daily MCP server is running.'));

// Logo and product photos for the Nearle card inside Claude.
const LOGO = fs.readFileSync(new URL('./logo.png', import.meta.url));
app.get('/logo.png', (_req, res) => {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(LOGO);
});

const imgCache = new Map(); // url → { type, body, at }
app.get('/img', async (req, res) => {
  const u = `${req.query.u ?? ''}`;
  let url;
  try {
    url = new URL(u);
  } catch {
    return res.status(400).end();
  }
  if (!/^https?:$/.test(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)) return res.status(400).end();
  const send = (hit) => {
    res.set({ 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.send(hit.body);
  };
  const hit = imgCache.get(url.href);
  if (hit) return send(hit);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/')) return res.status(404).end();
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 3 * 1024 * 1024) return res.status(413).end();
    const entry = { type, body };
    if (body.length < 400 * 1024) {
      imgCache.set(url.href, entry);
      if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
    }
    send(entry);
  } catch {
    res.status(404).end();
  }
});

// OAuth: discovery, client registration, /authorize, /token
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: base,
    baseUrl: base,
    resourceServerUrl: mcpUrl,
    resourceName: 'Nearle Daily',
    serviceDocumentationUrl: new URL('/', base),
  }),
);
app.use(loginRouter);

const auth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
});

app.post('/mcp', auth, async (req, res) => {
  const server = new McpServer(
    { name: 'nearle-daily', version: '1.2.0' },
    {
      instructions:
        'Nearle Daily: grocery delivery from local stores in Coimbatore. Search products, compare prices across stores, ' +
        'and place Cash on Delivery orders to the customer\'s saved address. Always show the bill (place_order confirm=false) ' +
        'and wait for a clear yes before confirm=true. One store per order. ' +
        'The tools show the user rich Nearle cards (photos, prices, Add buttons, bill), so keep your text short: one or two lines ' +
        'with your recommendation (e.g. cheapest store) instead of repeating the products or bill as tables.',
    },
  );
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

app.all('/mcp', (_req, res) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }),
);

app.listen(config.port, () => console.log(`Nearle MCP on :${config.port} → ${mcpUrl.href}`));
