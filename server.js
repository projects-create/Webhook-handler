const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase is optional — the handler works without it and starts persisting
// as soon as SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "webhook_queue";

const supabase =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (supabase) {
  console.log(`Supabase configured — storing payloads in "${SUPABASE_TABLE}"`);
} else {
  console.log(
    "Supabase not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) — payloads kept in memory only"
  );
}

// Capture the raw body for every content type so nothing is rejected,
// then best-effort parse JSON.
app.use(
  express.raw({ type: () => true, limit: process.env.BODY_LIMIT || "5mb" })
);

// Last N events kept in memory for quick inspection via GET /events
const MAX_EVENTS = 100;
const recentEvents = [];

function parseBody(req) {
  const raw = req.body && req.body.length ? req.body.toString("utf8") : null;
  if (!raw) return { raw: null, json: null };
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
}

async function handleWebhook(req, res) {
  const { raw, json } = parseBody(req);

  const event = {
    id: crypto.randomUUID(),
    received_at: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl.split("?")[0],
    source: req.params.source || null,
    query: Object.keys(req.query).length ? req.query : null,
    headers: req.headers,
    payload: json ?? raw,
    content_type: req.headers["content-type"] || null,
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  };

  console.log(
    `[${event.received_at}] ${event.method} ${event.path}`,
    JSON.stringify(event.payload)?.slice(0, 500)
  );

  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();

  let stored = false;
  if (supabase) {
    // Matches the existing webhook_queue table: a worker picks rows up by
    // status, so new events land as pending with the body in payload.
    const { error } = await supabase.from(SUPABASE_TABLE).insert({
      status: "pending",
      attempts: 0,
      payload: json ?? { raw },
      created_at: event.received_at,
    });
    if (error) {
      console.error("Supabase insert failed:", error.message);
    } else {
      stored = true;
    }
  }

  // Always 200 so senders don't retry-storm while storage is being set up
  res.status(200).json({ ok: true, id: event.id, stored });
}

// Health check (Railway pings this)
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "webhook-handler",
    supabase: Boolean(supabase),
    endpoints: {
      webhook: "POST /webhook (or POST /webhook/:source)",
      recent: "GET /events",
    },
  });
});

// Main webhook endpoints — accept any method senders might use
app.all("/webhook", handleWebhook);
app.all("/webhook/:source", handleWebhook);

// Inspect the most recent events without touching the database
app.get("/events", (_req, res) => {
  res.json({ count: recentEvents.length, events: recentEvents });
});

app.listen(PORT, () => {
  console.log(`Webhook handler listening on port ${PORT}`);
});
