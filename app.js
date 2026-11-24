import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
const app = document.getElementById('app');
const S = { user: null, profile: null, crews: [], crew: null, people: {}, members: [], d: null, picks: {}, pending: null };
const HAIR = ['#4A6CF7', '#E8590C', '#2F9E44', '#5F3DC4', '#D6336C', '#1C7ED6', '#F59F00', '#3b2412'];

// ───────────── helpers ─────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = (s) => parseYMD(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDT = (iso) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const localInput = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const person = (id) => S.people[id] || { name: 'Someone', hair: '#888' };
const me = () => S.user?.id;
let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { toast(error.message.replace(/^.*?: /, '')); throw error; }
  return data;
}
function avatar(hair, size = 36) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true" style="flex:none"><circle cx="18" cy="20" r="13" fill="#FFE0BD" stroke="#5a3b1e" stroke-width="2"/><path d="M5 18Q8 4 18 5Q29 4 31 18Q24 11 18 12Q11 11 5 18Z" fill="${esc(hair)}" stroke="#5a3b1e" stroke-width="2"/><circle cx="13" cy="21" r="2" fill="#3b2412"/><circle cx="23" cy="21" r="2" fill="#3b2412"/><path d="M14 27Q18 30 22 27" stroke="#3b2412" stroke-width="1.5" fill="none"/></svg>`;
}
const ICON = {
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>', quest: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
  pact: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>', archive: '<path d="M3 5h18v4H3zM5 9v11h14V9M10 13h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
const icon = (k, s = 24, c = '#3b2412') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const back = (href = '#/') => `<a class="btn sm" href="${href}" aria-label="Back" style="font-size:18px;padding:2px 12px">‹</a>`;
const header = (title, href, extra = '') => `<div class="row">${back(href)}<h1 class="grow">${esc(title)}</h1>${extra}</div>`;

async function compressImage(file, max = 1280) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
}
async function uploadPhoto(file) {
  const blob = await compressImage(file);
  const path = `${me()}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) { toast('Photo upload failed: ' + error.message); throw error; }
  return path;
}
const photoUrl = (path) => sb.storage.from('photos').getPublicUrl(path).data.publicUrl;

// ───────────── data ─────────────
async function loadCrews() {
  const { data } = await sb.from('crew_members').select('crews(*)').eq('user_id', me());
  S.crews = (data || []).map((r) => r.crews).filter(Boolean);
  const saved = localStorage.getItem('pq.crew');
  S.crew = S.crews.find((c) => c.id === saved) || S.crews[0] || null;
}
async function loadCrew() {
  if (!S.crew) return;
  const cid = S.crew.id;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [mem, qs, ps, unread] = await Promise.all([
    sb.from('crew_members').select('user_id, profiles(id,name,hair)').eq('crew_id', cid),
    sb.from('quests').select('*').eq('crew_id', cid).order('created_at', { ascending: false }).limit(200),
    sb.from('pacts').select('*').eq('crew_id', cid).order('created_at', { ascending: false }).limit(100),
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false),
  ]);
  S.members = (mem.data || []).map((m) => m.profiles).filter(Boolean);
  S.members.forEach((p) => (S.people[p.id] = p));
  const quests = qs.data || [], pacts = ps.data || [];
  const qids = quests.map((q) => q.id), pids = pacts.map((p) => p.id);
  const [qm, picks, votes, pm, cis] = await Promise.all([
    qids.length ? sb.from('quest_members').select('*').in('quest_id', qids) : { data: [] },
    qids.length ? sb.from('date_picks').select('quest_id,round').eq('user_id', me()).in('quest_id', qids) : { data: [] },
    qids.length ? sb.from('date_votes').select('quest_id').eq('user_id', me()).in('quest_id', qids) : { data: [] },
    pids.length ? sb.from('pact_members').select('pact_id,user_id,signed_at,result').in('pact_id', pids) : { data: [] },
    pids.length ? sb.from('checkins').select('pact_id,created_at').eq('user_id', me()).gte('created_at', weekAgo) : { data: [] },
  ]);
  S.d = { quests, pacts, qm: qm.data || [], picks: picks.data || [], votes: votes.data || [], pm: pm.data || [], recentCheckins: cis.data || [], unread: unread.count || 0 };
}
const qMembers = (qid) => S.d.qm.filter((m) => m.quest_id === qid);
const myQM = (qid) => S.d.qm.find((m) => m.quest_id === qid && m.user_id === me());
const pMembers = (pid) => S.d.pm.filter((m) => m.pact_id === pid);
const myPM = (pid) => S.d.pm.find((m) => m.pact_id === pid && m.user_id === me());

function questLog() {
  const items = [], d = S.d;
  for (const q of d.quests) {
    const mine = myQM(q.id);
    if (!mine || q.status !== 'gathering') continue;
    if (q.kind === 'once' && mine.response === 'pending') items.push({ m: '!', t: `${q.title} — you're invited`, s: `From ${person(q.created_by).name} · answer by ${fmtDT(q.deadline)}`, h: `#/quest/${q.id}` });
    else if (q.kind === 'once') items.push({ m: '?', t: `${q.title} — gathering`, s: `${qMembers(q.id).filter((x) => x.response === 'accept').length} of ${q.min_players} needed`, h: `#/quest/${q.id}` });
    else if (q.phase === 'pick' && !d.picks.some((p) => p.quest_id === q.id && p.round === q.round)) items.push({ m: '!', t: `${q.title} — pick your dates`, s: `Round ${q.round} · closes ${fmtDT(q.deadline)}`, h: `#/quest/${q.id}` });
    else if (q.phase === 'pick') items.push({ m: '?', t: `${q.title} — waiting on others`, s: `You've fired for round ${q.round}`, h: `#/quest/${q.id}` });
    else if (q.phase === 'vote' && !d.votes.some((v) => v.quest_id === q.id)) items.push({ m: '!', t: `${q.title} — vote for a date`, s: 'Multiple hits!', h: `#/quest/${q.id}` });
  }
  for (const p of d.pacts) {
    const mine = myPM(p.id); if (!mine) continue;
    if (p.status === 'writing' && !mine.signed_at) items.push({ m: '!', t: `${p.name} — sign the blood pact`, s: `Due ${fmtDay(p.due_date)}`, h: `#/pact/${p.id}` });
    else if (p.status === 'writing') items.push({ m: '?', t: `${p.name} — waiting for signatures`, s: `${pMembers(p.id).filter((x) => !x.signed_at).length} still writing`, h: `#/pact/${p.id}` });
    else if (p.status === 'sealed' && !d.recentCheckins.some((c) => c.pact_id === p.id)) items.push({ m: '!', t: `${p.name} — weekly check-in`, s: 'Show your proof', h: `#/checkin/${p.id}` });
    else if (p.status === 'judging' && mine.result === 'pending') items.push({ m: '!', t: `${p.name} — judgement day`, s: 'Did you honour the pact?', h: `#/pact/${p.id}` });
  }
  return items.sort((a, b) => (a.m === b.m ? 0 : a.m === '!' ? -1 : 1));
}

// ───────────── chrome ─────────────
function tabs(active) {
  const t = (k, href, label, ic, dot = '') => `<a href="${href}" class="${active === k ? 'on' : ''}">${icon(ic)}${label}${dot}</a>`;
  const n = S.d?.unread || 0;
  return `<nav class="tabs">${t('home', '#/', 'Home', 'home')}${t('quests', '#/quests', 'Quests', 'quest')}${t('pacts', '#/pacts', 'Pacts', 'pact')}${t('archive', '#/archive', 'Archive', 'archive')}${t('alerts', '#/alerts', 'Alerts', 'bell', n ? `<span class="dot">${n}</span>` : '')}</nav>`;
}
function paint(html, active, night = false) {
  document.body.classList.toggle('night', night);
  app.innerHTML = html + (active !== null ? tabs(active) : '');
  window.scrollTo(0, 0);
}

