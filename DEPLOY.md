# Deploying GFS AI search on Render (search.gfs-app.com)

## 1. Put the code in a Git repo
Create a **private** GitHub repo (e.g. `gfs-ai-search`) and push this folder. `.gitignore` already keeps
`.env`, logs and `catalog.db` out of the repo. Never commit keys.

## 2. Create the service
Render dashboard -> **New + -> Blueprint** -> choose the repo. Render reads `render.yaml` and asks for:

| Variable | What to enter |
|---|---|
| `BC_STORE_HASH` | the store to index: live = `4g34p1xoch`, sandbox = `30u8hht1vo` |
| `BC_ACCESS_TOKEN` | token of a BigCommerce API account for that store with **Products: read-only** (Settings -> API accounts -> Create) |
| `ANTHROPIC_API_KEY` | optional; turns on Ask AI (platform.claude.com -> API keys) |

Pick the **Starter** (always-on) plan. The 2 GB disk holds the catalog index.

On first start the service builds the index in the background (about 5-10 minutes for ~26k products);
`/health` shows `index.ready`. After that it re-syncs itself every night around 03:00 UTC and keeps serving the old
index if a refresh ever fails.

## 3. Custom address
Service -> Settings -> Custom Domains -> add `search.gfs-app.com`. Render shows a CNAME target;
add that CNAME record at GoDaddy (DNS for gfs-app.com). Render issues the HTTPS certificate itself.

## 4. Hook up the store
In the theme, load `https://search.gfs-app.com/ai-search.js` and call
`GFSAISearch.attach(inputElement, { api: 'https://search.gfs-app.com', siteBase: 'https://globalfuelingsystems.com' })`.

## Limits and safety
* `ALLOWED_ORIGINS` limits which websites' browsers may call the API.
* Ask AI is capped per visitor per hour and per day (`ASK_PER_IP_HOUR`, `ASK_DAILY_CAP`).
  Plain search makes no AI calls and costs nothing per query.
* Set a monthly spend limit on the Anthropic account as a backstop.
