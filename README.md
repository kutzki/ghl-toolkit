# AIO-GHL-MCP

> **The All-In-One GoHighLevel MCP Server** — plug into any AI CLI or desktop app via the Model Context Protocol.

This server gives any compatible AI agent direct, natural-language access to your entire GoHighLevel CRM — contacts, pipelines, calendars, invoices, voice AI, social media, and 500+ tools across 45 categories. Works out of the box with **Claude Desktop**, **ChatGPT Codex CLI**, and **Google Gemini CLI (Antigravity)**.

**Authentication options:**
- **Private Integration Token** (simplest) — generate in GHL Settings → Integrations → Private Integrations
- **OAuth 2.0** (browser login) — start the HTTP server and visit `/auth` to connect via your GHL account

---

## ✅ Compatible AI Platforms

| Platform | Transport | Config File |
|---|---|---|
| **Claude Desktop** | `stdio` | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| **ChatGPT Codex CLI** | `stdio` | `~/.codex/config.toml` |
| **Google Gemini CLI** | `stdio` | `~/.gemini/settings.json` |
| **Any MCP HTTP Client** | `HTTP/SSE` | Point to `http://localhost:8000/mcp` |

All platforms share the same MCP tool schema.

---

## 🚀 Quick Start (3 commands)

```bash
git clone https://github.com/kutzki/ghl-toolkit.git
cd ghl-toolkit
npm install
npm run setup
```

`npm run setup` handles everything interactively:
- Asks whether you want a **Private Integration Token** or **OAuth 2.0** login
- Writes your `.env` file
- Builds the server (including the React dashboard)
- Detects which AI apps are installed and injects the config automatically
- Restart your AI app when prompted — done

**No cloud account, no monthly bill, no manual config editing required.**

---

## Manual Setup (if you prefer)

<details>
<summary>Click to expand manual steps</summary>

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

**Option A — Private Integration Token (simplest):**

Open `.env` and set:

```bash
GHL_API_KEY=your_private_integrations_api_key
GHL_LOCATION_ID=your_location_id
GHL_BASE_URL=https://services.leadconnectorhq.com
```

> Get these from GHL → **Settings → Integrations → Private Integrations**.
> Copy the API key and your Location ID from Settings → Company → Locations.

**Option B — OAuth 2.0 (browser login, works for agency + sub-accounts):**

Set `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET` in `.env` (from your GHL Marketplace App), then:

```bash
npm run build && npm start
# Open http://localhost:8000/auth in your browser
```

Tokens are saved to `.ghl-tokens.json` (gitignored) and auto-refreshed.

### 3. Build

```bash
npm run build
```

### 4. Add to your AI app config

For **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "aio-ghl-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ghl-toolkit/dist/server.js"],
      "env": {
        "GHL_API_KEY": "your_key",
        "GHL_BASE_URL": "https://services.leadconnectorhq.com",
        "GHL_LOCATION_ID": "your_location_id"
      }
    }
  }
}
```

For **Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.aio-ghl-mcp]
command = "node"
args = ["/absolute/path/to/ghl-toolkit/dist/server.js"]

[mcp_servers.aio-ghl-mcp.env]
GHL_API_KEY = "your_key"
GHL_LOCATION_ID = "your_location_id"
GHL_BASE_URL = "https://services.leadconnectorhq.com"
```

