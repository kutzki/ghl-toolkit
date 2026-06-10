/**
 * GoHighLevel MCP Server v2.0 — HTTP / Streamable transport
 *
 * Supports two authentication modes:
 *   1. Static Private Integration Token via GHL_API_KEY env var (existing behavior)
 *   2. OAuth 2.0 via GHL_CLIENT_ID + GHL_CLIENT_SECRET — visit /auth in a browser
 *
 * OAuth quick-start:
 *   1. Create a Marketplace App at marketplace.gohighlevel.com
 *   2. Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, and GHL_REDIRECT_URI in .env
 *   3. Start the server and open http://localhost:8000/auth in your browser
 *   4. Authorize your GHL account — tokens are saved to .ghl-tokens.json
 *   5. Add http://localhost:8000/mcp to your AI client config
 */

import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { randomBytes } from 'crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { EnhancedGHLClient } from './enhanced-ghl-client.js';
import { ToolRegistry } from './tool-registry.js';
import { MCPAppsManager } from './apps/index.js';
import { GHLConfig } from './types/ghl-types.js';
import { CredentialManager } from './auth/credential-manager.js';

dotenv.config();

// ─── Logger ─────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data || {}) }) + '\n');
}

// ─── MCP Stack (lazy — initialized after auth) ───────────────

interface McpStack {
  mcpServer: McpServer;
  mcpTransport: StreamableHTTPServerTransport;
  registry: ToolRegistry;
  appTools: ReturnType<MCPAppsManager['getToolDefinitions']>;
  appsManager: MCPAppsManager;
  totalTools: number;
}

let stack: McpStack | null = null;

