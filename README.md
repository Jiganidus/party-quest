# Party Quest

A family-and-friends web app for planning meetups (one-off and recurring "date battleship" quests) and keeping blood pacts.

- **Front end:** static files in this repo, hosted on GitHub Pages. Installable as a home-screen app on iPhone and Android.
- **Back end:** Supabase (sign-in, database, photo storage, scheduled jobs).
- **Alerts:** web push, sent by the `send-push` Supabase Edge Function.

## Files
| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `config.js` | Supabase URL, public anon key and public push key |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install + push support |
| `supabase/schema.sql` | Tables, security rules, game logic and schedules — run once in the SQL editor |
| `supabase/functions/send-push/index.ts` | Edge Function that delivers push alerts |

## Supabase settings this app needs
1. **Authentication → Sign In / Providers → Allow anonymous sign-ins:** on.
2. **SQL Editor:** run `supabase/schema.sql`, then insert the push settings into `app_config` (`push_url`, `push_secret`).
3. **Edge Functions:** `send-push` with JWT verification **off**, and secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SECRET`.

## How the game rules work
- A one-off quest forms as soon as the minimum players accept; at the answer-by time it fails if they haven't.
- Recurring quests: everyone marks days in the next period. One date that suits the minimum → locked. Several → vote (tie → earliest). None → miss, new round with last round's names shown. Deadline reached with no date → failed. A cancelled or failed round breaks the streak.
- Blood pacts: goals hidden until everyone signs. Weekly check-in reminders on Sunday evenings. On the due date everyone marks hit or miss (honour system). Every third miss in a crew adds "owes the crew dinner" to the debt book.
