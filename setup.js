#!/usr/bin/env node

/**
 * AIO-GHL-MCP Setup Script
 * Automatically detects installed AI tools and injects MCP server config.
 * Run: npm run setup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const HOME = os.homedir();
const PLATFORM = os.platform(); // 'darwin', 'win32', 'linux'
const SERVER_PATH = path.resolve(__dirname, 'dist', 'server.js');

// ─── Known config locations per platform ───────────────────────────────────

const CONFIG_LOCATIONS = {
  claude: {
    label: 'Claude Desktop',
    paths: {
      darwin: path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      win32:  path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
      linux:  path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json'),
    }
  },
  codex: {
    label: 'ChatGPT Codex CLI',
    paths: {
      darwin: path.join(HOME, '.codex', 'config.json'),
      win32:  path.join(HOME, '.codex', 'config.json'),
      linux:  path.join(HOME, '.codex', 'config.json'),
    }
  },
  antigravity: {
    label: 'Google Antigravity (Gemini CLI)',
    paths: {
      darwin: path.join(HOME, '.config', 'gemini', 'settings.json'),
      win32:  path.join(HOME, '.config', 'gemini', 'settings.json'),
      linux:  path.join(HOME, '.config', 'gemini', 'settings.json'),
    }
  }
};

// ─── MCP entry to inject ────────────────────────────────────────────────────

function mcpEntry(apiKey, locationId) {
  return {
    command: 'node',
    args: [SERVER_PATH],
    env: {
      GHL_API_KEY: apiKey,
      GHL_BASE_URL: 'https://services.leadconnectorhq.com',
      GHL_LOCATION_ID: locationId
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

async function confirmPath(label, detectedPath) {
  console.log(`\n  Detected ${label} config at:\n  ${detectedPath}`);
  if (fileExists(detectedPath)) {
    console.log('  ✅ File found.');
    const confirm = await ask('  Use this path? (Y/n): ');
    if (confirm.trim().toLowerCase() === 'n') {
      const custom = await ask('  Enter the full path to your config file: ');
      return custom.trim();
    }
    return detectedPath;
  } else {
    console.log('  ⚠️  File not found at detected path.');
    const custom = await ask('  Enter the full path manually (or press Enter to skip): ');
    return custom.trim() || null;
  }
}

// ─── Write .env ─────────────────────────────────────────────────────────────

function writeEnv(apiKey, locationId) {
  const envPath = path.join(__dirname, '.env');
  const content = [
    `GHL_API_KEY=${apiKey}`,
    `GHL_LOCATION_ID=${locationId}`,
    `GHL_BASE_URL=https://services.leadconnectorhq.com`,
    `NODE_ENV=production`,
    `PORT=8000`
  ].join('\n');
  fs.writeFileSync(envPath, content, 'utf8');
  console.log('  ✅ .env file written.');
}

// ─── Inject into a config file ──────────────────────────────────────────────

function injectConfig(filePath, entry) {
  const config = readJson(filePath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers['aio-ghl-mcp'] = entry;
  writeJson(filePath, config);
  console.log(`  ✅ Injected MCP config into:\n     ${filePath}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       AIO-GHL-MCP Setup Wizard         ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Check build exists
  if (!fileExists(SERVER_PATH)) {
    console.log('⚠️  Built server not found. Running npm run build first...\n');
    const { execSync } = require('child_process');
    try {
      execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
    } catch {
      console.error('❌ Build failed. Run `npm run build` manually and try again.');
      process.exit(1);
    }
  }

  // GHL credentials
  console.log('── Step 1: GoHighLevel Credentials ──────────────────────\n');
  console.log('  Get your Private Integrations API key from:');
  console.log('  GHL → Settings → Integrations → Private Integrations\n');
  const apiKey = await ask('  Enter your GHL Private API Key: ');
  const locationId = await ask('  Enter your GHL Location ID: ');

  if (!apiKey.trim() || !locationId.trim()) {
    console.error('\n❌ API Key and Location ID are required. Exiting.');
    process.exit(1);
  }

  writeEnv(apiKey.trim(), locationId.trim());

  // Which tools to configure
  console.log('\n── Step 2: Select Your AI Tools ──────────────────────────\n');
  console.log('  Which AI desktop apps / CLIs do you want to connect?');
  console.log('  (Press Enter for Yes, type n for No)\n');

  const entry = mcpEntry(apiKey.trim(), locationId.trim());
  const selected = [];

  for (const [key, tool] of Object.entries(CONFIG_LOCATIONS)) {
    const answer = await ask(`  Configure ${tool.label}? (Y/n): `);
    if (answer.trim().toLowerCase() !== 'n') {
      selected.push({ key, tool });
    }
  }

  // Configure each selected tool
  console.log('\n── Step 3: Configuring Selected Tools ────────────────────\n');

  for (const { tool } of selected) {
    const detectedPath = tool.paths[PLATFORM] || tool.paths['linux'];
    const resolvedPath = await confirmPath(tool.label, detectedPath);

    if (!resolvedPath) {
      console.log(`  ⏭️  Skipped ${tool.label}.\n`);
      continue;
    }

    try {
      injectConfig(resolvedPath, entry);
    } catch (err) {
      console.error(`  ❌ Failed to write config: ${err.message}`);
    }
    console.log();
  }

  // Done
  console.log('── Setup Complete ────────────────────────────────────────\n');
  console.log('  ✅ AIO-GHL-MCP is ready.');
  console.log('  Restart your AI app(s) to activate the new tools.\n');
  console.log('  If anything looks wrong, check the integrations/ folder');
  console.log('  for manual config templates.\n');

  rl.close();
}

main().catch(err => {
  console.error('\n❌ Setup error:', err.message);
  rl.close();
  process.exit(1);
});