// ───────────── screens: onboarding ─────────────
function screenInstall() {
  const code = S.pending || '';
  paint(`<div class="stack">
    <h1 class="center" style="font-size:30px;margin-top:10px">Party Quest</h1>
    <div class="win"><div class="bar">Install the app first</div><div class="pad stack">
      <div>On iPhone, alerts only work once Party Quest is on your home screen.</div>
      <div class="row"><span class="mk">1</span><div>Tap the <b>Share</b> button (square with an arrow) in your browser.</div></div>
      <div class="row"><span class="mk">2</span><div>Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.</div></div>
      <div class="row"><span class="mk">3</span><div>Close the browser and open <b>Party Quest</b> from your home screen.</div></div>
      ${code ? `<div class="row"><span class="mk">4</span><div>Enter this crew code when it asks:</div></div><div class="code">${esc(code)}</div><button class="btn sm" data-act="copyCode" data-code="${esc(code)}">Copy code</button>` : ''}
    </div></div>
    <button class="btn" data-act="skipInstall">Continue in the browser instead</button>
    <div class="muted center">If you continue here, you won't get alerts.</div>
  </div>`, null);
}

let obHair = HAIR[0], obMode = 'join';
function screenOnboard() {
  const hasProfile = !!S.profile;
  paint(`<div class="stack">
    <h1 class="center" style="font-size:30px;margin-top:10px">Party Quest</h1>
    ${hasProfile ? '' : `<div class="win"><div class="bar">Create your hero</div><div class="pad stack">
      <div class="row">${avatar(obHair, 64)}<div class="grow"><label class="l" for="ob-name">Hero name</label><input id="ob-name" class="inp" maxlength="30" placeholder="What your friends call you" autocomplete="nickname"></div></div>
      <div><span class="l">Hair colour</span><div class="swatches">${HAIR.map((h) => `<button type="button" data-act="hair" data-h="${h}" class="${h === obHair ? 'on' : ''}" style="background:${h}" aria-label="Hair colour ${h}"></button>`).join('')}</div></div>
    </div></div>`}
    <div class="win"><div class="bar">Your crew</div><div class="pad stack">
      <div class="seg"><button data-act="obMode" data-m="join" class="${obMode === 'join' ? 'on' : ''}">Join a crew</button><button data-act="obMode" data-m="new" class="${obMode === 'new' ? 'on' : ''}">Start a crew</button></div>
      ${obMode === 'join'
        ? `<div><label class="l" for="ob-code">Crew code from your invite</label><input id="ob-code" class="inp" style="text-transform:uppercase;letter-spacing:3px;font-weight:800" maxlength="6" value="${esc(S.pending || '')}" placeholder="ABC123" autocapitalize="characters"></div>`
        : `<div><label class="l" for="ob-crew">Crew name</label><input id="ob-crew" class="inp" maxlength="40" placeholder="Dinner Crew"></div>`}
    </div></div>
    <button class="btn go block" data-act="obGo" style="font-size:20px">Begin the adventure</button>
  </div>`, null);
}

