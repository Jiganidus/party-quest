// Party Quest — original chibi hero avatars, drawn as layered SVG.
// Layers (back to front): back hair → body → head → face expression → front hair.

export const GENDERS = { m: 'Male', f: 'Female' };
export const STYLES = {
  m: [['spiky', 'Spiky'], ['side', 'Side swept'], ['buzz', 'Buzz'], ['mop', 'Mop'], ['slick', 'Slick'], ['curly', 'Curly']],
  f: [['bob', 'Bob'], ['long', 'Long'], ['pony', 'Ponytail'], ['twin', 'Twin tails'], ['bun', 'Bun'], ['wavy', 'Wavy']],
};
export const HAIR_COLOURS = ['#3b2412', '#7a4a21', '#E8B04A', '#E8590C', '#D6336C', '#5F3DC4', '#1C7ED6', '#2F9E44', '#868E96', '#F1F3F5'];
export const FACES = [['happy', 'Happy'], ['laugh', 'Laughing'], ['love', 'Love'], ['wink', 'Wink'], ['angry', 'Angry'], ['cry', 'Crying'], ['shock', 'Shocked']];

const INK = '#5a3b1e', SKIN = '#FFE0BD', DARK = '#3b2412';

// Profiles keep the avatar settings as JSON in the `hair` field; older profiles hold just a colour.
export function parseAvatar(hair) {
  if (typeof hair === 'object' && hair) return { g: 'm', h: 'side', c: '#3b2412', m: 'happy', ...hair };
  if (typeof hair === 'string' && hair.startsWith('{')) { try { return { g: 'm', h: 'side', c: '#3b2412', m: 'happy', ...JSON.parse(hair) }; } catch {} }
  return { g: 'm', h: 'side', c: (typeof hair === 'string' && /^#[0-9a-f]{6}$/i.test(hair)) ? hair : '#3b2412', m: 'happy' };
}
export const avatarToString = (a) => JSON.stringify({ g: a.g, h: a.h, c: a.c, m: a.m });

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16); const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
};

const BACK = {
  bob: 'M8 21 Q7 36 13 37 L35 37 Q41 36 40 21 Z',
  long: 'M8 20 Q5 45 12 47 L36 47 Q43 45 40 20 Z',
  pony: 'M35 12 Q49 14 45 33 Q43 41 39 37 Q43 26 34 19 Z',
  twin: 'M11 17 Q0 21 3 35 Q6 41 10 34 Q7 26 13 21 Z M37 17 Q48 21 45 35 Q42 41 38 34 Q41 26 35 21 Z',
  bun: 'M17 4 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 Z',
  wavy: 'M8 20 Q4 30 8 36 Q5 42 10 47 L38 47 Q43 42 40 36 Q44 30 40 20 Z',
};
const FRONT = {
  spiky: 'M9 22 L8 14 L12 15 L12 8 L17 11 L20 4 L24 9 L29 3 L31 10 L36 7 L35 14 L40 13 L39 22 Q36 15 30 15 L27 18 L24 14 L20 18 L17 14 Q12 15 9 22 Z',
  side: 'M9 22 Q8 7 24 7 Q39 7 39 20 Q36 13 30 12 Q22 18 12 17 Q10 19 9 22 Z',
  buzz: 'M10 19 Q11 8 24 8 Q37 8 38 19 Q32 13 24 13 Q16 13 10 19 Z',
  mop: 'M8 24 Q7 6 24 6 Q41 6 40 24 Q38 18 35 17 L33 20 L30 16 L27 20 L24 16 L21 20 L18 16 L15 20 L13 17 Q10 18 8 24 Z',
  slick: 'M10 18 Q12 6 26 7 Q38 8 38 18 Q30 12 20 12 Q14 13 10 18 Z',
  curly: 'M9 21 a4 4 0 0 1 3 -7 a4 4 0 0 1 6 -5 a4 4 0 0 1 7 -2 a4 4 0 0 1 7 2 a4 4 0 0 1 5 6 a4 4 0 0 1 2 6 Q35 14 24 14 Q14 14 9 21 Z',
  bob: 'M9 27 Q7 7 24 7 Q41 7 39 27 L36 27 Q36 16 30 13 Q24 17 16 15 Q12 18 12 27 Z',
  long: 'M9 26 Q8 7 24 7 Q40 7 39 26 Q37 15 27 13 Q20 16 13 15 Q10 18 9 26 Z',
  pony: 'M10 20 Q10 7 24 7 Q38 7 38 19 Q32 12 24 13 Q19 16 14 15 Q11 17 10 20 Z',
  twin: 'M10 21 Q10 7 24 7 Q38 7 38 21 Q34 14 28 14 L24 17 L20 14 Q14 14 10 21 Z',
  bun: 'M10 20 Q11 8 24 8 Q37 8 38 20 Q30 14 24 15 Q18 14 10 20 Z',
  wavy: 'M9 25 Q7 7 24 7 Q41 7 39 25 Q37 19 35 18 Q33 14 29 15 Q26 12 22 15 Q18 13 15 16 Q11 17 9 25 Z',
};

function body(g) {
  const shirt = g === 'f' ? '#E64980' : '#4A6CF7', trim = '#F5B544';
  return g === 'f'
    ? `<path d="M11 48 Q12 38 24 37 Q36 38 37 48 Z" fill="${shirt}" stroke="${INK}" stroke-width="1.4"/><path d="M19 38 L24 42 L29 38" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M21 42 L24 40.5 L27 42 L24 43.5 Z" fill="${trim}" stroke="${INK}" stroke-width="0.8"/>`
    : `<path d="M9 48 Q10 38 24 37 Q38 38 39 48 Z" fill="${shirt}" stroke="${INK}" stroke-width="1.4"/><path d="M20 38 L24 43 L28 38" fill="none" stroke="${trim}" stroke-width="1.8"/>`;
}

