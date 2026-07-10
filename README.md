# Webhook Handler

Catches incoming webhook requests on any method/content-type. Runs standalone first (so you can verify webhooks are arriving), then stores payloads into the existing Supabase `webhook_queue` table once env vars are added.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /webhook` | Main webhook receiver (accepts any HTTP method) |
| `POST /webhook/:source` | Same, but tags the event with a source name, e.g. `/webhook/emailbison` |
| `GET /events` | Last 100 received events (in-memory) — each shows `stored: true/false` and the Supabase error if the insert failed |
| `GET /status` | Storage health: received/stored/failed counters, last error, and a live Supabase connection probe |
| `GET /` | Health check + counters |

Every request to `/webhook` is accepted — JSON, form data, or raw text — and answered with `200 {"ok": true, "id": "...", "stored": true|false}`. Each event is also printed to the deploy logs.

## Deploy on Railway

1. Create a new Railway project → **Deploy from GitHub repo** → select this repo.
2. Railway auto-detects Node and runs `npm start`. No config needed.
3. Generate a public domain under **Settings → Networking**.
4. Your webhook URL is: `https://<your-app>.up.railway.app/webhook`

**To verify webhooks are being received:** send a test request, then open `https://<your-app>.up.railway.app/events` in a browser — every caught request shows up there with its headers, query params, and payload. Railway's deploy logs show them too.

## Plug in Supabase (later)

The `webhook_queue` table already exists in the Supabase project. When ready, add these in Railway (**Variables** tab) and redeploy:

- `SUPABASE_URL` — Supabase → Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page (keep secret)
- `SUPABASE_TABLE` — optional, defaults to `webhook_queue`

New events then insert as `status = 'pending'`, `attempts = 0`, with the request body in `payload` (jsonb) — ready for the existing queue worker.

**To verify storage is working:**

- `GET /status` — `connection.ok: true` means credentials + table + network are all good, and shows the current row count in the table. The `stats` block shows how many events were received vs stored vs failed since the last restart, with the last error message if any.
- `GET /events` — each event carries `stored: true` and the `supabase_row_id` it landed in, or `stored: false` with `store_error` explaining why.
- The webhook response itself returns `{"ok": true, "stored": true, "supabase_row_id": ...}` so the sender-side logs show it too.

## Run locally

```bash
npm install
npm start
```

Test it:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"hello": "world"}'

curl http://localhost:3000/events
```