// ───────────── screens: home ─────────────
function screenHome() {
  const d = S.d, log = questLog();
  const upcoming = d.quests.filter((q) => q.status === 'formed' && new Date(q.starts_at) > new Date(Date.now() - 3 * 36e5)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const series = {};
  d.quests.filter((q) => q.kind === 'recurring').forEach((q) => { if (!series[q.series_id]) series[q.series_id] = q; });
  const streaks = Object.values(series).filter((q) => ['gathering', 'formed'].includes(q.status));
  const activePacts = d.pacts.filter((p) => p.status !== 'ended' && myPM(p.id));
  const completed = d.quests.filter((q) => q.status === 'done' && myQM(q.id)?.response === 'accept').length;
  const best = Math.max(0, ...Object.values(series).map((q) => q.streak));
  paint(`<div class="stack">
    <div class="win row pad">
      ${avatar(S.profile.hair, 52)}
      <div class="grow"><div class="f" style="font-size:20px">${esc(S.profile.name)}</div><a class="muted" href="#/crew" style="text-decoration:none">${esc(S.crew.name)} · ${S.members.length} adventurers ›</a></div>
      <div class="center f"><div style="font-size:22px;color:#C2410C">×${best}</div><div class="small">best streak</div></div>
    </div>
    <div class="win"><div class="bar">Quest log ${log.filter((i) => i.m === '!').length ? `<span class="chip" style="margin-left:auto;background:#C2410C;color:#fff;border-color:#C2410C">${log.filter((i) => i.m === '!').length} new</span>` : ''}</div>
      ${log.length ? log.map((i) => `<a class="item" href="${i.h}"><span class="mk ${i.m === '?' ? 'q' : ''}">${i.m}</span><span class="grow"><b>${esc(i.t)}</b><br><span class="small muted">${esc(i.s)}</span></span><span class="f">›</span></a>`).join('') : `<div class="pad muted">Nothing needs you right now. Post a quest with the + button.</div>`}
    </div>
    <div class="win"><div class="bar">Next adventures</div>
      ${upcoming.length ? upcoming.slice(0, 4).map((q) => { const dt = new Date(q.starts_at); return `<a class="item" href="#/quest/${q.id}"><div class="center f" style="background:#4A6CF7;color:#fff;border:2px solid var(--ink);border-radius:10px;padding:3px 8px;line-height:1.1"><div class="small">${dt.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()}</div><div style="font-size:20px">${dt.getDate()}</div></div><span class="grow"><b>${esc(q.title)}</b><br><span class="small muted">${dt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}${q.location ? ' · ' + esc(q.location) : ''} · ${qMembers(q.id).filter((m) => m.response === 'accept').length} going</span></span></a>`; }).join('') : `<div class="pad muted">No adventures locked in yet.</div>`}
    </div>
    ${streaks.length || activePacts.length ? `<div class="win"><div class="bar">Streaks &amp; pacts</div><div class="pad row" style="flex-wrap:wrap;gap:8px">
      ${streaks.map((q) => `<a class="chip" href="#/quest/${q.id}">${esc(q.title)} ×${q.streak}</a>`).join('')}
      ${activePacts.map((p) => `<a class="chip red" href="#/pact/${p.id}">${esc(p.name)} · ${p.status === 'writing' ? 'signing' : p.status === 'judging' ? 'judgement' : `due ${fmtDay(p.due_date)}`}</a>`).join('')}
    </div></div>` : ''}
    <div class="muted center small">${completed} quests completed together</div>
  </div><a class="fab" href="#/new" aria-label="Post a quest or pact">+</a>`, 'home');
}

function screenQuests() {
  const d = S.d;
  const active = d.quests.filter((q) => ['gathering', 'formed'].includes(q.status));
  paint(`<div class="stack"><h1>Quests</h1>
    <div class="seg"><a href="#/new-quest?k=once" class="on">+ One-off quest</a><a href="#/new-quest?k=recurring">+ Recurring</a></div>
    <div class="win"><div class="bar">Active</div>${active.length ? active.map((q) => questRow(q)).join('') : '<div class="pad muted">No active quests.</div>'}</div>
  </div>`, 'quests');
}
function questRow(q) {
  const st = { gathering: q.kind === 'recurring' ? (q.phase === 'vote' ? 'Voting' : `Picking · round ${q.round}`) : 'Gathering', formed: 'Party formed', failed: 'Not formed', cancelled: 'Cancelled', done: 'Done' }[q.status];
  const cls = { formed: 'ok', done: 'ok', failed: 'bad', cancelled: 'bad' }[q.status] || 'wait';
  return `<a class="item" href="#/quest/${q.id}"><span class="grow"><b>${esc(q.title)}</b><br><span class="small muted">${q.starts_at ? fmtDT(q.starts_at) : q.period_start ? 'Dates in ' + parseYMD(q.period_start).toLocaleDateString('en-AU', { month: 'long' }) : ''}${q.kind === 'recurring' ? ` · streak ×${q.streak}` : ''}</span></span><span class="chip ${cls}">${st}</span></a>`;
}

function screenNew() {
  paint(`<div class="stack">${header('What are we doing?', '#/')}
    <a class="win item pad" href="#/new-quest?k=once" style="border:3px solid var(--frame)"><span class="mk">!</span><span class="grow"><b class="f" style="font-size:18px">One-off quest</b><br><span class="muted">Dinner on Friday, a beach day — one event.</span></span></a>
    <a class="win item pad" href="#/new-quest?k=recurring" style="border:3px solid var(--frame)"><span class="mk">↻</span><span class="grow"><b class="f" style="font-size:18px">Recurring quest</b><br><span class="muted">Monthly BBQ, quarterly catch-up — builds a streak.</span></span></a>
    <a class="win item pad" href="#/new-pact" style="border:3px solid var(--frame)"><span class="mk" style="background:#F8C9C9">${icon('pact', 16, '#7f1d1d')}</span><span class="grow"><b class="f" style="font-size:18px">Blood pact</b><br><span class="muted">Shared goals with weekly proof.</span></span></a>
  </div>`, 'home');
}

let nqPicked = null, nqMin = 2;
function screenNewQuest(kind) {
  const others = S.members.filter((p) => p.id !== me());
  if (!nqPicked) { nqPicked = new Set(others.map((p) => p.id)); nqMin = Math.min(3, others.length + 1); }
  const inv = nqPicked.size + 1;
  const now = new Date();
  const ev = new Date(now.getTime() + 3 * 864e5); ev.setHours(18, 0, 0, 0);
  const dl = new Date(now.getTime() + 2 * 864e5); dl.setHours(18, 0, 0, 0);
  paint(`<div class="stack">${header(kind === 'once' ? 'Post a quest' : 'Recurring quest', '#/new')}
    <div class="seg"><a href="#/new-quest?k=once" class="${kind === 'once' ? 'on' : ''}">One-off</a><a href="#/new-quest?k=recurring" class="${kind === 'recurring' ? 'on' : ''}">Recurring</a></div>
    <div class="win"><div class="bar">Quest scroll</div><div class="pad stack">
      <div><label class="l" for="nq-title">What's the quest?</label><input id="nq-title" class="inp" maxlength="80" placeholder="${kind === 'once' ? 'Friday dinner' : 'Monthly BBQ'}"></div>
      ${kind === 'once'
        ? `<div><label class="l" for="nq-when">When</label><input id="nq-when" type="datetime-local" class="inp" value="${localInput(ev)}"></div>`
        : `<div class="row"><div class="grow"><label class="l" for="nq-rep">Repeats</label><select id="nq-rep" class="inp"><option value="1">Monthly</option><option value="3">Quarterly</option></select></div><div style="width:120px"><label class="l" for="nq-time">Usual time</label><input id="nq-time" type="time" class="inp" value="18:00"></div></div>`}
      <div><label class="l" for="nq-loc">Where</label><input id="nq-loc" class="inp" maxlength="120" placeholder="Place or address (optional)"></div>
      <div><span class="l">Party · tap to invite</span>
        ${others.length ? `<div class="row" style="flex-wrap:wrap;gap:12px">${others.map((p) => `<button type="button" data-act="nqToggle" data-id="${p.id}" aria-pressed="${nqPicked.has(p.id)}" style="background:none;border:0;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;font:800 12px Nunito;color:var(--ink);opacity:${nqPicked.has(p.id) ? 1 : 0.45}"><span style="border:3px solid ${nqPicked.has(p.id) ? '#2F9E44' : 'transparent'};border-radius:50%;display:block">${avatar(p.hair, 44)}</span>${esc(p.name)}</button>`).join('')}</div>`
        : `<div class="muted">Your crew is empty. <a href="#/crew">Invite friends first</a>.</div>`}
      </div>
      <div class="row" style="background:#FFE7A8;border:2px solid var(--frame);border-radius:12px;padding:8px 10px">
        <div class="grow"><div class="f">Minimum players</div><div class="small muted">Including you · ${inv} in the party</div></div>
        <button class="btn sm" data-act="nqMin" data-d="-1" aria-label="Fewer">−</button><div class="f" style="font-size:24px;width:28px;text-align:center">${nqMin}</div><button class="btn sm" data-act="nqMin" data-d="1" aria-label="More">+</button>
      </div>
      <div><label class="l" for="nq-dl">${kind === 'once' ? 'Answer by' : 'Date picks close'}</label><input id="nq-dl" type="datetime-local" class="inp" value="${localInput(dl)}"></div>
      ${kind === 'recurring' ? '<div class="muted small">Everyone marks the days they can do in the next period. The app finds the date that works.</div>' : ''}
    </div></div>
    <button class="btn go block" data-act="nqPost" data-k="${kind}" style="font-size:20px">Post quest!</button>
  </div>`, 'quests');
}

// ───────────── screens: quest detail ─────────────
async function screenQuest(id) {
  const q = S.d.quests.find((x) => x.id === id);
  if (!q) return paint(`<div class="stack">${header('Quest', '#/')}<div class="win pad">This quest isn't in your current crew.</div></div>`, 'quests');
  return q.kind === 'once' ? screenOnce(q) : screenBattleship(q);
}

function partyList(q, statusFn) {
  return qMembers(q.id).map((m) => { const p = person(m.user_id); const [label, cls] = statusFn(m);
    return `<div class="row" style="padding:3px 0">${avatar(p.hair, 28)}<b class="grow">${esc(p.name)}${m.user_id === q.created_by ? ' <span class="muted">(organiser)</span>' : ''}${m.user_id === me() ? ' <span class="muted">(you)</span>' : ''}</b><span class="chip ${cls}">${label}</span></div>${m.comment ? `<div class="small muted" style="margin:-2px 0 4px 38px">“${esc(m.comment)}”${m.proposed_at ? ` · suggests ${fmtDT(m.proposed_at)}` : ''}</div>` : m.proposed_at ? `<div class="small muted" style="margin:-2px 0 4px 38px">Suggests ${fmtDT(m.proposed_at)}</div>` : ''}`; }).join('');
}

function formedTools(q) {
  return `<div class="row" style="flex-wrap:wrap;gap:8px">
    <button class="btn sm sun" data-act="gcal" data-id="${q.id}">Google Calendar</button>
    <button class="btn sm" data-act="ics" data-id="${q.id}">Apple / other calendar</button>
    <button class="btn sm go" data-act="wa" data-id="${q.id}">Share to WhatsApp</button>
  </div>`;
}

async function photoSection(q) {
  const { data } = await sb.from('quest_photos').select('*').eq('quest_id', q.id).order('created_at');
  return `<div class="win"><div class="bar">Quest album</div><div class="pad stack">
    ${data?.length ? `<div class="photos">${data.map((p) => `<a href="${photoUrl(p.path)}" target="_blank" rel="noopener"><img src="${photoUrl(p.path)}" alt="Photo from ${esc(person(p.user_id).name)}" loading="lazy"></a>`).join('')}</div>` : '<div class="muted">No photos yet.</div>'}
    <label class="btn sm" style="align-self:flex-start">${icon('camera', 16)} Add photos<input type="file" accept="image/*" multiple hidden data-change="questPhotos" data-id="${q.id}"></label>
  </div></div>`;
}

async function screenOnce(q) {
  const ms = qMembers(q.id), mine = myQM(q.id), org = person(q.created_by);
  const yes = ms.filter((m) => m.response === 'accept').length;
  const st = { accept: ['Accepted', 'ok'], decline: ['Declined', 'bad'], propose: ['Proposed new', ''], pending: ['Thinking…', 'wait'] };
  const banner = { formed: ['Party formed!', '#2B8A3E', '#EBFBEE'], failed: ['Party not formed', '#C92A2A', '#FFE3E3'], cancelled: ['Cancelled by the organiser', '#C92A2A', '#FFE3E3'], done: ['Quest complete', '#2B8A3E', '#EBFBEE'] }[q.status];
  const showPhotos = ['formed', 'done'].includes(q.status) && new Date(q.starts_at) < new Date(Date.now() + 36e5);
  paint(`<div class="stack">${header('Quest', '#/')}
    <div class="win">
      <div class="row pad" style="align-items:flex-start">
        <div class="center" style="flex:none">${avatar(org.hair, 64)}<div class="chip" style="background:var(--ink);color:var(--paper)">${esc(org.name)}</div></div>
        <div class="speech grow"><div class="f" style="font-size:18px">${esc(q.title)}</div><div class="small muted">Who's in?</div></div>
      </div>
      <div class="pad grid2" style="border-top:2px dashed var(--line)">
        <span class="k">When</span><b>${fmtDT(q.starts_at)}</b>
        ${q.location ? `<span class="k">Where</span><b><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q.location)}" target="_blank" rel="noopener">${esc(q.location)}</a></b>` : ''}
        <span class="k">Answer by</span><b>${fmtDT(q.deadline)}</b>
      </div>
    </div>
    ${banner ? `<div class="win pad center" style="background:${banner[2]}"><div class="f" style="font-size:22px;color:${banner[1]}">${banner[0]}</div>${q.status === 'formed' ? `<div class="small" style="margin:4px 0 8px">${yes} adventurers going</div>${formedTools(q)}` : ''}</div>` : ''}
    <div class="win"><div class="bar">Party <span style="margin-left:auto;font-size:13px">${yes} of ${q.min_players} needed</span></div><div class="pad stack" style="gap:6px">
      <div class="prog"><div style="width:${Math.min(100, Math.round((yes / q.min_players) * 100))}%"></div></div>
      ${partyList(q, (m) => st[m.response])}
    </div></div>
    ${mine && q.status === 'gathering' ? `<div class="win pad stack">
      <div class="f">${mine.response === 'pending' ? 'Your answer' : 'Change your answer'}</div>
      <input id="rq-comment" class="inp" maxlength="200" placeholder="Say something (optional)" value="${esc(mine.comment || '')}">
      <div id="rq-prop-wrap" hidden><label class="l" for="rq-prop">Your counter-offer</label><input id="rq-prop" type="datetime-local" class="inp" value="${localInput(new Date(q.starts_at))}"></div>
      <div class="row"><button class="btn go grow" data-act="respond" data-r="accept" data-id="${q.id}">Accept</button><button class="btn no grow" data-act="respond" data-r="decline" data-id="${q.id}">Decline</button><button class="btn sun grow" data-act="respond" data-r="propose" data-id="${q.id}">Propose new</button></div>
    </div>` : ''}
    ${showPhotos ? await photoSection(q) : ''}
    ${q.created_by === me() && ['gathering', 'formed'].includes(q.status) ? `<button class="btn no sm" data-act="cancelQuest" data-id="${q.id}" style="align-self:center">Cancel this quest</button>` : ''}
  </div>`, 'quests');
}

async function screenBattleship(q) {
  const [{ data: picks }, { data: fired }, { data: votes }] = await Promise.all([
    sb.from('date_picks').select('*').eq('quest_id', q.id),
    sb.rpc('round_status', { p_quest: q.id }),
    sb.from('date_votes').select('*').eq('quest_id', q.id),
  ]);
  const ms = qMembers(q.id);
  const firedIds = new Set((fired || []).map((r) => r.user_id));
  const myCur = (picks || []).find((p) => p.user_id === me() && p.round === q.round);
  if (!S.picks[q.id] || S.picks[q.id].round !== q.round) S.picks[q.id] = { round: q.round, set: new Set(myCur?.dates || []) };
  const sel = S.picks[q.id].set;
  // other people's picks from earlier (missed) rounds — names show on the calendar
  const reveal = {};
  const showRound = q.phase === 'pick' && q.status === 'gathering' ? q.round - 1 : q.round;
  (picks || []).filter((p) => p.user_id !== me() && p.round === showRound).forEach((p) => {
    p.dates.forEach((d) => { (reveal[d] = reveal[d] || new Set()).add(person(p.user_id).name.slice(0, 3)); });
  });
  const today = ymd(new Date());
  const lockedDay = q.starts_at ? ymd(new Date(q.starts_at)) : null;
  const months = [];
  let cur = parseYMD(q.period_start); const end = parseYMD(q.period_end);
  while (cur <= end) { months.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
  const canPick = q.status === 'gathering' && q.phase === 'pick' && myQM(q.id);
  const cal = months.map((m) => {
    const first = new Date(m.getFullYear(), m.getMonth(), 1), days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w) => `<div class="wd">${w}</div>`).join('') + '<div></div>'.repeat(lead);
    for (let i = 1; i <= days; i++) {
      const ds = ymd(new Date(m.getFullYear(), m.getMonth(), i));
      const cls = [sel.has(ds) && q.phase === 'pick' ? 'mine' : '', ds < today ? 'past' : '', ds === lockedDay ? 'locked' : ''].join(' ');
      cells += `<button class="cell ${cls}" ${canPick ? `data-act="pick" data-id="${q.id}" data-d="${ds}"` : 'disabled'} aria-pressed="${sel.has(ds)}">${i}<small>${reveal[ds] ? esc([...reveal[ds]].join(' ')) : ''}</small></button>`;
    }
    return `<div class="win"><div class="bar">${m.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</div><div class="cal">${cells}</div></div>`;
  }).join('');
  const waiting = ms.filter((m) => !firedIds.has(m.user_id)).map((m) => person(m.user_id).name);
  let panel = '';
  if (q.status === 'gathering' && q.phase === 'pick') {
    panel = `${q.round > 1 ? `<div class="win pad" style="background:#FFE3E3"><div class="f" style="font-size:18px;color:#C92A2A">Miss! Round ${q.round - 1} found no date</div><div class="small">Names on each day show who could make it last round. Pick again.</div></div>` : ''}
      ${myQM(q.id) ? `<button class="btn orange block" data-act="fire" data-id="${q.id}" style="font-size:20px">${firedIds.has(me()) ? 'Update my picks' : 'Fire!'} (${sel.size} picked)</button>` : ''}
      <div class="muted center small">${waiting.length ? `Waiting on: ${esc(waiting.join(', '))}` : 'Everyone has fired.'}</div>`;
  } else if (q.status === 'gathering' && q.phase === 'vote') {
    const counts = {}; (votes || []).forEach((v) => { (counts[v.vote] = counts[v.vote] || []).push(person(v.user_id).name); });
    const myVote = (votes || []).find((v) => v.user_id === me())?.vote;
    panel = `<div class="win pad stack"><div class="f" style="font-size:20px;color:#C2410C">Multiple hits! Vote for one</div>
      ${(q.shortlist || []).map((d) => `<button class="btn ${myVote === d ? 'sun' : ''}" data-act="vote" data-id="${q.id}" data-d="${d}">${fmtDay(d)} · ${(counts[d] || []).length} vote${(counts[d] || []).length === 1 ? '' : 's'}${counts[d] ? ` <span class="small">(${esc(counts[d].join(', '))})</span>` : ''}</button>`).join('')}
      <div class="small muted">Voting closes ${fmtDT(q.deadline)}. No agreement? The earliest most-voted date wins.</div></div>`;
  } else if (q.status === 'formed') {
    panel = `<div class="win pad center" style="background:#EBFBEE"><div class="f" style="font-size:24px;color:#2B8A3E">Hit! ${fmtDT(q.starts_at)}</div><div class="small" style="margin:4px 0 8px">Locked in · ${ms.filter((m) => m.response === 'accept').length} going · streak ×${q.streak + 1} if it happens</div>${formedTools(q)}</div>`;
  } else {
    panel = `<div class="win pad center" style="background:#FFE3E3"><div class="f" style="font-size:20px;color:#C92A2A">${q.status === 'cancelled' ? 'Cancelled — streak broken' : q.status === 'failed' ? 'No date found — streak broken' : 'Quest complete'}</div></div>`;
  }
  paint(`<div class="stack">${header('Date battleship', '#/', `<span class="chip">Round ${q.round}</span>`)}
    <div class="win"><div class="bar">${esc(q.title)} <span style="margin-left:auto;color:#C2410C">Streak ×${q.streak}</span></div><div class="pad stack" style="gap:6px">
      <div class="small"><b>Need ${q.min_players} of ${ms.length} free</b>${q.status === 'gathering' ? ` · ${q.phase === 'pick' ? 'picks' : 'voting'} close ${fmtDT(q.deadline)}` : ''}${q.location ? ' · ' + esc(q.location) : ''}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${ms.map((m) => `<span class="chip ${firedIds.has(m.user_id) ? 'ok' : 'wait'}">${esc(person(m.user_id).name)} · ${firedIds.has(m.user_id) ? 'fired' : 'picking'}</span>`).join('')}</div>
    </div></div>
    ${canPick ? '<div class="muted small">Tap every day you can do. Others\' picks stay hidden until the round is over.</div>' : ''}
    ${cal}
    ${panel}
    ${(['formed', 'done'].includes(q.status) && new Date(q.starts_at) < new Date(Date.now() + 36e5)) ? await photoSection(q) : ''}
    ${q.created_by === me() && ['gathering', 'formed'].includes(q.status) ? `<button class="btn no sm" data-act="cancelQuest" data-id="${q.id}" style="align-self:center">Cancel this round</button>` : ''}
  </div>`, 'quests');
}

// ───────────── screens: pacts ─────────────
async function screenPacts() {
  const d = S.d;
  const [{ data: stats }, { data: debts }] = await Promise.all([sb.rpc('crew_stats', { p_crew: S.crew.id }), sb.from('debts').select('*').eq('crew_id', S.crew.id).order('created_at', { ascending: false })]);
  const active = d.pacts.filter((p) => p.status !== 'ended');
  paint(`<div class="stack"><h1 style="color:var(--paper)">Blood pacts</h1>
    <a class="btn blood block" href="#/new-pact">Summon a new pact</a>
    <div class="win"><div class="bar red">Active pacts</div>${active.length ? active.map((p) => `<a class="item" href="#/pact/${p.id}"><span class="grow"><b>${esc(p.name)}</b><br><span class="small muted">Due ${fmtDay(p.due_date)} · ${pMembers(p.id).length} members</span></span><span class="chip red">${{ writing: 'Signing', sealed: 'Sealed', judging: 'Judgement' }[p.status]}</span></a>`).join('') : '<div class="pad muted">No active pacts.</div>'}</div>
    <div class="win"><div class="bar red">Naughty list <span style="margin-left:auto;font-size:12px">strikes from missed goals</span></div><div class="pad row" style="flex-wrap:wrap;gap:8px">
      ${(stats || []).map((s) => `<span style="flex:1;min-width:90px;text-align:center;background:#fff;border:2px dashed #C92A2A;border-radius:8px;padding:4px"><b>${esc(person(s.user_id).name)}</b><br>${s.strikes % 3} / 3 strikes</span>`).join('')}
    </div></div>
    ${debts?.length ? `<div class="win"><div class="bar red">Debt book</div>${debts.map((x) => `<div class="item"><span class="grow"><b>${esc(person(x.user_id).name)}</b> — ${esc(x.reason)}</span>${x.settled ? '<span class="chip ok">Settled</span>' : `<button class="btn sm go" data-act="settle" data-id="${x.id}">Mark settled</button>`}</div>`).join('')}</div>` : ''}
  </div>`, 'pacts', true);
}

let npPicked = null;
function screenNewPact() {
  const others = S.members.filter((p) => p.id !== me());
  if (!npPicked) npPicked = new Set(others.map((p) => p.id));
  const due = new Date(Date.now() + 90 * 864e5);
  paint(`<div class="stack">${header('Summon a blood pact', '#/pacts')}
    <div class="win"><div class="bar red">The terms</div><div class="pad stack">
      <div><label class="l" for="np-name">Pact name</label><input id="np-name" class="inp" maxlength="60" placeholder="Summer Shred"></div>
      <div><label class="l" for="np-due">Due date</label><input id="np-due" type="date" class="inp" value="${ymd(due)}"></div>
      <div><label class="l" for="np-proof">Weekly proof</label><select id="np-proof" class="inp"><option value="photo">Photo</option><option value="number">A number (weight, time…)</option><option value="yesno">Yes / no</option><option value="note">Short note</option></select></div>
      <div><label class="l" for="np-pen">Penalty</label><input id="np-pen" class="inp" value="3 strikes = buy the crew dinner"></div>
      <div><span class="l">Members</span>${others.length ? `<div class="row" style="flex-wrap:wrap;gap:12px">${others.map((p) => `<button type="button" data-act="npToggle" data-id="${p.id}" aria-pressed="${npPicked.has(p.id)}" style="background:none;border:0;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;font:800 12px Nunito;color:var(--ink);opacity:${npPicked.has(p.id) ? 1 : 0.45}"><span style="border:3px solid ${npPicked.has(p.id) ? '#C92A2A' : 'transparent'};border-radius:50%;display:block">${avatar(p.hair, 44)}</span>${esc(p.name)}</button>`).join('')}</div>` : '<div class="muted">Invite friends to your crew first.</div>'}</div>
    </div></div>
    <button class="btn blood block" data-act="npGo" style="font-size:20px">Summon the pact</button>
  </div>`, 'pacts', true);
}

async function screenPact(id) {
  const p = S.d.pacts.find((x) => x.id === id);
  if (!p) return paint(`<div class="stack">${header('Pact', '#/pacts')}<div class="win pad">This pact isn't in your current crew.</div></div>`, 'pacts', true);
  const [{ data: view }, { data: proofs }] = await Promise.all([
    sb.rpc('pact_view', { p_pact: id }),
    sb.from('checkins').select('*').eq('pact_id', id).order('created_at', { ascending: false }).limit(12),
  ]);
  const mine = (view || []).find((v) => v.user_id === me());
  const weeks = Math.max(1, Math.ceil((parseYMD(p.due_date) - new Date(p.created_at)) / (7 * 864e5)));
  const terms = `<div class="pad grid2"><span class="k">Due</span><b>${fmtDay(p.due_date)}</b><span class="k">Proof</span><b>${{ photo: 'Photo', number: 'A number', yesno: 'Yes / no', note: 'Short note' }[p.proof_type] || esc(p.proof_type)} each week</b><span class="k">Penalty</span><b>${esc(p.penalty)}</b></div>`;
  let body = '';
  if (p.status === 'writing') {
    body = `<div class="win"><div class="bar red">${esc(p.name)}</div>${terms}</div>
      <div class="win"><div class="bar red">Who has signed</div><div class="pad stack" style="gap:6px">${(view || []).map((v) => `<div class="row"><b class="grow">${esc(v.name)}${v.user_id === me() ? ' (you)' : ''}</b><span class="f" style="color:${v.signed ? '#C92A2A' : 'var(--ink2)'}">${v.signed ? 'Signed · goal hidden' : 'Still writing…'}</span></div>`).join('')}</div></div>
      ${mine && !mine.signed ? `<div class="win parch pad stack"><label class="f" for="pg" style="font-size:17px">By ${fmtDay(p.due_date)}, I will…</label><textarea id="pg" class="inp" rows="3" maxlength="300" placeholder="Make it measurable — e.g. 10 strict pull-ups"></textarea><div class="small muted">Goals stay hidden until everyone has signed.</div></div><button class="btn blood block" data-act="sign" data-id="${id}" style="font-size:20px">Sign in blood</button>`
      : mine ? `<div class="win parch pad"><b>Your goal:</b> ${esc(mine.goal)}<div class="small muted">Waiting for the others to sign.</div></div>` : ''}`;
  } else {
    const seenKey = 'pq.seal.' + id; const firstSeal = p.status === 'sealed' && !localStorage.getItem(seenKey); localStorage.setItem(seenKey, '1');
    body = `<div class="row" style="padding:4px 6px"><div class="seal ${firstSeal ? 'stamp' : ''}">${icon('pact', 40, '#FFE3E3')}</div><div style="color:var(--paper)"><div class="f" style="font-size:24px">${p.status === 'sealed' ? 'Pact sealed!' : p.status === 'judging' ? 'Judgement day' : 'Pact ended'}</div><div>${esc(p.name)} · due ${fmtDay(p.due_date)}</div></div></div>
      <div class="win parch"><div class="bar red">The terms</div>${terms}<div class="pad stack" style="padding-top:0">
        ${(view || []).map((v) => { const pct = Math.min(100, Math.round((v.checkins / weeks) * 100)); const res = { hit: ['Honoured', 'ok'], miss: ['Missed', 'bad'], pending: [p.status === 'sealed' ? '' : 'Undecided', 'wait'] }[v.result];
          return `<div><div class="row">${avatar(v.hair, 26)}<b class="grow">${esc(v.name)}</b>${res[0] ? `<span class="chip ${res[1]}">${res[0]}</span>` : `<span class="f small">EXP ${pct}%</span>`}</div><div class="small" style="margin:2px 0 4px">${esc(v.goal || '')}</div><div class="prog"><div style="width:${pct}%"></div></div><div class="small muted">${v.checkins} check-in${v.checkins === 1 ? '' : 's'}</div></div>`; }).join('')}
      </div></div>
      ${p.status === 'sealed' && mine ? `<a class="btn sun block" href="#/checkin/${id}">Weekly check-in</a>` : ''}
      ${p.status === 'judging' && mine?.result === 'pending' ? `<div class="win pad stack"><div class="f" style="font-size:18px">Did you honour the pact?</div><div class="small">Honour system. A miss adds a strike — 3 strikes = ${esc(p.penalty.replace(/^3 strikes = /, ''))}.</div><div class="row"><button class="btn go grow" data-act="result" data-r="hit" data-id="${id}">I did it</button><button class="btn no grow" data-act="result" data-r="miss" data-id="${id}">I missed</button></div></div>` : ''}
      ${proofs?.length ? `<div class="win"><div class="bar red">Latest proof</div><div class="pad stack">${proofs.map((c) => `<div class="row" style="align-items:flex-start">${c.photo_path ? `<a href="${photoUrl(c.photo_path)}" target="_blank" rel="noopener"><img src="${photoUrl(c.photo_path)}" alt="Proof from ${esc(person(c.user_id).name)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid var(--frame)" loading="lazy"></a>` : ''}<div class="grow"><b>${esc(person(c.user_id).name)}</b> <span class="small muted">${fmtDT(c.created_at)}</span>${c.value ? `<div>${esc(c.value)}</div>` : ''}${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}</div></div>`).join('')}</div></div>` : ''}
      ${p.status === 'sealed' && p.created_by === me() ? `<button class="btn sm" data-act="judgeNow" data-id="${id}" style="align-self:center">End pact early (start judgement)</button>` : ''}`;
  }
  paint(`<div class="stack">${header('Blood pact', '#/pacts')}${body}</div>`, 'pacts', true);
}

function screenCheckin(id) {
  const p = S.d.pacts.find((x) => x.id === id);
  if (!p) return paint(`<div class="stack">${header('Check-in', '#/pacts')}<div class="win pad">Pact not found.</div></div>`, 'pacts');
  const label = { number: 'Your number this week', yesno: 'Did you stay on track? (yes/no)', note: 'How did it go?', photo: 'Number (optional)' }[p.proof_type] || 'Value';
  paint(`<div class="stack">${header('Weekly check-in', '#/pact/' + id)}
    <div class="win"><div class="bar">${esc(p.name)}</div><div class="pad stack">
      <label class="pad center" style="border:3px dashed #C9B48A;border-radius:12px;background:#fff;cursor:pointer;display:block" for="ci-photo"><div>${icon('camera', 36, '#6b4a26')}</div><div class="f" id="ci-photo-label">Tap to add a photo${p.proof_type === 'photo' ? '' : ' (optional)'}</div></label>
      <input id="ci-photo" type="file" accept="image/*" hidden data-change="ciPhoto">
      <div><label class="l" for="ci-val">${label}</label><input id="ci-val" class="inp" maxlength="60"></div>
      <div><label class="l" for="ci-note">Note (optional)</label><input id="ci-note" class="inp" maxlength="200" placeholder="Legs are cooked"></div>
    </div></div>
    <button class="btn go block" data-act="checkin" data-id="${id}" style="font-size:20px">Submit check-in</button>
    <div class="muted center small">Honour system · miss a week and you'll just get a reminder</div>
  </div>`, 'pacts');
}

// ───────────── screens: archive, crew, alerts ─────────────
async function screenArchive() {
  const d = S.d;
  const { data: stats } = await sb.rpc('crew_stats', { p_crew: S.crew.id });
  const past = d.quests.filter((q) => ['done', 'failed', 'cancelled'].includes(q.status));
  const ended = d.pacts.filter((p) => p.status === 'ended');
  paint(`<div class="stack"><h1>Archive</h1>
    <div class="win"><div class="bar">Adventures shared with you</div>${(stats || []).filter((s) => s.user_id !== me()).sort((a, b) => b.shared_quests - a.shared_quests).map((s) => `<div class="item">${avatar(person(s.user_id).hair, 28)}<b class="grow">${esc(person(s.user_id).name)}</b><span class="f">${s.shared_quests} quest${s.shared_quests === 1 ? '' : 's'}</span></div>`).join('') || '<div class="pad muted">No crewmates yet.</div>'}</div>
    <div class="win"><div class="bar">Past quests</div>${past.length ? past.map(questRow).join('') : '<div class="pad muted">Nothing here yet.</div>'}</div>
    <div class="win"><div class="bar">Past pacts</div>${ended.length ? ended.map((p) => `<a class="item" href="#/pact/${p.id}"><span class="grow"><b>${esc(p.name)}</b><br><span class="small muted">Ended ${fmtDay(p.due_date)}</span></span><span class="f">›</span></a>`).join('') : '<div class="pad muted">No finished pacts yet.</div>'}</div>
  </div>`, 'archive');
}

function screenCrew() {
  const link = `${location.origin}${location.pathname}?crew=${S.crew.code}`;
  paint(`<div class="stack">${header(S.crew.name, '#/')}
    <div class="win"><div class="bar">Invite friends</div><div class="pad stack">
      <div class="code">${esc(S.crew.code)}</div>
      <div class="row"><button class="btn go grow" data-act="inviteWa">Invite on WhatsApp</button><button class="btn grow" data-act="copyLink" data-link="${esc(link)}">Copy link</button></div>
    </div></div>
    <div class="win"><div class="bar">Adventurers (${S.members.length})</div>${S.members.map((p) => `<div class="item">${avatar(p.hair, 32)}<b class="grow">${esc(p.name)}${p.id === me() ? ' (you)' : ''}</b></div>`).join('')}</div>
    ${S.crews.length > 1 ? `<div class="win"><div class="bar">Switch crew</div>${S.crews.map((c) => `<button class="item" data-act="switchCrew" data-id="${c.id}"><b class="grow">${esc(c.name)}</b>${c.id === S.crew.id ? '<span class="chip ok">Current</span>' : '<span class="f">›</span>'}</button>`).join('')}</div>` : ''}
    <div class="win"><div class="bar">Join or start another crew</div><div class="pad stack">
      <div class="row"><input id="cr-code" class="inp grow" maxlength="6" placeholder="Crew code" style="text-transform:uppercase"><button class="btn sm sun" data-act="joinCrew">Join</button></div>
      <div class="row"><input id="cr-name" class="inp grow" maxlength="40" placeholder="New crew name"><button class="btn sm" data-act="newCrew">Start</button></div>
    </div></div>
    <div class="win"><div class="bar">Your hero</div><div class="pad stack">
      <div class="row">${avatar(S.profile.hair, 48)}<input id="hero-name" class="inp grow" maxlength="30" value="${esc(S.profile.name)}"></div>
      <div class="swatches">${HAIR.map((h) => `<button type="button" data-act="heroHair" data-h="${h}" class="${h === S.profile.hair ? 'on' : ''}" style="background:${h}" aria-label="Hair colour ${h}"></button>`).join('')}</div>
      <button class="btn sm sun" data-act="saveHero" style="align-self:flex-start">Save</button>
    </div></div>
  </div>`, 'home');
}

async function screenAlerts() {
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const granted = pushOk && Notification.permission === 'granted' && localStorage.getItem('pq.push') === '1';
  paint(`<div class="stack"><div class="row"><h1 class="grow">Alerts</h1>${data?.some((n) => !n.read) ? '<button class="btn sm" data-act="readAll">Mark all read</button>' : ''}</div>
    <div class="win pad stack">${granted ? '<div><b>Phone alerts are on.</b> <span class="muted">You\'ll get pings for invites, dates and check-ins.</span></div><button class="btn sm" data-act="enablePush" style="align-self:flex-start">Re-connect alerts</button>'
      : pushOk ? '<div><b>Turn on phone alerts</b> so you never miss an invite.</div><button class="btn go" data-act="enablePush">Turn on alerts</button>'
      : isIOS && !standalone ? '<div><b>Alerts need the app on your home screen.</b> Tap Share → Add to Home Screen, then open Party Quest from there.</div>'
      : '<div class="muted">This browser can\'t do phone alerts. Check back here for updates.</div>'}</div>
    <div class="win">${data?.length ? data.map((n) => `<button class="item" data-act="openNote" data-id="${n.id}" data-url="${esc(n.url || '#/')}" style="${n.read ? '' : 'background:#FFF3BF'}"><span class="mk ${n.read ? 'q' : ''}">${n.read ? '·' : '!'}</span><span class="grow"><b>${esc(n.title)}</b>${n.body ? `<br><span class="small">${esc(n.body)}</span>` : ''}<br><span class="small muted">${fmtDT(n.created_at)}</span></span></button>`).join('') : '<div class="pad muted">No alerts yet.</div>'}</div>
  </div>`, 'alerts');
}

// ───────────── actions ─────────────
function calEvent(q) {
  const start = new Date(q.starts_at), end = new Date(start.getTime() + 3 * 36e5);
  const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { start, end, z, text: q.title, loc: q.location || '', details: `Party Quest · ${S.crew.name}` };
}
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Alerts are not supported here');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Alerts were not allowed. You can change this in your phone settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { vapidPublicKey } = await (await fetch(`${SUPABASE_URL}/functions/v1/send-push`)).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidPublicKey) });
  }
  const j = sub.toJSON();
  const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: me(), p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) return toast('Could not save alerts: ' + error.message);
  localStorage.setItem('pq.push', '1'); toast('Alerts are on!'); render();
}

