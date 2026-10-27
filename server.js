// Nearle Daily MCP server. Add https://YOUR-HOST/mcp in Claude as a custom connector.
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
    { name: 'nearle-daily', version: '1.1.0' },
    {
      instructions:
        'Nearle Daily: grocery delivery from local stores in Coimbatore. Search products, compare prices across stores, ' +
        'and place Cash on Delivery orders to the customer\'s saved address. Always show the bill (place_order confirm=false) ' +
        'and wait for a clear yes before confirm=true. One store per order.',
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