function eyes(g, kind) {
  const lash = g === 'f' ? `<path d="M15.6 21.6 L14.2 20.6 M32.4 21.6 L33.8 20.6" stroke="${DARK}" stroke-width="1" stroke-linecap="round"/>` : '';
  if (kind === 'dot') return `<circle cx="18.5" cy="23" r="1.9" fill="${DARK}"/><circle cx="29.5" cy="23" r="1.9" fill="${DARK}"/>${lash}`;
  if (kind === 'big') return `<circle cx="18.5" cy="23" r="3" fill="#fff" stroke="${DARK}" stroke-width="1"/><circle cx="29.5" cy="23" r="3" fill="#fff" stroke="${DARK}" stroke-width="1"/><circle cx="18.5" cy="23" r="1.3" fill="${DARK}"/><circle cx="29.5" cy="23" r="1.3" fill="${DARK}"/>${lash}`;
  return '';
}
const blush = `<ellipse cx="14.5" cy="27" rx="2.4" ry="1.4" fill="#FF8FA3" opacity=".7"/><ellipse cx="33.5" cy="27" rx="2.4" ry="1.4" fill="#FF8FA3" opacity=".7"/>`;
const heart = (x, y) => `<path d="M${x} ${y + 2.2} L${x - 2.6} ${y - 0.4} A1.5 1.5 0 0 1 ${x} ${y - 1.6} A1.5 1.5 0 0 1 ${x + 2.6} ${y - 0.4} Z" fill="#E03131"/>`;

function face(g, m) {
  const sw = (w) => `stroke="${DARK}" stroke-width="${w}" stroke-linecap="round" fill="none"`, s = sw(1.4);
  switch (m) {
    case 'laugh': return `<path d="M16 24 Q18.5 20.5 21 24 M27 24 Q29.5 20.5 32 24" ${s}/><path d="M19 28.5 Q24 35.5 29 28.5 Z" fill="#9C3A2A" stroke="${DARK}" stroke-width="1.2"/>${blush}`;
    case 'love': return `${heart(18.5, 23)}${heart(29.5, 23)}<path d="M20.5 29 Q24 32.5 27.5 29" ${s}/>${blush}`;
    case 'wink': return `<circle cx="18.5" cy="23" r="1.9" fill="${DARK}"/>${g === 'f' ? `<path d="M15.6 21.6 L14.2 20.6" ${sw(1)}/>` : ''}<path d="M27 23.5 Q29.5 21.5 32 23.5" ${s}/><path d="M20.5 29 Q24 32.5 27.5 29" ${s}/><path d="M25.5 30.6 Q26.5 33 27.6 31" fill="#FF6B6B" stroke="${DARK}" stroke-width="0.8"/>${blush}`;
    case 'angry': return `<path d="M15.5 19 L21 21.2 M32.5 19 L27 21.2" ${sw(1.8)}/>${eyes(g, 'dot')}<path d="M20.5 31 Q24 28 27.5 31" ${s}/><path d="M34 13 l2 2 m0 -2 l-2 2" stroke="#E03131" stroke-width="1.4"/>`;
    case 'cry': return `<path d="M16 22.5 Q18.5 24.5 21 22.5 M27 22.5 Q29.5 24.5 32 22.5" ${s}/><path d="M17 25 Q15.8 28.5 17.2 29.6 Q18.8 28.4 17 25 Z M31 25 Q29.8 28.5 31.2 29.6 Q32.8 28.4 31 25 Z" fill="#74C0FC" stroke="#1C7ED6" stroke-width="0.6"/><path d="M20.5 31.5 Q22 29.6 24 31.2 Q26 29.6 27.5 31.5" ${s}/>`;
    case 'shock': return `${eyes(g, 'big')}<ellipse cx="24" cy="30.5" rx="2.2" ry="2.8" fill="#9C3A2A" stroke="${DARK}" stroke-width="1.1"/><path d="M36 9 l1 4 M39 11 l-2 3" stroke="${DARK}" stroke-width="1.2" stroke-linecap="round"/>`;
    default: return `${eyes(g, 'dot')}<path d="M20 28.6 Q24 32.6 28 28.6" ${s}/>${blush}`;
  }
}

// Returns an <svg> string. `faceOverride` shows a reaction instead of the hero's mood.
export function avatarSvg(hair, size = 36, faceOverride) {
  const a = parseAvatar(hair);
  const g = a.g === 'f' ? 'f' : 'm';
  const style = FRONT[a.h] ? a.h : (g === 'f' ? 'bob' : 'side');
  const c = a.c || '#3b2412', edge = shade(c, 0.6);
  const back = BACK[style] ? `<path d="${BACK[style]}" fill="${shade(c, 0.85)}" stroke="${edge}" stroke-width="1.2"/>` : '';
  return `<svg width="${size}" height="${size}" viewBox="-2 -4 52 52" aria-hidden="true" style="flex:none;overflow:visible">${back}${body(g)}`
    + `<circle cx="10.5" cy="24" r="3" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/><circle cx="37.5" cy="24" r="3" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/>`
    + `<circle cx="24" cy="22" r="14" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/>${face(g, faceOverride || a.m)}`
    + `<path d="${FRONT[style]}" fill="${c}" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

// Just the face on a skin-coloured circle, for the reaction and mood pickers.
export function faceSvg(m, size = 30, g = 'm') {
  return `<svg width="${size}" height="${size}" viewBox="8 6 32 32" aria-hidden="true"><circle cx="24" cy="22" r="14" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/>${face(g, m)}</svg>`;
}