async function initMcpStack(credentialManager: CredentialManager): Promise<McpStack> {
  const accessToken = await credentialManager.getAccessToken();
  const locationId = credentialManager.getLocationId();

  if (!locationId) {
    throw new Error(
      'No locationId found. Set GHL_LOCATION_ID in your environment, ' +
      'or re-authenticate via /auth to select a sub-account.'
    );
  }

  const config: GHLConfig = {
    accessToken,
    baseUrl: process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com',
    version: '2021-07-28',
    locationId,
  };

  const ghlClient = new EnhancedGHLClient(config, () => credentialManager.getAccessToken());

  await ghlClient.testConnection();
  log('info', 'GHL API connection verified', { locationId });

  const mcpServer = new McpServer(
    { name: 'ghl-mcp-server', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );

  const registry = new ToolRegistry(ghlClient);
  const toolCount = registry.registerAll(mcpServer);
  log('info', `Registered ${toolCount} GHL tools`);

  const appsManager = new MCPAppsManager(ghlClient);
  const appTools = appsManager.getToolDefinitions();
  const registeredNames = new Set(registry.getAllToolNames());
  let appToolCount = 0;

  for (const tool of appTools) {
    if (registeredNames.has(tool.name)) continue;
    const meta = (tool as any)._meta;
    mcpServer.registerTool(
      tool.name,
      {
        title: tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: tool.description || '',
        annotations: {
          readOnlyHint: tool.name.startsWith('view_'),
          destructiveHint: false,
          idempotentHint: tool.name.startsWith('view_'),
          openWorldHint: true,
        },
        _meta: meta,
      },
      async (args: any) => {
        try {
          const result = await appsManager.executeTool(tool.name, args || {});
          return {
            content: result.content || [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result.structuredContent,
          };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
        }
      },
    );
    appToolCount++;
  }

  const totalTools = toolCount + appToolCount;
  log('info', `Total tools registered: ${totalTools}`);

  const mcpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(mcpTransport);

  return { mcpServer, mcpTransport, registry, appTools, appsManager, totalTools };
}

// ─── OAuth CSRF state store ──────────────────────────────────
// Maps state token → expiry (ms). Short-lived; cleared on use or expiry.
const pendingOAuthStates = new Map<string, number>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOAuthState(): string {
  const state = randomBytes(16).toString('hex');
  // Sweep expired states to bound map size
  const now = Date.now();
  for (const [s, exp] of pendingOAuthStates) {
    if (now > exp) pendingOAuthStates.delete(s);
  }
  pendingOAuthStates.set(state, now + OAUTH_STATE_TTL_MS);
  return state;
}

function consumeOAuthState(state: string | undefined): boolean {
  if (!state) return false;
  const expiry = pendingOAuthStates.get(state);
  if (!expiry || Date.now() > expiry) return false;
  pendingOAuthStates.delete(state);
  return true;
}

// ─── HTML helpers ────────────────────────────────────────────

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Auth page HTML helpers ──────────────────────────────────

function authPage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — GHL Toolkit</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem 2.5rem;max-width:480px;width:90%;text-align:center}
  h1{margin:0 0 .5rem;font-size:1.5rem;font-weight:700}
  p{color:#94a3b8;margin:.75rem 0 1.5rem;line-height:1.6}
  .btn{display:inline-block;background:#6366f1;color:#fff;padding:.75rem 1.75rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem;margin:.5rem}
  .btn:hover{background:#4f46e5}
  .btn.secondary{background:#334155;color:#e2e8f0}
  .btn.secondary:hover{background:#475569}
  .badge{display:inline-block;background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;padding:.25rem .75rem;border-radius:99px;font-size:.8rem;margin-bottom:1rem}
  .badge.warn{background:#f59e0b22;color:#f59e0b;border-color:#f59e0b44}
  .badge.err{background:#ef444422;color:#ef4444;border-color:#ef444444}
  code{background:#0f172a;border:1px solid #334155;border-radius:6px;padding:.2rem .5rem;font-size:.85rem;word-break:break-all}
  .meta{margin-top:1.5rem;font-size:.8rem;color:#475569}
</style></head><body><div class="card">${body}</div></body></html>`;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const port = parseInt(process.env.PORT || process.env.MCP_SERVER_PORT || '8000');
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const redirectUri = process.env.GHL_REDIRECT_URI || `${baseUrl}/auth/callback`;

  const credentialManager = new CredentialManager(
    process.env.GHL_CLIENT_ID || '',
    process.env.GHL_CLIENT_SECRET || '',
    redirectUri,
  );

  const authenticated = credentialManager.initialize();

  if (authenticated) {
    log('info', 'Credentials found — initializing MCP stack');
    try {
      stack = await initMcpStack(credentialManager);
    } catch (err: any) {
      log('error', 'Failed to initialize MCP stack', { error: err.message });
      // Don't crash — let the server start so /auth routes are reachable
      stack = null;
    }
  } else {
    log('info', 'No credentials found — server starting in auth-pending mode');
    if (credentialManager.isOAuthConfigured()) {
      log('info', `Open ${baseUrl}/auth in a browser to connect your GHL account`);
    } else {
      log('warn', 'Neither GHL_API_KEY nor GHL_CLIENT_ID+SECRET are set. Set one to use the server.');
    }
  }

  // ── Express App ──────────────────────────────────────────

  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('CORS not allowed'));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'mcp-session-id'],
    credentials: true,
  }));

  app.use(express.json());
  app.use((req, _res, next) => { log('debug', `${req.method} ${req.path}`); next(); });

  // Optional bearer-token gate for MCP endpoints.
  // Set MCP_SECRET=<some-token> in .env to require callers to present
  // "Authorization: Bearer <token>" when hitting /mcp or /sse.
  // Leave unset (default) for localhost-only deployments.
  const mcpSecret = process.env.MCP_SECRET;
  function requireMcpSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!mcpSecret) return next(); // gate disabled
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== mcpSecret) {
      res.status(401).json({ error: 'unauthorized', message: 'Valid MCP_SECRET bearer token required.' });
      return;
    }
    next();
  }

  // ── OAuth Routes ─────────────────────────────────────────

  // Redirect the browser to GHL's authorization page
  app.get('/auth', (_req, res) => {
    if (!credentialManager.isOAuthConfigured()) {
      res.status(400).send(authPage('OAuth Not Configured', `
        <span class="badge err">OAuth Not Configured</span>
        <h1>Missing OAuth credentials</h1>
        <p>To use OAuth, add these to your <code>.env</code> file:</p>
        <p><code>GHL_CLIENT_ID=your_client_id<br>GHL_CLIENT_SECRET=your_client_secret</code></p>
        <p>Create a Marketplace App at <a href="https://marketplace.gohighlevel.com" style="color:#6366f1">marketplace.gohighlevel.com</a> to get these values.</p>
        <p>Alternatively, set <code>GHL_API_KEY</code> to use a Private Integration Token instead.</p>
      `));
      return;
    }

    const state = generateOAuthState();
    const authUrl = credentialManager.getAuthorizationUrl(state);
    res.redirect(authUrl);
  });

  // GHL redirects back here with ?code=...
  app.get('/auth/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    // Validate CSRF state token before doing anything with the code
    if (!consumeOAuthState(state)) {
      log('warn', 'OAuth callback: invalid or missing state parameter');
      res.status(400).send(authPage('Invalid Request', `
        <span class="badge err">Invalid Request</span>
        <h1>Invalid or expired authorization request</h1>
        <p>The state parameter is missing or expired. Please start the authorization flow again.</p>
        <a href="/auth" class="btn">Start Over</a>
      `));
      return;
    }

    if (error) {
      log('warn', 'OAuth error from GHL', { error });
      res.status(400).send(authPage('Authorization Failed', `
        <span class="badge err">Authorization Failed</span>
        <h1>GHL returned an error</h1>
        <p><code>${escapeHtml(error)}</code></p>
        <a href="/auth" class="btn">Try Again</a>
      `));
      return;
    }

    if (!code) {
      res.status(400).send(authPage('Bad Request', `
        <span class="badge err">Bad Request</span>
        <h1>No authorization code received</h1>
        <a href="/auth" class="btn">Start Over</a>
      `));
      return;
    }

    try {
      const tokens = await credentialManager.handleCallback(code);
      log('info', 'OAuth tokens saved', { userType: tokens.userType, locationId: tokens.locationId });

      // Re-initialize MCP stack with new credentials
      stack = await initMcpStack(credentialManager);
      log('info', `MCP stack ready: ${stack.totalTools} tools`);

      const locationId = tokens.locationId || process.env.GHL_LOCATION_ID || '(none)';
      const mcpUrl = `${baseUrl}/mcp`;

      res.send(authPage('Connected!', `
        <span class="badge">Connected</span>
        <h1>GoHighLevel Connected!</h1>
        <p>
          ${tokens.userType === 'Company' ? 'Agency account' : 'Sub-account'} authorized successfully.
          ${tokens.locationId ? `Location ID: <code>${tokens.locationId}</code>` : ''}
        </p>
        <p>Add this MCP server URL to your AI client:</p>
        <p><code>${mcpUrl}</code></p>
        <a href="/auth/status" class="btn secondary">View Status</a>
        <div class="meta">${stack.totalTools} tools available &bull; Tokens auto-refresh every 24 hours</div>
      `));
    } catch (err: any) {
      log('error', 'OAuth callback failed', { error: err.message });
      res.status(500).send(authPage('Error', `
        <span class="badge err">Error</span>
        <h1>Something went wrong</h1>
        <p>${escapeHtml(err.message)}</p>
        <a href="/auth" class="btn">Try Again</a>
      `));
    }
  });

  // JSON status endpoint
  app.get('/auth/status', (_req, res) => {
    res.json({
      ...credentialManager.getStatus(),
      mcpReady: stack !== null,
      tools: stack?.totalTools ?? 0,
      oauthConfigured: credentialManager.isOAuthConfigured(),
      authUrl: credentialManager.isOAuthConfigured() ? `${baseUrl}/auth` : null,
    });
  });

  // Logout: clear stored tokens
  app.post('/auth/logout', (_req, res) => {
    credentialManager.logout();
    stack = null;
    log('info', 'OAuth tokens cleared');
    res.json({ success: true, message: 'Logged out. Visit /auth to reconnect.' });
  });

  // ── MCP Streamable HTTP Endpoint ─────────────────────────

  app.all('/mcp', requireMcpSecret, async (req, res) => {
    if (!stack) {
      const isAuthPending = !credentialManager.isAuthenticated();
      res.status(401).json({
        error: isAuthPending ? 'not_authenticated' : 'initializing',
        message: isAuthPending
          ? `GHL account not connected. Visit ${baseUrl}/auth to authorize.`
          : 'MCP stack is initializing, please retry in a moment.',
        authUrl: credentialManager.isOAuthConfigured() ? `${baseUrl}/auth` : null,
      });
      return;
    }

    try {
      await stack.mcpTransport.handleRequest(req, res, req.body);
    } catch (err: any) {
      log('error', 'Streamable HTTP error', { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Legacy SSE Endpoint ──────────────────────────────────

  const handleSSE = async (req: express.Request, res: express.Response) => {
    if (!stack) {
      res.status(401).json({ error: 'not_authenticated', authUrl: `${baseUrl}/auth` });
      return;
    }

    const { appsManager, registry } = stack;
    const appTools = stack.appTools;

    try {
      const sseServer = new McpServer(
        { name: 'ghl-mcp-server', version: '2.0.0' },
        { capabilities: { tools: {} } },
      );

      const sseRegistry = new ToolRegistry(registry.ghlClient);
      sseRegistry.registerAll(sseServer);

      const sseRegistered = new Set(sseRegistry.getAllToolNames());
      for (const tool of appTools) {
        if (sseRegistered.has(tool.name)) continue;
        const meta = (tool as any)._meta;
        sseServer.registerTool(
          tool.name,
          {
            title: tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: tool.description || '',
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
            _meta: meta,
          },
          async (args: any) => {
            try {
              const result = await appsManager.executeTool(tool.name, args || {});
              return { content: result.content || [{ type: 'text' as const, text: JSON.stringify(result) }] };
            } catch (err: any) {
              return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
            }
          },
        );
      }

      const transport = new SSEServerTransport('/sse', res);
      await sseServer.connect(transport);
      req.on('close', () => log('info', 'SSE connection closed'));
    } catch (err: any) {
      log('error', 'SSE error', { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: 'Failed to establish SSE connection' });
      else res.end();
    }
  };

  app.get('/sse', requireMcpSecret, handleSSE);
  app.post('/sse', requireMcpSecret, handleSSE);

  // ── REST Info Endpoints ──────────────────────────────────

  const startTime = Date.now();

  app.get('/', (_req, res) => {
    const status = credentialManager.getStatus();
    res.json({
      name: 'GoHighLevel MCP Server',
      version: '2.0.0',
      status: stack ? 'running' : (status.authenticated ? 'initializing' : 'auth_pending'),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      auth: status,
      endpoints: {
        mcp: '/mcp (Streamable HTTP)',
        sse: '/sse (Legacy SSE)',
        health: '/health',
        auth: credentialManager.isOAuthConfigured() ? '/auth (OAuth login)' : null,
        authStatus: '/auth/status',
        tools: '/tools',
      },
      tools: stack?.totalTools ?? 0,
    });
  });

  app.get('/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: stack ? 'healthy' : (credentialManager.isAuthenticated() ? 'initializing' : 'auth_pending'),
      version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      tools: stack?.totalTools ?? 0,
      authenticated: credentialManager.isAuthenticated(),
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      },
    });
  });

  app.get('/tools', (_req, res) => {
    if (!stack) {
      res.status(401).json({ error: 'not_authenticated', authUrl: `${baseUrl}/auth` });
      return;
    }
    const allToolDefs = stack.registry.getAllToolDefinitions(stack.appTools);
    res.json({ tools: allToolDefs, count: allToolDefs.length });
  });

  app.post('/tools/call', async (req, res) => {
    if (!stack) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    const { name, arguments: args } = req.body;
    if (!name) { res.status(400).json({ error: 'Missing tool name' }); return; }

    try {
      const result = await stack.registry.callTool(name, args || {});
      if (result === undefined) {
        if (stack.appsManager.isAppTool(name)) {
          res.json({ result: await stack.appsManager.executeTool(name, args || {}) });
          return;
        }
        res.status(404).json({ error: `Unknown tool: ${name}` });
        return;
      }
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: `Tool execution failed: ${err.message}` });
    }
  });

  // ── Start Server ─────────────────────────────────────────

  app.listen(port, '0.0.0.0', () => {
    console.log('🚀 GoHighLevel MCP Server v2.0');
    console.log('═══════════════════════════════════════════════');
    console.log(`🌐 Server:          http://0.0.0.0:${port}`);
    console.log(`📡 MCP endpoint:    http://0.0.0.0:${port}/mcp`);
    console.log(`🔗 Legacy SSE:      http://0.0.0.0:${port}/sse`);
    if (stack) {
      console.log(`🛠️  Tools ready:     ${stack.totalTools}`);
    } else if (credentialManager.isOAuthConfigured()) {
      console.log(`🔐 Auth required:   http://0.0.0.0:${port}/auth`);
    } else {
      console.log(`⚠️  No credentials configured — set GHL_API_KEY or GHL_CLIENT_ID+SECRET`);
    }
    console.log('═══════════════════════════════════════════════');
  });
}

process.on('SIGINT', () => { log('info', 'Shutting down (SIGINT)'); process.exit(0); });
process.on('SIGTERM', () => { log('info', 'Shutting down (SIGTERM)'); process.exit(0); });

main().catch((err) => {
  log('error', 'Fatal error', { error: err.message, stack: err.stack });
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