const A = {
  async copyCode(el) { await navigator.clipboard?.writeText(el.dataset.code); toast('Code copied'); },
  skipInstall() { localStorage.setItem('pq.skipInstall', '1'); boot(); },
  hair(el) { obHair = el.dataset.h; const n = document.getElementById('ob-name')?.value; screenOnboard(); if (n) document.getElementById('ob-name').value = n; },
  obMode(el) { const n = document.getElementById('ob-name')?.value; obMode = el.dataset.m; screenOnboard(); if (n) document.getElementById('ob-name').value = n; },
  async obGo(el) {
    const name = document.getElementById('ob-name')?.value.trim();
    const code = document.getElementById('ob-code')?.value.trim();
    const crewName = document.getElementById('ob-crew')?.value.trim();
    if (!S.profile && !name) return toast('Give your hero a name');
    if (obMode === 'join' && !code) return toast('Enter the crew code from your invite');
    if (obMode === 'new' && !crewName) return toast('Name your crew');
    el.disabled = true;
    try {
      if (!S.user) { const { data, error } = await sb.auth.signInAnonymously(); if (error) throw error; S.user = data.user; }
      if (!S.profile) await rpc('save_profile', { p_name: name, p_hair: obHair });
      const c = obMode === 'join' ? await rpc('join_crew', { p_code: code }) : await rpc('create_crew', { p_name: crewName });
      localStorage.setItem('pq.crew', c.id); localStorage.removeItem('pq.pending'); S.pending = null;
      location.hash = obMode === 'new' ? '#/crew' : '#/'; await boot();
    } catch (e) { el.disabled = false; if (e.message && !document.querySelector('.toast')) toast(e.message); }
  },
  nqToggle(el) { const id = el.dataset.id; nqPicked.has(id) ? nqPicked.delete(id) : nqPicked.add(id); nqMin = Math.min(nqMin, nqPicked.size + 1); keepInputs(() => render()); },
  nqMin(el) { nqMin = Math.max(1, Math.min(nqPicked.size + 1, nqMin + Number(el.dataset.d))); keepInputs(() => render()); },
  async nqPost(el) {
    const kind = el.dataset.k, v = (id) => document.getElementById(id)?.value;
    const title = v('nq-title')?.trim(); if (!title) return toast('Name the quest');
    if (!v('nq-dl')) return toast('Set the answer-by time');
    el.disabled = true;
    try {
      const id = await rpc('create_quest', {
        p_crew: S.crew.id, p_title: title, p_location: v('nq-loc')?.trim() || null, p_kind: kind,
        p_starts_at: kind === 'once' ? new Date(v('nq-when')).toISOString() : null,
        p_repeat_months: kind === 'recurring' ? Number(v('nq-rep')) : null, p_time: kind === 'recurring' ? v('nq-time') : null,
        p_min: nqMin, p_deadline: new Date(v('nq-dl')).toISOString(), p_members: [...nqPicked],
      });
      nqPicked = null; toast('Quest posted!'); location.hash = '#/quest/' + id;
    } catch { el.disabled = false; }
  },
  async respond(el) {
    const r = el.dataset.r;
    const wrap = document.getElementById('rq-prop-wrap');
    if (r === 'propose' && wrap.hidden) { wrap.hidden = false; el.textContent = 'Send proposal'; return; }
    el.disabled = true;
    try {
      await rpc('respond_quest', { p_quest: el.dataset.id, p_response: r, p_comment: document.getElementById('rq-comment').value, p_proposed_at: r === 'propose' ? new Date(document.getElementById('rq-prop').value).toISOString() : null });
      toast({ accept: 'You\'re in!', decline: 'Maybe next quest', propose: 'Counter-offer sent' }[r]); await refresh();
    } catch { el.disabled = false; }
  },
  async cancelQuest(el) { if (!confirm('Cancel this quest for everyone?')) return; await rpc('cancel_quest', { p_quest: el.dataset.id }); toast('Quest cancelled'); await refresh(); },
  pick(el) { const s = S.picks[el.dataset.id].set, d = el.dataset.d; s.has(d) ? s.delete(d) : s.add(d); el.classList.toggle('mine', s.has(d)); el.setAttribute('aria-pressed', s.has(d)); const f = document.querySelector('[data-act="fire"]'); if (f) f.textContent = f.textContent.replace(/\(\d+ picked\)/, `(${s.size} picked)`); },
  async fire(el) {
    const set = S.picks[el.dataset.id].set; if (!set.size && !confirm('Fire with no days picked? That means you can\'t make any.')) return;
    el.disabled = true;
    try {
      const r = await rpc('submit_picks', { p_quest: el.dataset.id, p_dates: [...set].sort() });
      toast({ waiting: 'Fired! Waiting for the others…', miss: 'Miss! No date works yet — round 2', hit: 'Hit! Date locked in', vote: 'Multiple hits! Time to vote' }[r] || 'Fired!');
      await refresh();
    } catch { el.disabled = false; }
  },
  async vote(el) { await rpc('vote_date', { p_quest: el.dataset.id, p_date: el.dataset.d }); toast('Vote cast'); await refresh(); },
  gcal(el) { const q = S.d.quests.find((x) => x.id === el.dataset.id), e = calEvent(q); window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.text)}&dates=${e.z(e.start)}/${e.z(e.end)}&location=${encodeURIComponent(e.loc)}&details=${encodeURIComponent(e.details)}`, '_blank'); },
  ics(el) {
    const q = S.d.quests.find((x) => x.id === el.dataset.id), e = calEvent(q);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Party Quest//EN', 'BEGIN:VEVENT', `UID:${q.id}@party-quest`, `DTSTAMP:${e.z(new Date())}`, `DTSTART:${e.z(e.start)}`, `DTEND:${e.z(e.end)}`, `SUMMARY:${e.text.replace(/[,;]/g, ' ')}`, `LOCATION:${e.loc.replace(/[,;]/g, ' ')}`, `DESCRIPTION:${e.details}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'party-quest.ics'; a.click();
  },
  wa(el) { const q = S.d.quests.find((x) => x.id === el.dataset.id); const going = qMembers(q.id).filter((m) => m.response === 'accept').map((m) => person(m.user_id).name).join(', ');
    window.open(`https://wa.me/?text=${encodeURIComponent(`⚔️ Party formed: ${q.title}\n📅 ${fmtDT(q.starts_at)}${q.location ? `\n📍 ${q.location}` : ''}\n🧙 ${going}`)}`, '_blank'); },
  npToggle(el) { const id = el.dataset.id; npPicked.has(id) ? npPicked.delete(id) : npPicked.add(id); keepInputs(() => render()); },
  async npGo(el) {
    const v = (id) => document.getElementById(id)?.value;
    const name = v('np-name')?.trim(); if (!name) return toast('Name the pact');
    el.disabled = true;
    try { const id = await rpc('create_pact', { p_crew: S.crew.id, p_name: name, p_due: v('np-due'), p_proof: v('np-proof'), p_penalty: v('np-pen'), p_members: [...npPicked] }); npPicked = null; await refresh(); location.hash = '#/pact/' + id; }
    catch { el.disabled = false; }
  },
  async sign(el) { const g = document.getElementById('pg').value; el.disabled = true; try { const r = await rpc('sign_pact', { p_pact: el.dataset.id, p_goal: g }); toast(r === 'sealed' ? 'The pact is sealed!' : 'Signed in blood'); await refresh(); } catch { el.disabled = false; } },
  async judgeNow(el) { if (!confirm('End the pact now and start judgement?')) return; await rpc('judge_now', { p_pact: el.dataset.id }); await refresh(); },
  async result(el) { el.disabled = true; try { await rpc('set_result', { p_pact: el.dataset.id, p_result: el.dataset.r }); toast(el.dataset.r === 'hit' ? 'Pact honoured!' : 'Strike recorded'); await refresh(); } catch { el.disabled = false; } },
  async checkin(el) {
    const p = S.d.pacts.find((x) => x.id === el.dataset.id), file = document.getElementById('ci-photo').files[0];
    if (p.proof_type === 'photo' && !file) return toast('Add a photo as proof');
    el.disabled = true; el.textContent = 'Sending…';
    try {
      const path = file ? await uploadPhoto(file) : null;
      await rpc('add_checkin', { p_pact: p.id, p_photo: path, p_value: document.getElementById('ci-val').value, p_note: document.getElementById('ci-note').value });
      paint(`<div class="stack" style="padding-top:40px"><div class="win pad center" style="background:#FFF9DB"><div class="pop f" style="font-size:44px;color:#E67700">+EXP</div><div class="f" style="font-size:20px">Check-in logged!</div><div>Your crew can see your proof.</div></div><a class="btn sun block" href="#/pact/${p.id}">Back to the pact</a></div>`, 'pacts');
      await loadCrew();
    } catch { el.disabled = false; el.textContent = 'Submit check-in'; }
  },
  async settle(el) { await rpc('settle_debt', { p_debt: el.dataset.id }); toast('Debt settled'); render(); },
  async inviteWa() { const link = `${location.origin}${location.pathname}?crew=${S.crew.code}`; window.open(`https://wa.me/?text=${encodeURIComponent(`Join my crew "${S.crew.name}" on Party Quest ⚔️\n${link}\nCrew code: ${S.crew.code}`)}`, '_blank'); },
  async copyLink(el) { await navigator.clipboard?.writeText(el.dataset.link); toast('Invite link copied'); },
  async switchCrew(el) { localStorage.setItem('pq.crew', el.dataset.id); S.crew = S.crews.find((c) => c.id === el.dataset.id); await loadCrew(); location.hash = '#/'; render(); },
  async joinCrew() { const c = await rpc('join_crew', { p_code: document.getElementById('cr-code').value }); localStorage.setItem('pq.crew', c.id); await boot(); toast('Joined ' + c.name); },
  async newCrew() { const n = document.getElementById('cr-name').value.trim(); if (!n) return toast('Name the crew'); const c = await rpc('create_crew', { p_name: n }); localStorage.setItem('pq.crew', c.id); await boot(); },
  heroHair(el) { document.querySelectorAll('[data-act="heroHair"]').forEach((b) => b.classList.toggle('on', b === el)); el.closest('.win').dataset.hair = el.dataset.h; },
  async saveHero(el) { const hair = el.closest('.win').dataset.hair || S.profile.hair; const name = document.getElementById('hero-name').value.trim(); if (!name) return toast('Name required'); await rpc('save_profile', { p_name: name, p_hair: hair }); S.profile = { ...S.profile, name, hair }; S.people[me()] = S.profile; toast('Hero saved'); render(); },
  enablePush: () => enablePush().catch((e) => toast(e.message)),
  async readAll() { await sb.from('notifications').update({ read: true }).eq('read', false); await refresh(); },
  async openNote(el) { await sb.from('notifications').update({ read: true }).eq('id', el.dataset.id); S.d.unread = Math.max(0, S.d.unread - 1); location.hash = el.dataset.url; },
};
const CHANGE = {
  async questPhotos(el) { const files = [...el.files]; if (!files.length) return; toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`); for (const f of files) { const path = await uploadPhoto(f); await rpc('add_quest_photo', { p_quest: el.dataset.id, p_path: path }); } toast('Added to the album'); render(); },
  ciPhoto(el) { const f = el.files[0]; document.getElementById('ci-photo-label').textContent = f ? `📷 ${f.name}` : 'Tap to add a photo'; },
};
function keepInputs(fn) { const vals = {}; app.querySelectorAll('input,select,textarea').forEach((i) => { if (i.id && i.type !== 'file') vals[i.id] = i.value; }); fn(); setTimeout(() => Object.entries(vals).forEach(([k, v]) => { const i = document.getElementById(k); if (i) i.value = v; }), 0); }
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || !A[el.dataset.act]) return; e.preventDefault(); Promise.resolve(A[el.dataset.act](el)).catch(() => {}); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el && CHANGE[el.dataset.change]) Promise.resolve(CHANGE[el.dataset.change](el)).catch(() => {}); });

// ───────────── router ─────────────
async function render() {
  if (!S.user || !S.profile || !S.crew) return;
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const qs = new URLSearchParams(query || '');
  try {
    switch (parts[0]) {
      case undefined: return screenHome();
      case 'quests': return screenQuests();
      case 'new': return screenNew();
      case 'new-quest': return screenNewQuest(qs.get('k') === 'recurring' ? 'recurring' : 'once');
      case 'quest': return await screenQuest(parts[1]);
      case 'pacts': return await screenPacts();
      case 'new-pact': return screenNewPact();
      case 'pact': return await screenPact(parts[1]);
      case 'checkin': return screenCheckin(parts[1]);
      case 'archive': return await screenArchive();
      case 'crew': return screenCrew();
      case 'alerts': return await screenAlerts();
      default: return screenHome();
    }
  } catch (e) { console.error(e); paint(`<div class="win pad">Something went wrong: ${esc(e.message)}</div>`, 'home'); }
}
async function refresh() { await loadCrew(); await render(); }
window.addEventListener('hashchange', async () => { if (!location.hash.startsWith('#/new-quest')) nqPicked = null; if (!location.hash.startsWith('#/new-pact')) npPicked = null; await refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.crew) refresh(); });

async function boot() {
  const url = new URL(location.href);
  const code = url.searchParams.get('crew');
  if (code) { localStorage.setItem('pq.pending', code.toUpperCase()); history.replaceState(null, '', location.pathname + location.hash); }
  S.pending = localStorage.getItem('pq.pending');
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (!S.user) {
    if (isIOS && !standalone && !localStorage.getItem('pq.skipInstall')) return screenInstall();
    return screenOnboard();
  }
  const { data: prof } = await sb.from('profiles').select('*').eq('id', me()).maybeSingle();
  S.profile = prof; if (prof) S.people[prof.id] = prof;
  await loadCrews();
  if (S.profile && S.pending && !S.crews.some((c) => c.code === S.pending)) {
    try { const c = await rpc('join_crew', { p_code: S.pending }); localStorage.setItem('pq.crew', c.id); toast('Joined ' + c.name); await loadCrews(); } catch {}
    localStorage.removeItem('pq.pending'); S.pending = null;
  }
  if (!S.profile || !S.crew) return screenOnboard();
  await loadCrew();
  await render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
app.innerHTML = '<div class="loading">Loading the map…</div>';
boot().catch((e) => { console.error(e); app.innerHTML = `<div class="win pad">Could not start: ${esc(e.message)}</div>`; });
