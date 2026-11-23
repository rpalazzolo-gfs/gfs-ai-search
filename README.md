# GFS AI search

Smarter store search: part numbers (incl. cross-references), keywords with typo fixes and brand awareness,
and an optional "Ask AI" for plain-English questions. See `DEPLOY.md` to host it on Render.

Local use:
- `python3 server.py` -> http://127.0.0.1:8787 (demo page at `/`)
- `python3 sync.py` rebuilds the catalog index (`BC_ACCESS_TOKEN` + `BC_STORE_HASH` env vars, or `BC_TOKEN_FILE=<path to secrets.stencil.json>` for local runs)
- `.env` (see `.env.example`) can hold `ANTHROPIC_API_KEY` for Ask AI
