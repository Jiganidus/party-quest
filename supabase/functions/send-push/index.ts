// Party Quest — sends a web push to every device a user has turned alerts on for.
// Called by the database trigger on public.notifications (see schema.sql).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  "https://jiganidus.github.io/party-quest/",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) {
    return new Response("Unauthorised", { status: 401 });
  }
  const { user_id, title, body, url } = await req.json();
  const { data: subs, error } = await sb.from("push_subs").select("*").eq("user_id", user_id);
  if (error) return new Response(error.message, { status: 500 });

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
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
