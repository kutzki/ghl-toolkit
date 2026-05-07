# Deploying AIO-GHL-MCP to Railway

Railway is the recommended free cloud option for this MCP server. Unlike Render, it does **not** spin down on inactivity — your server is always live and ready for tool calls.

---

## What You Need

- A [Railway account](https://railway.app) (free — requires a GitHub login or email)
- A credit card on file (required to activate the $5/mo free credit — you won't be charged under normal usage)
- Your GHL Private Integrations API key and Location ID

---

## Deploy in 5 Steps

### 1. Push this repo to your GitHub (already done)

Make sure your fork at `github.com/kutzki/ghl-toolkit` is up to date.

### 2. Create a new Railway project

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project**
3. Select **Deploy from GitHub repo**
4. Choose `kutzki/ghl-toolkit`
5. Railway will auto-detect the `railway.json` and start building

### 3. Set Environment Variables

In your Railway project dashboard:
1. Click your service → **Variables** tab
2. Add the following:

```
GHL_API_KEY          = your_private_integrations_api_key
GHL_LOCATION_ID      = your_location_id
GHL_BASE_URL         = https://services.leadconnectorhq.com
NODE_ENV             = production
PORT                 = 8000
```

> Never paste these into the repo. Railway's Variables tab keeps them secure.

### 4. Get Your Public URL

1. In your Railway service, click **Settings** → **Networking**
2. Click **Generate Domain** — Railway gives you a free `*.up.railway.app` URL
3. Your MCP SSE endpoint will be:
   ```
   https://your-app.up.railway.app/sse
   ```

### 5. Connect Your AI Tools

Instead of pointing your AI app config to a local `server.js` file, use the Railway URL:

```json
{
  "mcpServers": {
    "aio-ghl-mcp": {
      "url": "https://your-app.up.railway.app/sse"
    }
  }
}
```

No `command`, no `args`, no local path needed — just the URL. This works in Claude Desktop, Codex CLI, and Antigravity.

---

## Why This Solves the 500+ Tool Problem

When the MCP server is remote (HTTP/SSE), AI clients load tool definitions **lazily** — on demand — rather than dumping all 520 tool schemas into the context window at startup. This dramatically reduces token usage and avoids the "too many tools" warning in Antigravity.

---

## Estimated Monthly Cost

| Resource | Usage | Cost |
|---|---|---|
| RAM (~100MB) | Continuous | ~$0.10/mo |
| CPU (idle proxy) | Minimal | ~$0.20/mo |
| Bandwidth | Light API calls | ~$0.10/mo |
| **Total** | | **~$0.40–$1.00/mo** |

Well within the $5/mo free credit.

---

## Troubleshooting

**Build fails:**
```bash
# Check that all dependencies are in package.json (not just devDependencies)
# Railway runs `npm run build` automatically via railway.json
```

**Health check fails:**
- Make sure your server exposes a `/health` endpoint returning `200 OK`
- Check the Railway build logs for TypeScript errors

**Tools not loading in AI app:**
- Confirm the `/sse` endpoint is reachable in your browser
- Verify all environment variables are set in the Railway Variables tab
- Restart the Railway deployment after changing variables

---

## Redeploying After Changes

Every `git push` to the `main` branch automatically triggers a new Railway build and deploy. No manual steps needed.
