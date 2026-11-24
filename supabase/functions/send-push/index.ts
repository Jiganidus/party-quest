// Party Quest — delivers web push alerts.
// It creates its own push keys on first run and keeps them in public.app_config
// (readable only by the server), so no secret ever has to be copied by hand.
//   GET  → { vapidPublicKey }            used by the app to turn alerts on
//   GET ?ics=<party quest id> → calendar file, so phones open their own "Add event" screen
//   POST → send one alert to one user     called by the database trigger with x-push-secret
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
let cfg: Record<string, string> | null = null;

async function loadConfig() {
  if (cfg) return cfg;
  const read = async () => Object.fromEntries(((await sb.from("app_config").select("key,value")).data ?? []).map((r) => [r.key, r.value]));
  let c = await read();
  if (!c.vapid_public || !c.vapid_private || !c.push_secret) {
    const keys = webpush.generateVAPIDKeys();
    const secret = crypto.randomUUID() + crypto.randomUUID();
    await sb.from("app_config").upsert([
      { key: "vapid_public", value: keys.publicKey },
      { key: "vapid_private", value: keys.privateKey },
      { key: "push_secret", value: secret },
    ], { onConflict: "key", ignoreDuplicates: true });
    c = await read();
  }
  webpush.setVapidDetails("https://jiganidus.github.io/party-quest/", c.vapid_public, c.vapid_private);
  cfg = c;
  return c;
}

const z = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const clean = (t: string) => t.replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, " ");
async function calendarFile(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { data: q } = await sb.from("quests").select("id,title,location,starts_at,status").eq("id", id).maybeSingle();
  if (!q || !q.starts_at) return new Response("This Party Quest has no date yet", { status: 404 });
  const start = new Date(q.starts_at), end = new Date(start.getTime() + 3 * 3600e3);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Party Quest//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${q.id}@party-quest`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`,
    `SUMMARY:${clean(q.title)}`, q.location ? `LOCATION:${clean(q.location)}` : "", "DESCRIPTION:Party Quest",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return new Response(ics, { headers: { ...cors, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="party-quest.ics"' } });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const icsId = new URL(req.url).searchParams.get("ics");
  if (req.method === "GET" && icsId) return calendarFile(icsId);
  const c = await loadConfig();
  if (req.method === "GET") return json({ vapidPublicKey: c.vapid_public });
  if (req.headers.get("x-push-secret") !== c.push_secret) return json({ error: "Unauthorised" }, 401);

  const { user_id, title, body, url } = await req.json();
  const { data: subs, error } = await sb.from("push_subs").select("*").eq("user_id", user_id);
  if (error) return json({ error: error.message }, 500);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url }),
        { TTL: 60 * 60 * 24 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return json({ sent });
});
