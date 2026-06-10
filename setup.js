#!/usr/bin/env node

/**
 * AIO-GHL-MCP Setup Wizard
 * Detects installed AI tools and injects MCP server config.
 * Run: npm run setup
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const HOME        = os.homedir();
const PLATFORM    = os.platform(); // 'darwin', 'win32', 'linux'
const SERVER_PATH = path.resolve(__dirname, 'dist', 'server.js');

// ─── Tool config locations ──────────────────────────────────────────────────

const CONFIG_LOCATIONS = {
  claude: {
    label: 'Claude Desktop',
    format: 'json',
    paths: {
      darwin: path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      win32:  path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
      linux:  path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json'),
    },
  },
  codex: {
    label: 'ChatGPT Codex CLI',
    format: 'toml',
    paths: {
      darwin: path.join(HOME, '.codex', 'config.toml'),
      win32:  path.join(HOME, '.codex', 'config.toml'),
      linux:  path.join(HOME, '.codex', 'config.toml'),
    },
  },
  gemini: {
    label: 'Google Gemini CLI',
    format: 'json',
    paths: {
      darwin: path.join(HOME, '.gemini', 'settings.json'),
      win32:  path.join(HOME, '.gemini', 'settings.json'),
      linux:  path.join(HOME, '.gemini', 'settings.json'),
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/** Inject an mcpServers entry into a JSON config file */
function injectJsonConfig(filePath, entryName, entryValue) {
  const config = readJson(filePath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[entryName] = entryValue;
  writeJson(filePath, config);
  console.log(`  ✅ Injected MCP config into: ${filePath}`);
}

/** Append or update an [mcp_servers.aio-ghl-mcp] TOML block */
function injectTomlConfig(filePath, apiKey, locationId) {
  const block = [
    '',
    '[mcp_servers.aio-ghl-mcp]',
    `command = "node"`,
    `args = [${JSON.stringify(SERVER_PATH)}]`,
    '',
    '[mcp_servers.aio-ghl-mcp.env]',
    `GHL_API_KEY = ${JSON.stringify(apiKey)}`,
    `GHL_LOCATION_ID = ${JSON.stringify(locationId)}`,
    `GHL_BASE_URL = "https://services.leadconnectorhq.com"`,
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let existing = '';
  if (fileExists(filePath)) {
    existing = fs.readFileSync(filePath, 'utf8');
    // Remove stale aio-ghl-mcp block if present
    existing = existing.replace(
      /\n?\[mcp_servers\.aio-ghl-mcp\][\s\S]*?(?=\n\[|\n$|$)/,
      '',
    );
  }
  fs.writeFileSync(filePath, existing + block, 'utf8');
  console.log(`  ✅ Injected MCP config into: ${filePath}`);
}

async function confirmPath(label, detectedPath) {
  console.log(`\n  Detected ${label} config at:\n  ${detectedPath}`);
  if (fileExists(detectedPath)) {
    console.log('  ✅ File found.');
    const confirm = await ask('  Use this path? (Y/n): ');
    if (confirm.trim().toLowerCase() === 'n') {
      return (await ask('  Enter the full path to your config file: ')).trim();
    }
    return detectedPath;
  } else {
    console.log('  ⚠️  File not found at detected path.');
    const custom = await ask('  Enter the full path manually (or press Enter to skip): ');
    return custom.trim() || null;
  }
}

// ─── Write .env ─────────────────────────────────────────────────────────────

function writeEnv(vars) {
  const envPath = path.join(__dirname, '.env');
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
  console.log('  ✅ .env file written.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       AIO-GHL-MCP Setup Wizard         ║');
  console.log('╚════════════════════════════════════════╝\n');

  // ── Step 1: Authentication ────────────────────────────────────────────────

  console.log('── Step 1: GoHighLevel Authentication ──────────────────────\n');
  console.log('  How do you want to connect to GHL?\n');
  console.log('  A) Private Integration Token  (simpler — single sub-account)');
  console.log('  B) OAuth 2.0 login            (browser login — works for agency + sub-accounts)\n');
  const authChoice = (await ask('  Enter A or B: ')).trim().toUpperCase();

  let apiKey = '';
  let locationId = '';
  let useOAuth = false;

  if (authChoice === 'B') {
    // ── OAuth path ──────────────────────────────────────────────────────────
    useOAuth = true;
    console.log('\n  To use OAuth you need a GHL Marketplace App:');
    console.log('  1. Go to: https://marketplace.gohighlevel.com');
    console.log('  2. Create an app, set Redirect URL to: http://localhost:8000/auth/callback');
    console.log('  3. Copy Client ID and Client Secret\n');

    const clientId     = (await ask('  GHL Client ID:     ')).trim();
    const clientSecret = (await ask('  GHL Client Secret: ')).trim();

    if (!clientId || !clientSecret) {
      console.error('\n❌ Client ID and Secret are required for OAuth. Exiting.');
      process.exit(1);
    }

    writeEnv({
      GHL_CLIENT_ID: clientId,
      GHL_CLIENT_SECRET: clientSecret,
      GHL_BASE_URL: 'https://services.leadconnectorhq.com',
      MCP_SERVER_PORT: '8000',
      NODE_ENV: 'production',
    });

    console.log('\n  ✅ .env written. Next steps:');
    console.log('     1. Run:  npm start');
    console.log('     2. Open: http://localhost:8000/auth  in your browser');
    console.log('     3. Authorize your GHL account');
    console.log('     4. Add the /mcp URL to your AI client config:\n');
    console.log('        http://localhost:8000/mcp\n');
    console.log('  After authorizing, resume here if you want to auto-configure a desktop AI app.');
    const cont = await ask('  Continue with AI app setup? (Y/n): ');
    if (cont.trim().toLowerCase() === 'n') {
      console.log('\n  Setup partially complete. Complete OAuth flow, then re-run setup or');
      console.log('  add the /mcp URL manually to your AI app config.\n');
      rl.close();
      return;
    }

    // For desktop app config we still need the location ID
    locationId = (await ask('  Enter your GHL Location ID (for desktop app config): ')).trim();
    if (!locationId) {
      console.log('  ⚠️  No location ID — skipping desktop app configuration.\n');
      rl.close();
      return;
    }

  } else {
    // ── Private Integration Token path ──────────────────────────────────────
    console.log('\n  Get your Private Integrations API key from:');
    console.log('  GHL → Settings → Integrations → Private Integrations\n');
    apiKey     = (await ask('  Enter your GHL Private API Key: ')).trim();
    locationId = (await ask('  Enter your GHL Location ID:    ')).trim();

    if (!apiKey || !locationId) {
      console.error('\n❌ API Key and Location ID are required. Exiting.');
      process.exit(1);
    }

    writeEnv({
      GHL_API_KEY: apiKey,
      GHL_LOCATION_ID: locationId,
      GHL_BASE_URL: 'https://services.leadconnectorhq.com',
      MCP_SERVER_PORT: '8000',
      NODE_ENV: 'production',
    });
  }

  // ── Step 2: Build check ──────────────────────────────────────────────────

  if (!fileExists(SERVER_PATH)) {
    console.log('\n⚠️  Built server not found. Running npm run build first...\n');
    const { execSync } = require('child_process');
    try {
      execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
    } catch {
      console.error('❌ Build failed. Troubleshooting steps:');
      console.error('   1. Make sure Node.js 18+ is installed: node --version');
      console.error('   2. Install root deps:  npm install');
      console.error('   3. Install UI deps:    cd src/ui/react-app && npm install && cd ../..');
      console.error('   4. Then try again:     npm run build');
      process.exit(1);
    }
  }

  // ── Step 3: Select AI tools to configure ─────────────────────────────────

  console.log('\n── Step 2: Select Your AI Tools ──────────────────────────\n');
  console.log('  Which AI desktop apps / CLIs do you want to connect?');
  console.log('  (Press Enter for Yes, type n for No)\n');

  const selected = [];
  for (const [key, tool] of Object.entries(CONFIG_LOCATIONS)) {
    const answer = await ask(`  Configure ${tool.label}? (Y/n): `);
    if (answer.trim().toLowerCase() !== 'n') selected.push({ key, tool });
  }

  // ── Step 4: Configure each selected tool ─────────────────────────────────

  console.log('\n── Step 3: Configuring Selected Tools ────────────────────\n');

  // JSON entry for Claude Desktop and Gemini (stdio)
  const stdioEntry = {
    command: 'node',
    args: [SERVER_PATH],
    env: {
      GHL_API_KEY: apiKey || '',
      GHL_LOCATION_ID: locationId,
      GHL_BASE_URL: 'https://services.leadconnectorhq.com',
    },
  };

  for (const { tool } of selected) {
    const detectedPath = tool.paths[PLATFORM] || tool.paths['linux'];
    const resolvedPath = await confirmPath(tool.label, detectedPath);

    if (!resolvedPath) {
      console.log(`  ⏭️  Skipped ${tool.label}.\n`);
      continue;
    }

    try {
      if (tool.format === 'toml') {
        // Codex CLI uses TOML
        if (useOAuth) {
          console.log('  ℹ️  OAuth mode: Codex CLI will need the /mcp HTTP URL instead of stdio.');
          console.log(`     Add this to ${resolvedPath} manually:\n`);
          console.log(`     [mcp_servers.aio-ghl-mcp]`);
          console.log(`     url = "http://localhost:8000/mcp"\n`);
        } else {
          injectTomlConfig(resolvedPath, apiKey, locationId);
        }
      } else {
        injectJsonConfig(resolvedPath, 'aio-ghl-mcp', stdioEntry);
      }
    } catch (err) {
      console.error(`  ❌ Failed to write config: ${err.message}`);
    }
    console.log();
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  console.log('── Setup Complete ────────────────────────────────────────\n');
  console.log('  ✅ AIO-GHL-MCP is ready.');
  console.log('  Restart your AI app(s) to activate the new tools.\n');
  if (useOAuth) {
    console.log('  ⚠️  Remember to complete the OAuth flow:');
    console.log('      npm start → http://localhost:8000/auth\n');
  }
  rl.close();
}

main().catch(err => {
  console.error('\n❌ Setup error:', err.message);
  rl.close();
  process.exit(1);
});