For **Gemini CLI** (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "aio-ghl-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ghl-toolkit/dist/server.js"],
      "env": {
        "GHL_API_KEY": "your_key",
        "GHL_LOCATION_ID": "your_location_id",
        "GHL_BASE_URL": "https://services.leadconnectorhq.com"
      }
    }
  }
}
```

Restart your AI app after saving.

</details>

---

## 🔑 GoHighLevel API Scopes

When creating your Private Integration in GHL, enable the following scopes:

- `contacts.readonly` / `contacts.write`
- `conversations.readonly` / `conversations.write`
- `opportunities.readonly` / `opportunities.write`
- `calendars.readonly` / `calendars.write`
- `locations.readonly` / `locations.write`
- `blogs.readonly` / `blogs.write`
- `invoices.readonly` / `invoices.write`
- `payments.readonly`
- `products.readonly` / `products.write`
- `workflows.readonly`
- `campaigns.readonly`
- `social_media_posting.readonly` / `social_media_posting.write`
- `custom_objects.readonly` / `custom_objects.write`
- `users.readonly`

> You can always add more scopes later by editing your Private Integration.

---

## 🛠️ What You Can Do (500+ Tools, 45 Categories)

### Natural Language Examples

```
"Find all contacts tagged VIP who haven't been contacted in 30 days and send them an SMS"
```

```
"Create an opportunity for John Smith, $15k deal, add to Enterprise pipeline"
```

```
"Check calendar availability for Tuesday and book a discovery call with Sarah at 2pm"
```

```
"List all unpaid invoices from last month and send payment links via text"
```

```
"Analyze the last 50 customer conversations and summarize the most common objections"
```

### Tool Categories

| Category | Tools | What It Covers |
|---|---|---|
| Contact Management | 31 | CRUD, tasks, notes, tags, workflows |
| Messaging & Conversations | 20 | SMS, email, call recordings, transcripts |
| Opportunities / Pipeline | 10 | Stages, pipelines, followers |
| Calendar & Appointments | 14 | Booking, availability, block slots |
| Invoices & Billing | 39 | Templates, recurring, estimates, text2pay |
| Payments | 20 | Orders, transactions, subscriptions, coupons |
| Social Media | 17 | Post, schedule, manage across 6 platforms |
| Location Management | 24 | Sub-accounts, custom fields, tags |
| Products & Store | 28 | Products, inventory, shipping zones |
| Blog Management | 7 | Create, schedule, SEO validation |
| Voice AI | 11 | Agents, actions, call logs |
| Email Marketing | 5 | Campaigns, templates |
| Custom Objects | 9 | Schema, records, search |
| Workflows | 8 | Create, publish, clone, delete |
| Workflow Builder | 7 | ⚠️ Experimental — full CRUD via internal API (see below) |
| Surveys | 2 | Manage surveys and submissions |
| Proposals & Documents | 4 | Send proposals and templates |
| Marketplace | 7 | App installs, billing charges |
| Custom Menus | 5 | White-label menu management |
| OAuth / Agency | 2 | Installed locations, location token exchange |
| Automation & Events | 4 | Webhook URL, event types, contact timeline |

> **⚠️ Workflow Builder tools** use GHL's private internal web-app API (`backend.leadconnectorhq.com`) — not the public REST API. This is undocumented, unsupported, and may violate GHL's Terms of Service for third-party apps. It can break without notice. To use these tools you must supply `GHL_REFRESH_TOKEN` (or Firebase credentials) and `GHL_USER_ID` in your `.env`. All other 490+ tools use only the official public API.

---

## 📁 Project Structure

```
ghl-toolkit/
├── src/
│   ├── tools/               # 500+ GHL tool implementations (45 categories)
│   │   ├── contact-tools.ts
│   │   ├── conversation-tools.ts
│   │   ├── calendar-tools.ts
│   │   ├── opportunity-tools.ts
│   │   ├── invoice-tools.ts
│   │   └── ...
│   ├── auth/
│   │   ├── credential-manager.ts  # Auth priority: API key → OAuth tokens
│   │   ├── oauth.ts               # GHL OAuth 2.0 helpers
│   │   └── token-store.ts         # Secure token persistence (.ghl-tokens.json)
│   ├── clients/
│   │   └── ghl-api-client.ts      # Core GHL API client
│   ├── enhanced-ghl-client.ts     # Connection pooling, TTL cache, retry
│   ├── tool-registry.ts           # Auto-discovers and routes all tool modules
│   ├── types/
│   │   └── ghl-types.ts           # TypeScript definitions
│   ├── server.ts                  # stdio MCP server (desktop apps)
│   └── main.ts                    # HTTP MCP server + OAuth routes
├── integrations/
│   ├── claude-desktop/
│   │   └── claude_desktop_config.json
│   ├── codex/
│   │   └── codex-mcp.json
│   └── gemini-cli/
│       └── settings.json
├── .env.example
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 🧪 Development Scripts

```bash
npm run build          # Build React UI + compile TypeScript
npm run dev            # Dev server with hot reload
npm start              # Production HTTP server (with OAuth /auth routes)
npm run start:stdio    # stdio server for desktop apps
npm run start:http     # Alias for npm start
npm test               # Run tests
npm run test:coverage  # Coverage report
```

---

## 🔧 Troubleshooting

**Build fails with `Cannot find module` or Vite errors:**
```bash
# Install the React sub-package dependencies first
cd src/ui/react-app && npm install && cd ../..
npm run build
```

**`No credentials found` error on startup:**
- Option A: ensure `GHL_API_KEY` and `GHL_LOCATION_ID` are set in your `.env`
- Option B: run `npm start` and visit `http://localhost:8000/auth` to connect via OAuth

**`No location ID found` error:**
- Set `GHL_LOCATION_ID` in your `.env`, or re-authenticate via the HTTP server (`/auth`) and select a sub-account

**Tools not showing in Claude Desktop:**
- Confirm the `args` path in your config file points to the compiled `dist/server.js` (absolute path)
- Restart Claude Desktop after editing the config

---

## ☁️ Optional: Cloud Deployment

If you want to share access across a team or connect remote clients, you can deploy the HTTP server anywhere that runs Node.js:

- **Railway** — `railway up` (free tier available)
- **Render** — Connect GitHub repo, set build/start commands
- **Docker** — `docker build -t aio-ghl-mcp . && docker run -p 8000:8000 aio-ghl-mcp`
- **Any VPS** — DigitalOcean, Hetzner, etc.

For remote clients, use the SSE endpoint:
```
https://your-server-url/sse
```

---

## 🔐 Security Notes

- Never commit your `.env` file — it's already in `.gitignore`
- Use a **Private Integrations API key**, not a standard GHL API key
- Your credentials stay on your machine when running locally via stdio
- For cloud deploys, set env vars through your hosting provider's dashboard

---

## 🤝 Contributing

Pull requests welcome. Please:
- Add tests for new tools
- Follow existing TypeScript patterns
- Update the tool catalog table in this README if adding a new category

---

## 📄 License

ISC License. See [LICENSE](LICENSE) for details.

---

## 📚 References

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [GoHighLevel API Docs](https://highlevel.stoplight.io/)
- [Original project by @mastanley13](https://github.com/mastanley13/GoHighLevel-MCP)
- [Extended by @BusyBee3333](https://github.com/BusyBee3333)
