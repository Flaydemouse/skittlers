// Skittlers API: accounts, leagues, seasons and each season's data.
// Storage, randomness and settings are passed in, so the same code runs on Netlify,
// on the local preview server, and inside the in-browser preview.

const TRIAL_DAYS = 30;
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 210000;
const MAX_BODY = 2 * 1024 * 1024;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Addresses a league can't use, because the site or a future subdomain needs them.
const RESERVED_SLUGS = new Set([
  "api", "www", "app", "admin", "account", "accounts", "login", "logout", "signup", "register", "templates", "vendor",
  "assets", "static", "mail", "email", "smtp", "help", "support", "blog", "about", "super", "dashboard", "leagues",
  "league", "new", "skittlers", "status", "billing", "pricing", "terms", "privacy",
]);

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v ?? null));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
const normEmail = e => String(e || "").trim().toLowerCase();
const cleanText = (v, max = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
// How a league plays: players a side, balls in a hand, hands each player throws, and rough skittles or nomination.
const GAME_LIMITS = { players: [1, 16], balls: [1, 5], hands: [1, 20] };
// Points: win/draw/loss for the match, plus optional handWin/handDraw for each hand won or drawn.
// Teams level on points are split by these, in order: overall pin difference, away pin difference, head to head.
const TIEBREAKS = ["pd", "apd", "h2h"];
const DEFAULT_SETTINGS = { win: 2, draw: 1, loss: 0, handWin: 0, handDraw: 0, players: 6, balls: 3, hands: 6, game: "rough", tiebreak: ["pd", "apd"], startTime: "19:45" };
function applySettings(target, b) {
  if (!isObj(b)) return;
  for (const k of ["win", "draw", "loss", "handWin", "handDraw"]) { const n = Number(b[k]); if (Number.isInteger(n) && n >= 0 && n <= 20) target[k] = n; }
  for (const [k, [lo, hi]] of Object.entries(GAME_LIMITS)) { const n = Number(b[k]); if (Number.isInteger(n) && n >= lo && n <= hi) target[k] = n; }
  if (["rough", "nomination"].includes(b.game)) target.game = b.game;
  if (typeof b.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.startTime)) target.startTime = b.startTime;
  // The site's colour scheme: an id from the list on the page (an unknown one shows the default).
  if (typeof b.theme === "string" && /^[a-z]{2,20}$/.test(b.theme)) target.theme = b.theme;
  if (Array.isArray(b.tiebreak)) { const t = [...new Set(b.tiebreak.filter(k => TIEBREAKS.includes(k)))]; if (t.length) target.tiebreak = t; }
}
// transfers: players who moved team during the season, { id, date, first, last, nick, key, from, to }.
// committee: the league's officers, { id, role: "president" | "chairman" | "treasurer" | "secretary" | "member", team, key, first, last, nick }.
const emptySeason = () => ({ version: 0, teams: {}, venues: {}, fixtures: {}, divisions: {}, cups: {}, transfers: {}, committee: {} });
// Results go live only when the secretary publishes them. A fixture's `pub` holds what was last published
// (result, scorecards and any note marked for the live site); everyone else sees that, never the working copy,
// the private notes or the checking ticks. Fixtures from before publishing existed have no `pub` and show as they are.
function publicFixture(f) {
  const { note, notePublic, ready, pub, ...rest } = f;
  if (!("pub" in f)) return rest;
  delete rest.homePins; delete rest.awayPins; delete rest.cards;
  if (pub && Number.isFinite(pub.homePins) && Number.isFinite(pub.awayPins)) { rest.homePins = pub.homePins; rest.awayPins = pub.awayPins; if (pub.cards) rest.cards = pub.cards; }
  if (pub?.note) rest.note = String(pub.note);
  return rest;
}
// Cups work the same way: `pub` holds the published match results, final and notes; `check` holds each match's
// private note and ticks. Later rounds are worked out from results, so the public draw only moves on from published ones.
function publicCup(c) {
  const { pub, check, ...rest } = c;
  if (!("pub" in c)) return rest;
  rest.results = clone(pub?.results || {});
  rest.final = { ...(c.final || {}), scores: clone(pub?.final?.scores || {}), cards: clone(pub?.final?.cards || {}), winner: pub?.final?.winner ?? null };
  if (pub?.notes && Object.keys(pub.notes).length) rest.publicNotes = clone(pub.notes);
  return rest;
}
export const publicSeason = d => ({ ...d,
  fixtures: Object.fromEntries(Object.entries(d.fixtures || {}).map(([id, f]) => [id, publicFixture(f)])),
  cups: Object.fromEntries(Object.entries(d.cups || {}).map(([id, c]) => [id, publicCup(c)])) });

/* ---------- reading a scoreboard photo ---------- */
// A secretary photographs the board after a match; Claude reads it and the scorecard is filled in for them to check.
// The same prompt, answer format and checks are used on the live site and in the preview.
/* ---------- sharing a news post ---------- */
// The page for /<slug>/news/<id>: the app itself, with the post's title, opening text and first photo in the tags that
// Facebook, WhatsApp and X read to show a preview card. Only published posts; anything else gets the plain page.
const attr = v => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function newsSharePage({ store, slug, id, origin, html }) {
  slug = String(slug || "").toLowerCase();
  const ref = /^[a-z0-9-]{1,60}$/.test(slug) && await store.get(`slugs/${slug}`);
  const league = ref && await store.get(`leagues/${ref.leagueId}`);
  const post = league && ((await store.get(`news/${league.id}`))?.items || []).find(x => x.id === id && !x.status);
  if (!post) return null;
  const desc = String(post.body || "").replace(/\s+/g, " ").trim(), short = desc.length > 200 ? desc.slice(0, 197).replace(/\s+\S*$/, "") + "…" : desc;
  const url = `${origin}/${slug}/news/${encodeURIComponent(post.id)}`, image = post.photos?.[0] ? `${origin}/api/public/${slug}/media/${encodeURIComponent(post.photos[0])}` : "";
  const tags = [
    `<meta property="og:type" content="article">`, `<meta property="og:site_name" content="${attr(league.name)}">`,
    `<meta property="og:title" content="${attr(post.title)}">`, `<meta property="og:description" content="${attr(short)}">`,
    `<meta property="og:url" content="${attr(url)}">`, `<link rel="canonical" href="${attr(url)}">`,
    ...(image ? [`<meta property="og:image" content="${attr(image)}">`, `<meta name="twitter:image" content="${attr(image)}">`] : []),
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`, `<meta name="twitter:title" content="${attr(post.title)}">`, `<meta name="twitter:description" content="${attr(short)}">`,
  ].join("\n");
  return html.replace(/<title>[^<]*<\/title>/, `<title>${attr(post.title)} · ${attr(league.name)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(short)}">`)
    .replace("</head>", `${tags}\n</head>`);
}

/* ---------- results sent in by captains ---------- */
// A scorecard as the page builds it: { mode, rows: [{ key, name, nick, total, hands?, spares?, spareScores? }] }.
// Returns a clean copy, or null if it isn't one.
export function cleanCard(c) {
  if (!c || typeof c !== "object" || !["hands", "totals"].includes(c.mode) || !Array.isArray(c.rows) || !c.rows.length || c.rows.length > 20) return null;
  const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  const str = (v, max) => typeof v === "string" && v.length <= max;
  const rows = [];
  for (const r of c.rows) {
    if (!r || typeof r !== "object" || !str(r.key, 80) || !r.key || !str(r.name, 80) || !(r.nick === undefined || str(r.nick, 40)) || !int(r.total, 2000)) return null;
    const row = { key: r.key, name: r.name, nick: r.nick || "", total: r.total };
    if (c.mode === "hands") {
      if (!Array.isArray(r.hands) || !r.hands.length || r.hands.length > 12 || !r.hands.every(v => int(v, 200))) return null;
      if (!Array.isArray(r.spares) || r.spares.length !== r.hands.length || !r.spares.every(v => typeof v === "boolean")) return null;
      if (r.hands.reduce((a, b) => a + b, 0) !== r.total) return null;
      Object.assign(row, { hands: [...r.hands], spares: [...r.spares] });
    } else if (r.spareScores !== undefined) {
      if (!Array.isArray(r.spareScores) || r.spareScores.length > 12 || !r.spareScores.every(v => int(v, 200))) return null;
      row.spareScores = [...r.spareScores];
    }
    rows.push(row);
  }
  return { mode: c.mode, rows };
}

/* ---------- calendar feed (iCalendar), for Google, Apple and Outlook calendars ---------- */
const icsText = v => String(v ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines longer than 75 bytes are folded onto continuation lines that start with a space.
function icsFold(line) {
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const icsDate = d => d.replace(/-/g, "");
const icsStamp = iso => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
const LONDON_TZ = ["BEGIN:VTIMEZONE", "TZID:Europe/London", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
// A knockout cup's matches, worked out from the draw and results the same way as cupBracket in public/index.html
// (keep the two in step): winners move through, places beyond the entries are byes, and a match with nobody in it
// gives whoever would meet its winner a bye. Each match: { id, r, roundName, a, b, aPins, bPins, date, time, venue, alley, bye, empty,
// couldA, couldB } where couldA/couldB list who could still be in each place while earlier results are awaited.
export function cupMatches(cup, teams = {}, venues = {}) {
  const R = Math.max(1, Math.ceil(Math.log2(Math.max(2, cup.entries || 0)))), size = 2 ** R, draw = cup.draw || [], n = draw.length;
  let order = [1]; while (order.length < size) { const m = order.length * 2; order = order.flatMap(x => [x, m + 1 - x]); }
  const roundName = r => R - r === 0 ? "Final" : R - r === 1 ? "Semi-finals" : R - r === 2 ? "Quarter-finals" : `Round ${r}`;
  const home = id => { if (!id) return null; const t = cup.format === "team" ? teams[id] : teams[String(id).split(":")[1]], v = venues[t?.venue];
    return v ? { venue: v.id, alley: v.alleys > 1 ? (t.alley || 1) : null } : null; };
  const out = []; let prev = null;
  for (let r = 1; r <= R; r++) {
    const row = [], when = cup.roundDates?.[r] || {};
    for (let k = 0; k < size / 2 ** r; k++) {
      const id = `${r}-${k}`, m = { id, r, roundName: roundName(r), a: null, b: null, aPins: null, bPins: null, winner: null, bye: false, empty: false };
      if (r === 1) {
        const sa = order[2 * k], sb = order[2 * k + 1];
        m.a = draw[sa - 1] || null; m.b = draw[sb - 1] || null;
        if (sa > n && sb > n) m.empty = true; else if (sa > n || sb > n) { m.bye = true; m.winner = m.a || m.b; }
      } else {
        const pa = prev[2 * k], pb = prev[2 * k + 1];
        if (pa.empty && pb.empty) m.empty = true;
        else if (pa.empty || pb.empty) { m.bye = true; m.a = (pa.empty ? pb : pa).winner; m.winner = m.a; }
        else { m.a = pa.winner; m.b = pb.winner; }
      }
      // Who could still be in each place, for a match waiting on earlier results.
      const could = (x, feeder) => x ? [x] : feeder ? (feeder.winner ? [feeder.winner] : [...feeder.couldA, ...feeder.couldB]) : [];
      if (r === 1) { m.couldA = m.a ? [m.a] : []; m.couldB = m.b ? [m.b] : []; }
      else { const pa = prev[2 * k], pb = prev[2 * k + 1]; m.couldA = m.bye ? could(m.a, pa.empty ? pb : pa) : could(m.a, pa); m.couldB = m.bye ? [] : could(m.b, pb); }
      const res = cup.results?.[id];
      if (!m.bye && !m.empty && res && m.a && m.b && res.a === m.a && res.b === m.b && Number.isFinite(res.aPins) && Number.isFinite(res.bPins)) {
        m.aPins = res.aPins; m.bPins = res.bPins;
        m.winner = res.aPins === res.bPins ? ([m.a, m.b].includes(res.winner) ? res.winner : null) : res.aPins > res.bPins ? m.a : m.b;
      }
      const sched = cup.schedule?.[id] || {}, h = home(m.a);
      m.date = when.date || ""; m.time = when.time || "";
      if (sched.venue && venues[sched.venue]) { m.venue = sched.venue; m.alley = venues[sched.venue].alleys > 1 ? (sched.alley || 1) : null; }
      else { m.venue = h?.venue || null; m.alley = h?.alley || null; }
      row.push(m);
    }
    out.push(...row); prev = row;
  }
  return out;
}
// The season's dated league fixtures, cup matches and cup finals as an .ics calendar: the whole league, one division
// (its league games and its teams' cup games) or one team. Uses only what's public: published results, venue names
// and addresses. Calendars re-read it every few hours, so new fixtures, cup draws and changed dates follow on their own.
// Games last about three hours.
export function seasonCalendar({ league, season, data, team, division, url, now }) {
  const d = publicSeason(data || {}), teams = d.teams || {}, venues = d.venues || {}, divs = d.divisions || {};
  const tName = id => teams[id]?.name || "To be decided";
  const where = (vid, alley) => { const v = venues[vid]; if (!v) return "";
    return [v.name + (alley && v.alleys > 1 ? ` (alley ${alley})` : ""), v.address1, v.address2, v.address3, v.postcode].filter(Boolean).join(", "); };
  const events = [];
  const add = (uid, date, time, summary, location, desc) => {
    const ev = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsStamp(now)}`];
    if (/^\d{2}:\d{2}$/.test(time || "")) {
      const [h, m] = time.split(":").map(Number), end = h + 3;
      ev.push(`DTSTART;TZID=Europe/London:${icsDate(date)}T${time.replace(":", "")}00`,
        end < 24 ? `DTEND;TZID=Europe/London:${icsDate(date)}T${String(end).padStart(2, "0")}${String(m).padStart(2, "0")}00` : `DTEND;TZID=Europe/London:${icsDate(date)}T235900`);
    } else ev.push(`DTSTART;VALUE=DATE:${icsDate(date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(date, 1))}`);
    ev.push(`SUMMARY:${icsText(summary)}`);
    if (location) ev.push(`LOCATION:${icsText(location)}`);
    ev.push(`DESCRIPTION:${icsText(desc)}`, `URL:${url}`, "END:VEVENT");
    events.push(ev);
  };
  const inDiv = id => !!id && teams[id]?.division === division;
  const wanted = (ids, leagueGame) => team ? ids.includes(team) : division ? (leagueGame ? inDiv(ids[0]) : ids.some(inDiv)) : true;
  for (const f of Object.values(d.fixtures || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "") || !wanted([f.home, f.away], f.comp === "league")) continue;
    const vid = f.venue || teams[f.home]?.venue, alley = f.alley || (vid === teams[f.home]?.venue ? teams[f.home]?.alley : null);
    const playedNow = Number.isFinite(f.homePins) && Number.isFinite(f.awayPins);
    const comp = f.comp === "league" ? divs[teams[f.home]?.division]?.name || "League" : f.round || "Cup";
    const summary = `${tName(f.home)} ${playedNow ? `${f.homePins}–${f.awayPins}` : "v"} ${tName(f.away)}`;
    add(`${f.id}@skittlers`, f.date, f.time, summary, where(vid, alley),
      [`${league.name}: ${comp}`, f.postponedFrom ? `Moved from ${f.postponedFrom}` : "", playedNow ? "Result published" : ""].filter(Boolean).join("\n"));
  }
  // Cups: a team cup's entries are teams; an individual cup's are "p:<team>:<player>".
  for (const c of Object.values(d.cups || {})) {
    const teamOf = id => id ? (c.format === "team" ? String(id) : String(id).split(":")[1]) : null;
    const label = id => !id ? "To be decided" : c.format === "team" ? tName(id) : (c.entrants || []).find(e => e.id === id)?.label || "Unknown player";
    if (c.structure === "full") {
      for (const m of cupMatches(c, teams, venues)) {
        if (m.bye || m.empty || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) continue;
        if ((team || division) && !wanted([...m.couldA, ...m.couldB].map(teamOf), false)) continue;
        const res = Number.isFinite(m.aPins) && Number.isFinite(m.bPins);
        add(`${c.id}-${m.id}@skittlers`, m.date, m.time, `${c.name} ${m.roundName === "Final" ? "final" : m.roundName.toLowerCase()}: ${label(m.a)} ${res ? `${m.aPins}–${m.bPins}` : "v"} ${label(m.b)}`,
          where(m.venue, m.alley), [`${league.name}: ${c.name}, ${m.roundName}`, !m.a || !m.b ? "Who plays depends on earlier results" : "", res ? "Result published" : ""].filter(Boolean).join("\n"));
      }
      continue;
    }
    const fin = c.final || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fin.date || "")) continue;
    if ((team || division) && !wanted((c.entrants || []).map(e => teamOf(e.id)), false)) continue;
    add(`${c.id}-final@skittlers`, fin.date, fin.time, `${c.name} final`, where(fin.venue, fin.alley), `${league.name}: ${c.name}`);
  }
  const name = `${league.name}${team ? `: ${tName(team)}` : division ? `: ${divs[division]?.name || "Division"}` : ""}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Skittlers//League fixtures//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`, `X-WR-CALDESC:${icsText(`Fixtures for ${season?.name || "the season"}`)}`, "X-WR-TIMEZONE:Europe/London",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H", ...LONDON_TZ, ...events.flat(), "END:VCALENDAR"];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

export const BOARD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const BOARD_LIMITS = { images: 2, imageChars: 3_500_000, teams: 2, players: 60 };
const GAME_NAMES = { rough: "rough skittles", nomination: "nomination skittles" };
// Checks what the page sent about the match: which teams, their players, and how the game is played.
export function boardMatch(b) {
  if (!isObj(b)) return null;
  const n = (v, lo, hi) => { v = Number(v); return Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
  const hands = n(b.hands, 1, 20), balls = n(b.balls, 1, 5);
  if (!hands || !balls || !Array.isArray(b.teams) || !b.teams.length || b.teams.length > BOARD_LIMITS.teams) return null;
  const teams = b.teams.map(t => isObj(t) && Array.isArray(t.players) && t.players.length <= BOARD_LIMITS.players ? {
    title: cleanText(t.title, 80), rows: n(t.rows, 1, 16) || 1,
    players: t.players.filter(isObj).map(p => ({ key: cleanText(p.key, 80), name: cleanText(p.name, 60), nick: cleanText(p.nick, 30) })).filter(p => p.key && p.name),
  } : null);
  if (teams.some(t => !t || !t.title)) return null;
  return { title: cleanText(b.title, 160), game: GAME_NAMES[b.game] ? b.game : "rough", hands, balls, teams };
}
export const BOARD_SCHEMA = {
  type: "object", additionalProperties: false, required: ["teams", "notes"],
  properties: {
    teams: { type: "array", items: { type: "object", additionalProperties: false, required: ["team", "rows", "handTotals", "writtenTotal"],
      properties: {
        team: { type: "integer", description: "Which team this block of the board is: its number in the list of teams." },
        rows: { type: "array", items: { type: "object", additionalProperties: false, required: ["boardName", "playerKey", "hands", "spares", "unsure", "writtenTotal"],
          properties: {
            boardName: { type: "string", description: "The name exactly as written on the board." },
            playerKey: { type: "string", description: "The key of the matching player from this team's list, or an empty string if none fits." },
            hands: { type: "array", items: { type: "integer" }, description: "One score per hand, in order." },
            spares: { type: "array", items: { type: "boolean" }, description: "One per hand: true when that score is circled (a spare)." },
            unsure: { type: "array", items: { type: "integer" }, description: "0-based hand numbers whose score was hard to read." },
            writtenTotal: { type: "integer", description: "The total written at the end of the row, or -1 if there is none." },
          } } },
        handTotals: { type: "array", items: { type: "integer" }, description: "The team's hand totals written under the rows, or an empty list." },
        writtenTotal: { type: "integer", description: "The team total written on the board, or -1 if there is none." },
      } } },
    notes: { type: "string", description: "Anything the secretary should check, in one or two short sentences, or an empty string." },
  },
};
export function boardPrompt(m) {
  const max = 9 * m.balls;
  const teams = m.teams.map((t, i) => `Team ${i}: ${t.title} (up to ${t.rows} player${t.rows === 1 ? "" : "s"} on the board)
Players (key | name | nickname):
${t.players.map(p => `${p.key} | ${p.name} | ${p.nick || "-"}`).join("\n") || "(no players listed)"}`).join("\n\n");
  return `This is a photo of a skittles scoreboard, usually a chalkboard in a pub alley. Read it so the league secretary doesn't have to type the scores in. They will check your reading before it is saved.

The match: ${m.title || "a skittles match"}. The game is ${GAME_NAMES[m.game]}. Each player throws ${m.hands} hand${m.hands === 1 ? "" : "s"} of ${m.balls} ball${m.balls === 1 ? "" : "s"}, so a hand scores from 0 up to ${max}.

${teams}

How these boards are written:
- Each team is a block of rows: home team on the left and away team on the right, or one block above the other. The block's names tell you which team it is.
- Each row is one player: a name, then one score per hand, then usually the player's total. Names are often a first name, a nickname, a surname or initials; "Jr" or "Snr" tells relatives apart.
- A circled score is a spare. Mark it in spares.
- Under each block there may be a row of hand totals, the team total, and a row of winning margins or crosses. Don't report those as players, but use them to check your reading of each column.

What to send back:
- One entry in teams for each team on the board, with team set to its number above.
- The rows in the order they are written, top to bottom. That is the order the players threw in, so keep it.
- For each row, the player it matches from that team's list as playerKey. Use each key at most once per team. If no player fits, use an empty string and keep the written name in boardName.
- Every hand's score as a number. If you can't read one with confidence, give your best reading and add its 0-based hand number to unsure.
- writtenTotal for each row and team as written on the board (-1 when there is none), and the hand totals if they're written.
- notes: anything the secretary should look at, such as a name you couldn't match or a total that doesn't add up. Leave it empty if everything is clear.

Reply with only a JSON object in exactly this shape:
{"teams":[{"team":0,"rows":[{"boardName":"Dave","playerKey":"dave smith","hands":[7,6,9,5,8,7],"spares":[false,false,true,false,false,false],"unsure":[],"writtenTotal":42}],"handTotals":[37,33,42,37,41,41],"writtenTotal":231}],"notes":""}`;
}
// Tidies Claude's answer: only known teams and players, whole-number scores within range, one entry per hand.
export function parseBoard(raw, m) {
  const out = { teams: [], notes: cleanText(raw?.notes, 400) };
  const int = v => { v = Number(v); return Number.isFinite(v) ? Math.round(v) : null; };
  const seenTeams = new Set();
  for (const t of Array.isArray(raw?.teams) ? raw.teams : []) {
    const i = int(t?.team);
    if (i === null || !m.teams[i] || seenTeams.has(i) || !Array.isArray(t.rows)) continue;
    seenTeams.add(i);
    const known = new Set(m.teams[i].players.map(p => p.key)), used = new Set();
    const rows = t.rows.slice(0, 16).filter(isObj).map(r => {
      let key = typeof r.playerKey === "string" && known.has(r.playerKey) && !used.has(r.playerKey) ? r.playerKey : "";
      if (key) used.add(key);
      const hands = Array.from({ length: m.hands }, (_, h) => { const v = int(r.hands?.[h]); return v !== null && v >= 0 && v <= 9 * m.balls ? v : null; });
      const unsure = [...new Set((Array.isArray(r.unsure) ? r.unsure : []).map(int).filter(h => h !== null && h >= 0 && h < m.hands))];
      hands.forEach((v, h) => { if (v === null && !unsure.includes(h)) unsure.push(h); });
      const total = int(r.writtenTotal);
      return { boardName: cleanText(r.boardName, 40), key, hands, spares: hands.map((v, h) => v !== null && r.spares?.[h] === true), unsure: unsure.sort((a, b) => a - b), writtenTotal: total !== null && total >= 0 ? total : null };
    });
    const tt = int(t.writtenTotal);
    out.teams.push({ team: i, rows, handTotals: (Array.isArray(t.handTotals) ? t.handTotals : []).slice(0, m.hands).map(int).map(v => v !== null && v >= 0 ? v : null),
      writtenTotal: tt !== null && tt >= 0 ? tt : null });
  }
  return out;
}
export const cleanBody = v => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);

/* ---------- match night reports ---------- */
// When a match night's results are all in, the site gathers the facts (results, top scores, table changes,
// form, records, next week's games) and Claude writes them up as a news report. It is saved as a draft for
// the secretary to check and publish. Claude is told to use only these facts.
export const REPORT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "body"],
  properties: {
    title: { type: "string", description: "A short newspaper-style headline, at most 90 characters." },
    body: { type: "string", description: "The report as plain text, paragraphs separated by a blank line." },
  },
};
export function reportPrompt(facts) {
  return `You write the weekly match report for a skittles league's website, like a local newspaper's sports page. The league secretary will check it before it's published.

Here are the facts for one match night, worked out from the league's own results and scorecards, as JSON:

${JSON.stringify(facts)}

Write the report:
- British English, warm and lively but not over the top. 250 to 450 words.
- Use only these facts. Don't invent scores, quotes, reasons or events, and don't guess at anything not given. If something isn't in the facts, leave it out.
- Lead with the biggest story of the night: a cup final, an upset, a big win, a record, or a change at the top of a table. When the only game was a cup final, the report is about that final.
- Then round up the results, division by division, and any cup games. Mention the star performers, best hands and notable spares, table movements and form, and any records or personal bests.
- Finish with a short look ahead to the next match night if it's given.
- Call players by the names given; a nickname can go in quotes after a first name now and then.
- Plain text only: no markdown, no bullet points, no headings inside the body. Separate paragraphs with a blank line.

Reply with only a JSON object: {"title": "the headline", "body": "the report"}`;
}

const hmacKeys = new Map();
async function hmac(webcrypto, secret, text) {
  if (!hmacKeys.has(secret)) hmacKeys.set(secret, await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  const sig = new Uint8Array(await webcrypto.subtle.sign("HMAC", hmacKeys.get(secret), new TextEncoder().encode(text)));
  return [...sig].map(b => b.toString(16).padStart(2, "0")).join("");
}
// Saves what happened to a report into its draft news post (if the post still exists).
async function setNewsItem(store, lid, id, fields) {
  const doc = await store.get(`news/${lid}`), item = doc?.items?.find(x => x.id === id);
  if (!item) return;
  Object.assign(item, fields);
  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  await store.set(`news/${lid}`, doc);
}
// Runs one reading job: sends the photos to Claude through read({images, prompt, schema}), tidies the answer and
// stores it for the page to collect. The photos are deleted once the job is done, whatever happens.
export function createBoardRunner({ store, webcrypto, env = {}, read }) {
  async function runReport(key, job) {
    try {
      const raw = await read({ images: [], prompt: reportPrompt(job.facts), schema: REPORT_SCHEMA });
      const title = cleanText(raw?.title, 120), body = cleanBody(raw?.body);
      if (!title || !body) throw new Error("The report came back empty. Try again.");
      await setNewsItem(store, job.league, job.newsId, { status: "draft", title, body, error: undefined, drafted: new Date().toISOString() });
    } catch (e) {
      await setNewsItem(store, job.league, job.newsId, { status: "failed", error: String(e?.message || e || "").slice(0, 300) || "The report couldn't be written." });
    }
    await store.del(key);
  }
  return {
    sign: key => hmac(webcrypto, env.SESSION_SECRET, "board:" + key),
    async verify(key, sig) { return typeof key === "string" && /^board-jobs\/[a-z0-9]+\/[a-z0-9]+$/.test(key) && typeof sig === "string" && sig === await hmac(webcrypto, env.SESSION_SECRET, "board:" + key); },
    async run(key) {
      const job = await store.get(key);
      if (job?.kind === "report") return runReport(key, job);
      if (!job || job.status !== "reading") return;
      try {
        const raw = await read({ images: job.images, prompt: boardPrompt(job.match), schema: BOARD_SCHEMA });
        await store.set(key, { ...job, images: null, status: "done", result: parseBoard(raw, job.match), finished: new Date().toISOString() });
      } catch (e) {
        await store.set(key, { ...job, images: null, status: "failed", error: String(e?.message || e || "").slice(0, 300) || "The photo couldn't be read.", finished: new Date().toISOString() });
      }
    },
  };
}

export function createApi({ store, webcrypto, env = {}, legacy = null, today = () => new Date().toISOString().slice(0, 10), pause = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), startBoardJob = null, sendEmail = null }) {
  // Email goes out through Resend (resend.com) when RESEND_API_KEY and MAIL_FROM are set; otherwise it's skipped.
  const mail = sendEmail || (env.RESEND_API_KEY && env.MAIL_FROM ? async ({ to, subject, text, replyTo }) => {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }) });
    if (!r.ok) throw new Error(`Resend answered ${r.status}`);
  } : null);
  const subtle = webcrypto.subtle, enc = new TextEncoder();

  /* ---------- crypto ---------- */
  const b64u = buf => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const randomId = (len = 16) => [...webcrypto.getRandomValues(new Uint8Array(len))].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const safeEqual = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  async function pbkdf2(password, salt, iterations) {
    const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return b64u(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt, iterations }, key, 256));
  }
  async function hashPassword(password) {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    return { salt: b64u(salt), hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), iterations: PBKDF2_ITERATIONS };
  }
  const verifyPassword = async (password, rec) => !!rec?.hash && safeEqual(await pbkdf2(password, fromB64u(rec.salt), rec.iterations), rec.hash);
  let hmacKey;
  async function sign(text) {
    hmacKey ||= await subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64u(await subtle.sign("HMAC", hmacKey, enc.encode(text)));
  }

  /* ---------- accounts ---------- */
  const isSuper = u => !!env.SUPERADMIN_EMAIL && normEmail(env.SUPERADMIN_EMAIL) === u.email;
  const subActive = u => isSuper(u) || (u.subscription?.until || "") >= today();
  const publicUser = u => ({ id: u.id, email: u.email, name: u.name, created: u.created, subscription: u.subscription, photos: u.photos || null, reports: u.reports || null, isSuper: isSuper(u), canEdit: subActive(u) });
  const longDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const subEnded = u => `Your subscription ended on ${u.subscription?.until ? longDate(u.subscription.until) : "an earlier date"}. You can still view your leagues, but changes are paused until it's renewed.`;
  // Token: <userId>.<expiry ms>.<session version>.<signature>. Changing a password bumps the version, logging out other devices.
  async function makeToken(u) {
    const body = `${u.id}.${Date.now() + SESSION_DAYS * 864e5}.${u.sessionV || 0}`;
    return `${body}.${await sign(body)}`;
  }
  async function currentUser(req) {
    const m = /^Bearer ([a-z0-9]+)\.(\d+)\.(\d+)\.([\w-]+)$/.exec(req.headers.get("authorization") || "");
    if (!m || Number(m[2]) < Date.now() || !safeEqual(await sign(`${m[1]}.${m[2]}.${m[3]}`), m[4])) return null;
    const u = await store.get(`users/${m[1]}`);
    return u && String(u.sessionV || 0) === m[3] ? u : null;
  }
  async function allUsers() { return (await Promise.all((await store.list("users/")).map(k => store.get(k)))).filter(Boolean); }

  /* ---------- leagues & seasons ---------- */
  const seasonKey = (lid, sid) => `seasons/${lid}/${sid}`;
  const contactsKey = (lid, sid) => `contacts/${lid}/${sid}`;

  /* ---------- automatic backups ---------- */
  // Before a season is changed, a copy of it (with its contacts) is kept, at most one every 10 minutes
  // (or straight away before anything is removed), and the newest 40 are kept. A small index lists them so they can be shown without loading each one.
  const HISTORY_GAP = 10 * 60 * 1000, HISTORY_KEEP = 40;
  const historyIndexKey = (lid, sid) => `history-index/${lid}/${sid}`;
  const historyKey = (lid, sid, hid) => `history/${lid}/${sid}/${hid}`;
  const seasonCounts = d => ({ teams: Object.keys(d.teams || {}).length, fixtures: Object.keys(d.fixtures || {}).length,
    results: Object.values(d.fixtures || {}).filter(f => Number.isFinite(f.homePins)).length, cups: Object.keys(d.cups || {}).length });
  async function keepCopy(lid, sid, user, { force = false, reason = "" } = {}) {
    const data = await store.get(seasonKey(lid, sid)); if (!data) return;
    const index = await store.get(historyIndexKey(lid, sid)) || [];
    const t = now();
    if (!force && index.length && t - Date.parse(index[0].at) < HISTORY_GAP) return;
    const hid = new Date(t).toISOString().replace(/[:.]/g, "-");
    await store.set(historyKey(lid, sid, hid), { data, contacts: await store.get(contactsKey(lid, sid)) || {} });
    index.unshift({ id: hid, at: new Date(t).toISOString(), version: data.version, by: user?.name || "", reason, ...seasonCounts(data) });
    for (const old of index.splice(HISTORY_KEEP)) await store.del(historyKey(lid, sid, old.id));
    await store.set(historyIndexKey(lid, sid), index);
  }
  async function dropHistory(lid, sid) {
    for (const k of await store.list(`history/${lid}/${sid}/`)) await store.del(k);
    await store.del(historyIndexKey(lid, sid));
  }
  // Writes a whole season (from a backup or an earlier copy) as the next version.
  async function replaceSeason(lid, sid, data, contacts) {
    const current = await store.get(seasonKey(lid, sid)) || emptySeason();
    const next = { version: current.version + 1, updatedAt: new Date(now()).toISOString(), teams: data.teams, venues: data.venues, fixtures: data.fixtures, divisions: data.divisions || {}, cups: data.cups || {}, transfers: data.transfers || {}, committee: data.committee || {} };
    await store.set(contactsKey(lid, sid), contacts);
    await store.set(seasonKey(lid, sid), next);
    return { ...next, contacts };
  }
  const validSeason = (data, contacts) => isObj(data) && isObj(contacts) && ["teams", "venues", "fixtures"].every(k => isObj(data[k])) && ["divisions", "cups", "transfers", "committee"].every(k => data[k] === undefined || isObj(data[k]));
  const canManage = (u, l) => !!u && (isSuper(u) || l.ownerId === u.id);
  /* ---------- news and photos ---------- */
  // News posts: one document per league, newest first. Photos: a small index per league, with each photo
  // (and a smaller copy for the gallery) stored on its own and served as an image.
  const newsKey = lid => `news/${lid}`, mediaIndexKey = lid => `media-index/${lid}`;
  // Help & requests: support/<userId> = { userId, name, email, leagues, updated, unreadAdmin, unreadUser,
  // messages: [{ id, from: "user" | "admin", text, at, by? }] }, the newest SUPPORT_KEEP messages kept.
  const supportKey = uid => `support/${uid}`, SUPPORT_KEEP = 400;
  const allThreads = async () => (await Promise.all((await store.list("support/")).map(k => store.get(k)))).filter(Boolean);
  // A message keeps its line breaks; runs of blank lines are squeezed and it's capped at 4000 characters.
  const cleanMessage = v => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  // Results sent in by captains, per season: { items: [{ id, fixtureId, date, home, away, team, homePins, awayPins,
  // cards: { home, away }, name, note, contact, created, status: "pending" | "approved" | "rejected", decided?, by? }] }.
  const submissionsKey = (lid, sid) => `submissions/${lid}/${sid}`;
  const SUBMISSIONS_KEEP = 60;
  const mediaKey = (lid, mid, thumb) => `media/${lid}/${mid}${thumb ? "/thumb" : ""}`;
  const NEWS_MAX = 200, MEDIA_MAX = 300, IMAGE_MAX = 900_000, THUMB_MAX = 200_000;
  const sortNews = items => items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.created.localeCompare(a.created));
  const validImage = (i, max) => isObj(i) && ["image/jpeg", "image/png", "image/webp"].includes(i.mediaType) && typeof i.data === "string" && i.data.length > 100 && i.data.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(i.data) && i.data.length % 4 === 0;
  function newsFields(b, item) {
    const title = cleanText(b.title ?? item.title, 120), body = b.body !== undefined ? cleanBody(b.body) : item.body;
    if (!title) throw [400, "Give the post a title."];
    if (!body) throw [400, "Write something in the post."];
    const photos = Array.isArray(b.photos) ? [...new Set(b.photos.filter(id => typeof id === "string" && /^[a-z0-9]{1,20}$/.test(id)))].slice(0, 6) : item.photos || [];
    return { title, body, pinned: b.pinned !== undefined ? b.pinned === true : !!item.pinned, photos };
  }
  // Drafts (and reports still being written) are only for admins; everyone else sees published posts.
  const published = items => items.filter(x => !x.status);
  const adminNews = items => items.map(x => x.status === "drafting" && now() - Date.parse(x.created) > 5 * 60 * 1000 ? { ...x, status: "failed", error: "Writing the report took too long. Try again." } : x);
  function mediaFields(b, item) {
    const out = { caption: b.caption !== undefined ? cleanText(b.caption, 200) : item.caption || "" };
    if (b.cupId !== undefined) { out.cupId = b.cupId ? cleanText(b.cupId, 40) : null; out.cupName = b.cupId ? cleanText(b.cupName, 80) : null; }
    else { out.cupId = item.cupId || null; out.cupName = item.cupName || null; }
    if (b.seasonId !== undefined) out.seasonId = b.seasonId ? cleanText(b.seasonId, 40) : null; else out.seasonId = item.seasonId || null;
    return out;
  }
  async function dropNewsAndMedia(lid) {
    for (const k of [...await store.list(`media/${lid}/`), ...await store.list(`docs/${lid}/`)]) await store.del(k);
    await store.del(mediaIndexKey(lid)); await store.del(newsKey(lid)); await store.del(docsIndexKey(lid));
  }
  /* ---------- downloads: documents a league puts up for anyone to download ---------- */
  // docs-index/<league> = [{ id, title, category, name, type, size, created, by }], newest first;
  // each file at docs/<league>/<id> = { type, data (base64) }. Only these kinds, checked by their first bytes too.
  const docsIndexKey = lid => `docs-index/${lid}`, docKey = (lid, id) => `docs/${lid}/${id}`;
  const DOCS_MAX = 60, DOC_BYTES = 4_000_000;
  const DOC_TYPES = {
    pdf: { type: "application/pdf", magic: "%PDF" },
    docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: "PK" },
    xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: "PK" },
    doc: { type: "application/msword", magic: "\xD0\xCF\x11\xE0" }, xls: { type: "application/vnd.ms-excel", magic: "\xD0\xCF\x11\xE0" },
    jpg: { type: "image/jpeg", magic: "\xFF\xD8\xFF" }, jpeg: { type: "image/jpeg", magic: "\xFF\xD8\xFF" }, png: { type: "image/png", magic: "\x89PNG" },
    csv: { type: "text/csv", text: true }, txt: { type: "text/plain", text: true },
  };
  // A file name with only safe characters, keeping its extension.
  const docName = n => cleanText(n, 120).replace(/[^\w .()&-]+/g, "_").replace(/^[._ ]+/, "") || "document";
  const docFields = (b, old) => ({ title: b.title !== undefined ? cleanText(b.title, 120) || old.title : old.title, category: b.category !== undefined ? cleanText(b.category, 40) : old.category || "" });
  /* ---------- add-ons: photo reading and match night reports ---------- */
  // The overall admin decides, for each add-on, whether it's included in the basic subscription (for every
  // account with an active subscription) or an extra that's given to chosen accounts: users/<id>.photos or
  // .reports = { until, monthlyLimit }. Each league counts its uses per month; a monthly limit of 0 means none.
  const ADDONS = { photos: { name: "Photo reading", count: "photo readings" }, reports: { name: "Match night reports", count: "match night reports" } };
  const month = () => today().slice(0, 7);
  const usageKey = (lid, m = month()) => `usage/${lid}/${m}`;
  async function siteSettings() {
    const s = await store.get("site/settings") || {};
    return { addons: Object.fromEntries(Object.keys(ADDONS).map(k => [k, { mode: "extra", monthlyLimit: 0, price: 0, ...(s.addons?.[k] || {}) }])) };
  }
  async function addonStatus(user, league, kind) {
    const A = ADDONS[kind], site = (await siteSettings()).addons[kind];
    const owner = league.ownerId === user.id ? user : await store.get(`users/${league.ownerId}`);
    const used = (await store.get(usageKey(league.id)))?.[kind] || 0, grant = owner?.[kind], until = grant?.until || null;
    let reason = null, limit = 0;
    if (!startBoardJob) reason = `${A.name} isn't switched on for this site yet.`;
    else if (isSuper(user)) limit = 0;
    else if (site.mode === "included") { limit = site.monthlyLimit || 0; if (!owner || !subActive(owner)) reason = subEnded(owner || {}); }
    else if (!(until && until >= today())) {
      const price = site.price ? ` It's £${(site.price / 100).toFixed(2)} a year.` : "";
      reason = until ? `The ${A.name.toLowerCase()} add-on ended on ${longDate(until)}.${price}` : `${A.name} is an add-on to the league subscription.${price} Ask the site admin to add it.`;
    }
    else limit = grant.monthlyLimit || 0;
    if (!reason && limit && used >= limit) reason = `This league has used all ${limit} ${A.count} for this month.`;
    return { available: !reason, reason, used, limit, until, mode: site.mode };
  }
  const photoStatus = (user, league) => addonStatus(user, league, "photos");
  async function countUse(lid, kind, by = 1) {
    const usage = await store.get(usageKey(lid)) || {};
    usage[kind] = (usage[kind] || 0) + by; await store.set(usageKey(lid), usage);
    return usage[kind];
  }
  // takesResults: captains can send in results (the league has a captains' code). The code itself is never public.
  const publicLeague = l => ({ id: l.id, slug: l.slug, name: l.name, settings: l.settings, seasons: l.seasons, currentSeasonId: l.currentSeasonId, takesResults: !!l.captainCode });
  async function allLeagues() { return (await Promise.all((await store.list("leagues/")).map(k => store.get(k)))).filter(Boolean); }
  async function leagueBySlug(slug) { const s = await store.get(`slugs/${String(slug).toLowerCase()}`); return s ? store.get(`leagues/${s.leagueId}`) : null; }
  async function slugProblem(slug, exceptId) {
    if (!SLUG_RE.test(slug)) return "Use 3 to 40 lower-case letters, numbers or hyphens, starting and ending with a letter or number.";
    if (RESERVED_SLUGS.has(slug)) return "That address is reserved for the site. Try another.";
    const s = await store.get(`slugs/${slug}`);
    return s && s.leagueId !== exceptId ? "That address is already taken. Try another." : null;
  }
  function seasonFields(b, current = {}) {
    const name = cleanText(b.name ?? current.name, 40), start = b.start ?? current.start, end = b.end ?? current.end;
    if (!name) throw [400, "Give the season a name, such as 2026–27."];
    if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) throw [400, "Choose the season's start and finish dates."];
    if (end < start) throw [400, "The finish date must be after the start date."];
    return { name, start, end };
  }
  const sortSeasons = l => l.seasons.sort((a, b) => a.start.localeCompare(b.start));
  // Builds a new season from an earlier one: venues, teams (with captains' details), players and divisions are each optional.
  function copySeason(src, srcContacts, opt) {
    const data = emptySeason(), contacts = {};
    if (opt.venues) data.venues = clone(src.venues || {});
    if (opt.divisions) data.divisions = clone(src.divisions || {});
    if (opt.teams) for (const t of Object.values(src.teams || {})) {
      const nt = clone(t);
      if (!opt.venues) { nt.venue = null; nt.alley = null; }
      if (!opt.players) nt.players = [];
      if (!opt.divisions) delete nt.division;
      data.teams[t.id] = nt;
      if (srcContacts?.[t.id]) contacts[t.id] = clone(srcContacts[t.id]);
    }
    return { data, contacts };
  }
  async function readBody(req, limit = MAX_BODY) {
    const text = await req.text();
    if (text.length > limit) throw [413, limit > MAX_BODY ? "That's too big to send. Try a smaller file, or one photo at a time." : "That's too much data to save in one go."];
    try { return text ? JSON.parse(text) : {}; } catch { throw [400, "The data sent wasn't valid."]; }
  }

  async function route(req) {
    const url = new URL(req.url), M = req.method;
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const is = (method, ...pattern) => method === M && pattern.length === parts.length && pattern.every((p, i) => p[0] === ":" || p === parts[i]);
    if (!env.SESSION_SECRET) return fail(500, "SESSION_SECRET hasn't been set up on Netlify yet.");

    /* public */
    if (is("GET", "public", ":slug")) {
      const l = await leagueBySlug(parts[1]);
      return l ? json({ league: publicLeague(l) }) : fail(404, "There's no league at this address.");
    }
    if (is("GET", "public", ":slug", "seasons", ":sid")) {
      const l = await leagueBySlug(parts[1]);
      if (!l || !l.seasons.some(s => s.id === parts[3])) return fail(404, "That season couldn't be found.");
      return json(publicSeason(await store.get(seasonKey(l.id, parts[3])) || emptySeason()));
    }
    if (is("GET", "public", ":slug", "news")) {
      const l = await leagueBySlug(parts[1]); if (!l) return fail(404, "There's no league at this address.");
      return json({ items: published((await store.get(newsKey(l.id)))?.items || []) });
    }
    if (is("GET", "public", ":slug", "media")) {
      const l = await leagueBySlug(parts[1]); if (!l) return fail(404, "There's no league at this address.");
      return json({ items: await store.get(mediaIndexKey(l.id)) || [] });
    }
    // Downloads: the list, and each file. PDFs and pictures open in the browser; everything else downloads.
    if (is("GET", "public", ":slug", "docs")) {
      const l = await leagueBySlug(parts[1]); if (!l) return fail(404, "There's no league at this address.");
      return json({ items: await store.get(docsIndexKey(l.id)) || [] });
    }
    if (is("GET", "public", ":slug", "docs", ":did")) {
      const l = await leagueBySlug(parts[1]); if (!l || !/^[a-z0-9]+$/.test(parts[3])) return fail(404, "That file couldn't be found.");
      const item = (await store.get(docsIndexKey(l.id)) || []).find(x => x.id === parts[3]), file = item && await store.get(docKey(l.id, item.id));
      if (!file) return fail(404, "That file couldn't be found.");
      let bin; try { bin = atob(file.data); } catch { return fail(404, "That file couldn't be found."); }
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const inline = /^(application\/pdf|image\/(jpeg|png))$/.test(file.type) && url.searchParams.get("download") !== "1";
      return new Response(bytes, { headers: { "content-type": file.type, "content-length": String(bytes.length), "x-content-type-options": "nosniff", "cache-control": "public, max-age=300",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${item.name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(item.name)}` } });
    }
    // A photo as an image, for <img> tags. ?size=thumb gives the smaller gallery copy.
    if (is("GET", "public", ":slug", "media", ":mid")) {
      const l = await leagueBySlug(parts[1]); if (!l || !/^[a-z0-9]+$/.test(parts[3])) return fail(404, "That photo couldn't be found.");
      const img = await store.get(mediaKey(l.id, parts[3], url.searchParams.get("size") === "thumb")) || await store.get(mediaKey(l.id, parts[3]));
      if (!img) return fail(404, "That photo couldn't be found.");
      let bin; try { bin = atob(img.data); } catch { return fail(404, "That photo couldn't be found."); }
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes, { headers: { "content-type": img.mediaType, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    // A captain sends in a result. It waits for the secretary to approve it; nothing reaches the live site until then.
    if (is("POST", "public", ":slug", "seasons", ":sid", "submissions")) {
      const l = await leagueBySlug(parts[1]); if (!l) return fail(404, "There's no league at this address.");
      if (!l.captainCode) return fail(403, "This league isn't taking results from captains.");
      const b = await readBody(req);
      if (!safeEqual(String(b.code || "").trim().toLowerCase(), l.captainCode.toLowerCase())) return fail(403, "That captains' code isn't right. Check it with the league secretary.");
      const season = l.seasons.find(x => x.id === parts[3]); if (!season) return fail(404, "That season couldn't be found.");
      const owner = await store.get(`users/${l.ownerId}`);
      if (!owner || !subActive(owner)) return fail(402, "Results can't be sent in just now. Contact the league secretary.");
      const data = await store.get(seasonKey(l.id, season.id)) || emptySeason(), f = data.fixtures?.[b.fixtureId];
      if (!f || !f.date) return fail(404, "That fixture couldn't be found.");
      if (f.date > addDays(today(), 1)) return fail(400, "That game hasn't been played yet.");
      if (![f.home, f.away].includes(b.team)) return fail(400, "Choose your team.");
      const live = "pub" in f ? f.pub : f;
      if (Number.isFinite(live?.homePins) && Number.isFinite(live?.awayPins)) return fail(409, "This result is already on the website. Contact the league secretary if it needs changing.");
      const home = cleanCard(b.cards?.home), away = cleanCard(b.cards?.away);
      if (!home || !away) return fail(400, "Fill in both teams' scores.");
      const name = cleanText(b.name || ""), note = cleanText(b.note || "", 1000), contact = cleanText(b.contact || "", 120);
      if (name.length < 2) return fail(400, "Give your name.");
      const doc = await store.get(submissionsKey(l.id, season.id)) || { items: [] };
      const pending = doc.items.filter(x => x.status === "pending");
      if (pending.length >= 100 || pending.filter(x => x.fixtureId === f.id).length >= 3) return fail(429, "This result has already been sent in. The league secretary will check it soon.");
      const sum = c => c.rows.reduce((n, r) => n + r.total, 0);
      const item = { id: randomId(10), fixtureId: f.id, date: f.date, home: f.home, away: f.away, team: b.team, homePins: sum(home), awayPins: sum(away),
        cards: { home, away }, name, note, contact, created: new Date(now()).toISOString(), status: "pending" };
      doc.items = [item, ...doc.items.filter(x => x.status === "pending"), ...doc.items.filter(x => x.status !== "pending").slice(0, SUBMISSIONS_KEEP)];
      await store.set(submissionsKey(l.id, season.id), doc);
      // An email copy to the secretary. A failed email doesn't stop the result being saved.
      let emailed = false;
      if (mail && owner.email) {
        const tn = id => data.teams?.[id]?.name || "Unknown team";
        const card = (c, title) => [`${title}: ${sum(c)}`, ...c.rows.map(r => `  ${r.name}${r.nick ? ` "${r.nick}"` : ""}: ${c.mode === "hands" ? `${r.hands.map((h, i) => r.spares[i] ? `(${h})` : h).join(" ")} = ` : ""}${r.total}${r.spareScores?.length ? ` (spares ${r.spareScores.join(", ")})` : ""}`)].join("\n");
        try {
          await mail({ to: owner.email, replyTo: /@/.test(contact) ? contact : undefined, subject: `Result sent in: ${tn(f.home)} ${item.homePins}–${item.awayPins} ${tn(f.away)}`,
            text: [`${name} (${tn(b.team)}) sent in a result for ${l.name}.`, "", `${longDate(f.date)}`, `${tn(f.home)} ${item.homePins} – ${item.awayPins} ${tn(f.away)}`, "",
              card(home, tn(f.home)), "", card(away, tn(f.away)), note ? `\nNote: ${note}` : "", contact ? `\nContact: ${contact}` : "", "",
              `Check and approve it on Fixtures & results: ${url.origin}/${l.slug}#manage-fixtures`, "(Spares are in brackets.)"].join("\n") });
          emailed = true;
        } catch (e) { console.error("Couldn't email the result", e); }
      }
      return json({ ok: true, id: item.id, emailed });
    }
    // The season's fixtures as a calendar to subscribe to. ?team=<id> for one team's games; ?season=<id> for another season.
    if (is("GET", "public", ":slug", "calendar.ics")) {
      const l = await leagueBySlug(parts[1]); if (!l) return fail(404, "There's no league at this address.");
      const sid = url.searchParams.get("season") || l.currentSeasonId, season = l.seasons.find(x => x.id === sid);
      if (!season) return fail(404, "That season couldn't be found.");
      const data = await store.get(seasonKey(l.id, sid)) || emptySeason(), team = url.searchParams.get("team") || "", division = url.searchParams.get("division") || "";
      if (team && !data.teams?.[team]) return fail(404, "That team couldn't be found.");
      if (division && !data.divisions?.[division]) return fail(404, "That division couldn't be found.");
      const body = seasonCalendar({ league: l, season, data, team, division, url: `${url.origin}/${l.slug}#fixtures`, now: new Date(now()).toISOString() });
      return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "public, max-age=900",
        "content-disposition": `inline; filename="${l.slug}${team ? "-" + slugify(data.teams[team].name) : division ? "-" + slugify(data.divisions[division].name) : ""}.ics"` } });
    }
    if (is("GET", "slug-check")) {
      const p = await slugProblem(url.searchParams.get("slug") || "", url.searchParams.get("league") || undefined);
      return json({ available: !p, reason: p });
    }

    /* sign up & log in */
    if (is("POST", "auth", "signup")) {
      const b = await readBody(req), email = normEmail(b.email), name = cleanText(b.name), password = String(b.password || "");
      if (!name) return fail(400, "Enter your name.");
      if (!EMAIL_RE.test(email)) return fail(400, "Enter a valid email address.");
      if (password.length < 8) return fail(400, "Choose a password of at least 8 characters.");
      if (await store.get(`emails/${email}`)) return fail(409, "There's already an account with that email. Log in instead.");
      const u = { id: randomId(), email, name, created: today(), sessionV: 0, password: await hashPassword(password),
        subscription: { status: "trial", until: addDays(today(), TRIAL_DAYS) } };
      await store.set(`users/${u.id}`, u);
      await store.set(`emails/${email}`, { userId: u.id });
      return json({ token: await makeToken(u), user: publicUser(u) });
    }
    if (is("POST", "auth", "login")) {
      const b = await readBody(req), ref = await store.get(`emails/${normEmail(b.email)}`);
      const u = ref && await store.get(`users/${ref.userId}`);
      if (!u || !await verifyPassword(String(b.password || ""), u.password)) {
        await pause(700); // slows down password guessing
        return fail(401, "That email and password don't match an account.");
      }
      return json({ token: await makeToken(u), user: publicUser(u) });
    }

    const user = await currentUser(req);
    if (!user) return fail(401, "Please log in again.");

    if (is("GET", "auth", "me")) return json({ user: publicUser(user) });
    if (is("GET", "auth", "addons")) return json((await siteSettings()).addons);
    /* help & requests: one conversation per account with the overall admin */
    // How many replies are waiting for this account, and for the overall admin how many messages are waiting in the inbox.
    if (is("GET", "auth", "support", "unread")) {
      const mine = (await store.get(supportKey(user.id)))?.unreadUser || 0;
      const inbox = isSuper(user) ? (await allThreads()).reduce((n, t) => n + (t.unreadAdmin || 0), 0) : 0;
      return json({ mine, inbox });
    }
    if (is("GET", "auth", "support")) {
      const t = await store.get(supportKey(user.id));
      if (t?.unreadUser) { t.unreadUser = 0; await store.set(supportKey(user.id), t); }
      return json({ messages: t?.messages || [] });
    }
    if (is("POST", "auth", "support")) {
      const text = cleanMessage((await readBody(req)).text);
      if (!text) return fail(400, "Write your message first.");
      const t = await store.get(supportKey(user.id)) || { userId: user.id, messages: [], unreadAdmin: 0, unreadUser: 0 };
      const recent = t.messages.filter(m => m.from === "user" && now() - Date.parse(m.at) < 10 * 60e3).length;
      if (recent >= 20) return fail(429, "That's a lot of messages in a few minutes. Wait a little, then send again.");
      const leagues = (await allLeagues()).filter(l => l.ownerId === user.id).map(l => l.name);
      Object.assign(t, { name: user.name, email: user.email, leagues, updated: new Date(now()).toISOString(), unreadAdmin: (t.unreadAdmin || 0) + 1 });
      t.messages = [...t.messages, { id: randomId(8), from: "user", text, at: t.updated }].slice(-SUPPORT_KEEP);
      await store.set(supportKey(user.id), t);
      if (mail && env.SUPERADMIN_EMAIL && !isSuper(user))
        await mail({ to: env.SUPERADMIN_EMAIL, replyTo: user.email, subject: `Skittlers help: message from ${user.name}`,
          text: `${user.name} (${user.email})${leagues.length ? `, ${leagues.join(", ")}` : ""} wrote:\n\n${text}\n\nReply in Overall admin → Messages: ${url.origin}/#inbox` }).catch(e => console.error("Couldn't email the message", e));
      return json({ messages: t.messages });
    }
    if (is("POST", "auth", "password")) {
      const b = await readBody(req);
      if (!await verifyPassword(String(b.current || ""), user.password)) return fail(400, "Your current password isn't right.");
      if (String(b.next || "").length < 8) return fail(400, "Choose a new password of at least 8 characters.");
      user.password = await hashPassword(String(b.next)); user.sessionV = (user.sessionV || 0) + 1;
      await store.set(`users/${user.id}`, user);
      return json({ token: await makeToken(user), user: publicUser(user) });
    }

    /* leagues */
    if (is("GET", "my", "leagues")) {
      const all = await allLeagues(), mine = isSuper(user) ? all : all.filter(l => l.ownerId === user.id);
      const owners = isSuper(user) ? Object.fromEntries((await allUsers()).map(u => [u.id, { name: u.name, email: u.email }])) : {};
      return json({ leagues: mine.map(l => ({ ...publicLeague(l), ownerId: l.ownerId, created: l.created, owner: owners[l.ownerId] })) });
    }
    if (is("POST", "leagues")) {
      if (!subActive(user)) return fail(402, subEnded(user));
      const b = await readBody(req), name = cleanText(b.name), slug = String(b.slug || "").toLowerCase();
      if (name.length < 2) return fail(400, "Give the league a name.");
      const p = await slugProblem(slug); if (p) return fail(400, p);
      const l = { id: randomId(), slug, name, ownerId: user.id, created: today(), seasons: [], currentSeasonId: null, settings: { ...DEFAULT_SETTINGS } };
      applySettings(l.settings, b.settings);
      await store.set(`slugs/${slug}`, { leagueId: l.id });
      await store.set(`leagues/${l.id}`, l);
      return json({ league: publicLeague(l) });
    }

    if (parts[0] === "leagues" && parts[1]) {
      const league = await store.get(`leagues/${parts[1]}`);
      if (!league || !canManage(user, league)) return fail(404, "That league couldn't be found.");
      if (M !== "GET" && !subActive(user)) return fail(402, subEnded(user));
      const save = () => store.set(`leagues/${league.id}`, league);
      const season = parts[3] && league.seasons.find(s => s.id === parts[3]);
      if (parts[2] === "seasons" && parts[3] && !season) return fail(404, "That season couldn't be found.");

      if (is("PATCH", "leagues", ":id")) {
        const b = await readBody(req);
        if (b.name !== undefined) { const n = cleanText(b.name); if (n.length < 2) return fail(400, "Give the league a name."); league.name = n; }
        if (b.slug !== undefined && b.slug !== league.slug) {
          const slug = String(b.slug).toLowerCase(), p = await slugProblem(slug, league.id); if (p) return fail(400, p);
          await store.del(`slugs/${league.slug}`); await store.set(`slugs/${slug}`, { leagueId: league.id }); league.slug = slug;
        }
        applySettings(league.settings ||= {}, b.settings);
        // The captains' code: 4 to 30 letters, numbers or dashes, or empty to stop taking results.
        if (b.captainCode !== undefined) {
          const c = String(b.captainCode || "").trim();
          if (c && !/^[A-Za-z0-9-]{4,30}$/.test(c)) return fail(400, "The captains' code needs 4 to 30 letters, numbers or dashes.");
          league.captainCode = c;
        }
        if (b.currentSeasonId !== undefined) {
          if (!league.seasons.some(s => s.id === b.currentSeasonId)) return fail(400, "That season couldn't be found.");
          league.currentSeasonId = b.currentSeasonId;
        }
        await save();
        return json({ league: publicLeague(league) });
      }
      if (is("DELETE", "leagues", ":id")) {
        for (const s of league.seasons) { await store.del(seasonKey(league.id, s.id)); await store.del(contactsKey(league.id, s.id)); await store.del(submissionsKey(league.id, s.id)); await dropHistory(league.id, s.id); }
        for (const k of [...await store.list(`board-jobs/${league.id}/`), ...await store.list(`usage/${league.id}/`)]) await store.del(k);
        await dropNewsAndMedia(league.id);
        await store.del(`slugs/${league.slug}`); await store.del(`leagues/${league.id}`);
        return json({ deleted: true });
      }
      if (is("POST", "leagues", ":id", "seasons")) {
        const b = await readBody(req), s = { id: randomId(10), ...seasonFields(b) };
        let data = emptySeason(), contacts = {};
        if (b.copyFrom) {
          if (!league.seasons.some(x => x.id === b.copyFrom)) return fail(400, "The season to copy from couldn't be found.");
          ({ data, contacts } = copySeason(await store.get(seasonKey(league.id, b.copyFrom)) || emptySeason(),
            await store.get(contactsKey(league.id, b.copyFrom)) || {}, isObj(b.copy) ? b.copy : {}));
        }
        await store.set(seasonKey(league.id, s.id), data);
        await store.set(contactsKey(league.id, s.id), contacts);
        league.seasons.push(s); sortSeasons(league);
        if (b.makeCurrent || !league.currentSeasonId) league.currentSeasonId = s.id;
        await save();
        return json({ league: publicLeague(league), season: s });
      }
      if (is("PATCH", "leagues", ":id", "seasons", ":sid")) {
        Object.assign(season, seasonFields(await readBody(req), season)); sortSeasons(league);
        await save();
        return json({ league: publicLeague(league) });
      }
      if (is("DELETE", "leagues", ":id", "seasons", ":sid")) {
        league.seasons = league.seasons.filter(s => s.id !== season.id);
        if (league.currentSeasonId === season.id) league.currentSeasonId = league.seasons.at(-1)?.id || null;
        await store.del(seasonKey(league.id, season.id)); await store.del(contactsKey(league.id, season.id)); await store.del(submissionsKey(league.id, season.id)); await dropHistory(league.id, season.id);
        await save();
        return json({ league: publicLeague(league) });
      }
      if (is("GET", "leagues", ":id", "seasons", ":sid")) {
        const data = await store.get(seasonKey(league.id, season.id)) || emptySeason();
        return json({ ...data, contacts: await store.get(contactsKey(league.id, season.id)) || {} });
      }
      // Saves the whole season. If someone else saved since this copy was loaded, the save is refused (409) with the latest data.
      if (is("PUT", "leagues", ":id", "seasons", ":sid")) {
        const { version, data, contacts } = await readBody(req);
        if (!validSeason(data, contacts)) return fail(400, "The data sent wasn't valid.");
        const current = await store.get(seasonKey(league.id, season.id)) || emptySeason();
        if (version !== current.version)
          return fail(409, "conflict", { ...current, contacts: await store.get(contactsKey(league.id, season.id)) || {} });
        // A save that removes anything (teams, fixtures, results or cups) is always preceded by a copy.
        const before = seasonCounts(current), after = seasonCounts(data);
        await keepCopy(league.id, season.id, user, { force: Object.keys(before).some(k => after[k] < before[k]) });
        return json(await replaceSeason(league.id, season.id, data, contacts));
      }
      // Saves just the items that changed: each is a team, venue, fixture, division, cup or contact, set or
      // (with value null) removed. They're applied to the latest copy, so other people's changes to other items
      // are kept; "stale" tells the page that someone else saved in between, so it can reload.
      if (is("PATCH", "leagues", ":id", "seasons", ":sid", "data")) {
        const { base, changes } = await readBody(req);
        const KINDS = ["teams", "venues", "fixtures", "divisions", "cups", "transfers", "committee", "contacts"];
        if (!Array.isArray(changes) || !changes.length || changes.length > 2000 ||
            !changes.every(c => isObj(c) && KINDS.includes(c.in) && typeof c.id === "string" && c.id.length > 0 && c.id.length <= 100 && !["__proto__", "constructor", "prototype"].includes(c.id) && (c.value === null || isObj(c.value))))
          return fail(400, "The changes sent weren't valid.");
        const current = await store.get(seasonKey(league.id, season.id)) || emptySeason();
        const contacts = await store.get(contactsKey(league.id, season.id)) || {};
        const next = clone(current);
        for (const k of KINDS) if (k !== "contacts") next[k] ||= {};
        for (const c of changes) {
          const into = c.in === "contacts" ? contacts : next[c.in];
          if (c.value === null) delete into[c.id]; else into[c.id] = c.value;
        }
        const before = seasonCounts(current), after = seasonCounts(next);
        await keepCopy(league.id, season.id, user, { force: Object.keys(before).some(k => after[k] < before[k]) });
        next.version = current.version + 1; next.updatedAt = new Date(now()).toISOString();
        if (changes.some(c => c.in === "contacts")) await store.set(contactsKey(league.id, season.id), contacts);
        await store.set(seasonKey(league.id, season.id), next);
        return json({ version: next.version, updatedAt: next.updatedAt, stale: base !== current.version });
      }
      // Results sent in by captains, and the captains' code (only the league's admins see it).
      if (is("GET", "leagues", ":id", "seasons", ":sid", "submissions"))
        return json({ code: league.captainCode || "", items: (await store.get(submissionsKey(league.id, season.id)))?.items || [] });
      if (is("POST", "leagues", ":id", "seasons", ":sid", "submissions", ":sub")) {
        const b = await readBody(req), doc = await store.get(submissionsKey(league.id, season.id)) || { items: [] }, item = doc.items.find(x => x.id === parts[5]);
        if (!item) return fail(404, "That result couldn't be found.");
        if (!["approved", "rejected"].includes(b.status)) return fail(400, "Approve or reject it.");
        Object.assign(item, { status: b.status, decided: new Date(now()).toISOString(), by: user.name || "" });
        await store.set(submissionsKey(league.id, season.id), doc);
        return json({ items: doc.items });
      }
      if (is("GET", "leagues", ":id", "news")) return json({ items: adminNews((await store.get(newsKey(league.id)))?.items || []) });
      if (is("GET", "leagues", ":id", "addons")) return json({ photos: await addonStatus(user, league, "photos"), reports: await addonStatus(user, league, "reports") });
      if (is("POST", "leagues", ":id", "news")) {
        const doc = await store.get(newsKey(league.id)) || { items: [] }, b = await readBody(req);
        if (doc.items.length >= NEWS_MAX) return fail(400, `There's a limit of ${NEWS_MAX} posts. Delete some old ones first.`);
        const item = { id: randomId(10), ...newsFields(b, {}), created: new Date(now()).toISOString(), by: user.name, ...(b.draft === true ? { status: "draft" } : {}) };
        doc.items.push(item); sortNews(doc.items); await store.set(newsKey(league.id), doc);
        return json({ item, items: adminNews(doc.items) });
      }
      if (is("PATCH", "leagues", ":id", "news", ":nid") || is("DELETE", "leagues", ":id", "news", ":nid")) {
        const doc = await store.get(newsKey(league.id)) || { items: [] }, i = doc.items.findIndex(x => x.id === parts[3]);
        if (i < 0) return fail(404, "That post couldn't be found.");
        if (M === "DELETE") doc.items.splice(i, 1);
        else {
          const b = await readBody(req), item = { ...doc.items[i], ...newsFields(b, doc.items[i]), edited: new Date(now()).toISOString() };
          if (b.publish === true) {
            if (item.status === "drafting") return fail(409, "The report is still being written.");
            delete item.status; delete item.error; item.created = new Date(now()).toISOString(); delete item.edited;
          }
          doc.items[i] = item;
        }
        sortNews(doc.items); await store.set(newsKey(league.id), doc);
        return json({ items: adminNews(doc.items) });
      }
      if (is("POST", "leagues", ":id", "docs")) {
        const b = await readBody(req, Math.ceil(DOC_BYTES * 4 / 3) + 20_000), index = await store.get(docsIndexKey(league.id)) || [];
        if (index.length >= DOCS_MAX) return fail(400, `There's a limit of ${DOCS_MAX} files. Delete some old ones first.`);
        const name = docName(b.name), ext = name.split(".").pop().toLowerCase(), kind = DOC_TYPES[ext];
        if (!kind || name.indexOf(".") < 0) return fail(400, "That kind of file can't be added. Use a PDF, Word or Excel file, a CSV or text file, or a JPEG or PNG picture.");
        let bin; try { bin = atob(String(b.data || "")); } catch { bin = ""; }
        if (!bin.length) return fail(400, "That file is empty or couldn't be read.");
        if (bin.length > DOC_BYTES) return fail(413, `That file is too big. Files can be up to ${DOC_BYTES / 1e6} MB.`);
        if (kind.magic && !bin.startsWith(kind.magic)) return fail(400, `That file doesn't look like a real .${ext} file.`);
        if (kind.text && /[\x00-\x08\x0E-\x1F]/.test(bin.slice(0, 2000))) return fail(400, `That file doesn't look like a real .${ext} file.`);
        const id = randomId(12);
        await store.set(docKey(league.id, id), { type: kind.type, data: b.data });
        const item = { id, ...docFields(b, { title: name.replace(/\.[^.]+$/, "") }), name, type: kind.type, size: bin.length, created: new Date(now()).toISOString(), by: user.name };
        index.unshift(item); await store.set(docsIndexKey(league.id), index);
        return json({ item, items: index });
      }
      if (is("PATCH", "leagues", ":id", "docs", ":did") || is("DELETE", "leagues", ":id", "docs", ":did")) {
        const index = await store.get(docsIndexKey(league.id)) || [], i = index.findIndex(x => x.id === parts[3]);
        if (i < 0) return fail(404, "That file couldn't be found.");
        if (M === "DELETE") { index.splice(i, 1); await store.del(docKey(league.id, parts[3])); }
        else index[i] = { ...index[i], ...docFields(await readBody(req), index[i]) };
        await store.set(docsIndexKey(league.id), index);
        return json({ items: index });
      }
      if (is("POST", "leagues", ":id", "media")) {
        const b = await readBody(req), index = await store.get(mediaIndexKey(league.id)) || [];
        if (index.length >= MEDIA_MAX) return fail(400, `There's a limit of ${MEDIA_MAX} photos. Delete some old ones first.`);
        if (!validImage(b.image, IMAGE_MAX) || (b.thumb !== undefined && !validImage(b.thumb, THUMB_MAX))) return fail(400, "That photo couldn't be used. Try a JPEG or PNG photo.");
        const id = randomId(12), w = Number(b.width), h = Number(b.height);
        await store.set(mediaKey(league.id, id), { mediaType: b.image.mediaType, data: b.image.data });
        if (b.thumb) await store.set(mediaKey(league.id, id, true), { mediaType: b.thumb.mediaType, data: b.thumb.data });
        const item = { id, ...mediaFields(b, {}), width: Number.isInteger(w) && w > 0 && w < 20000 ? w : null, height: Number.isInteger(h) && h > 0 && h < 20000 ? h : null, created: new Date(now()).toISOString(), by: user.name };
        index.unshift(item); await store.set(mediaIndexKey(league.id), index);
        return json({ item, items: index });
      }
      if (is("PATCH", "leagues", ":id", "media", ":mid") || is("DELETE", "leagues", ":id", "media", ":mid")) {
        const index = await store.get(mediaIndexKey(league.id)) || [], i = index.findIndex(x => x.id === parts[3]);
        if (i < 0) return fail(404, "That photo couldn't be found.");
        if (M === "DELETE") {
          index.splice(i, 1); await store.del(mediaKey(league.id, parts[3])); await store.del(mediaKey(league.id, parts[3], true));
          const doc = await store.get(newsKey(league.id));
          if (doc?.items.some(n => n.photos?.includes(parts[3]))) { for (const n of doc.items) if (n.photos) n.photos = n.photos.filter(x => x !== parts[3]); await store.set(newsKey(league.id), doc); }
        }
        else index[i] = { ...index[i], ...mediaFields(await readBody(req), index[i]) };
        await store.set(mediaIndexKey(league.id), index);
        return json({ items: index });
      }
      // Starts writing a match night report. The page sends the night's facts when its last result is saved
      // ("auto", which does nothing if there's already a report for that night) or when an admin asks for one.
      if (is("POST", "leagues", ":id", "seasons", ":sid", "report")) {
        const b = await readBody(req, 300_000), date = String(b.date || "");
        if (!DATE_RE.test(date) || !isObj(b.facts) || JSON.stringify(b.facts).length > 120_000) return fail(400, "The match night details weren't valid.");
        const doc = await store.get(newsKey(league.id)) || { items: [] };
        const existing = doc.items.find(n => n.report?.date === date && n.report?.season === season.id && n.status);
        if (b.auto === true && doc.items.some(n => n.report?.date === date && n.report?.season === season.id)) return json({ skipped: true, items: adminNews(doc.items) });
        const status = await addonStatus(user, league, "reports");
        if (!status.available) return fail(403, status.reason);
        let item = existing;
        if (!item) {
          if (doc.items.length >= NEWS_MAX) return fail(400, `There's a limit of ${NEWS_MAX} posts. Delete some old ones first.`);
          item = { id: randomId(10), title: cleanText(b.title, 120) || `Match night report: ${longDate(date)}`, body: "", pinned: false, photos: [], created: new Date(now()).toISOString(), by: "Written by Claude for " + user.name, report: { date, season: season.id } };
          doc.items.push(item);
        }
        Object.assign(item, { status: "drafting", created: new Date(now()).toISOString() }); delete item.error;
        sortNews(doc.items); await store.set(newsKey(league.id), doc);
        const key = `board-jobs/${league.id}/${randomId(12)}`;
        await store.set(key, { key, kind: "report", league: league.id, season: season.id, newsId: item.id, created: new Date(now()).toISOString(), facts: b.facts });
        await countUse(league.id, "reports");
        try { await startBoardJob(key, req); }
        catch { await store.del(key); await countUse(league.id, "reports", -1); await setNewsItem(store, league.id, item.id, { status: "failed", error: "The report couldn't be started. Try again in a minute." }); }
        return json({ id: item.id, items: adminNews((await store.get(newsKey(league.id))).items) });
      }
      if (is("GET", "leagues", ":id", "photo-reading")) return json(await photoStatus(user, league));
      // Starts reading a photo of the board. The reading runs separately (it can take a minute); the page asks for the result.
      if (is("POST", "leagues", ":id", "seasons", ":sid", "read-board")) {
        const status = await photoStatus(user, league);
        if (!status.available) return fail(403, status.reason);
        const b = await readBody(req, BOARD_LIMITS.images * BOARD_LIMITS.imageChars + 200_000), match = boardMatch(b.match);
        const images = Array.isArray(b.images) ? b.images : [];
        if (!images.length || images.length > BOARD_LIMITS.images || !images.every(i => isObj(i) && BOARD_IMAGE_TYPES.includes(i.mediaType) && typeof i.data === "string" && i.data.length > 100 && i.data.length <= BOARD_LIMITS.imageChars && /^[A-Za-z0-9+/=]+$/.test(i.data)))
          return fail(400, "Choose one or two photos (JPEG, PNG or WebP).");
        if (!match) return fail(400, "The match details weren't valid.");
        const key = `board-jobs/${league.id}/${randomId(12)}`;
        await store.set(key, { key, league: league.id, season: season.id, by: user.id, created: new Date(now()).toISOString(), status: "reading", match, images: images.map(i => ({ mediaType: i.mediaType, data: i.data })) });
        const used = await countUse(league.id, "photos");
        try { await startBoardJob(key, req); }
        catch { await store.del(key); await countUse(league.id, "photos", -1); return fail(502, "The photo couldn't be sent for reading. Try again in a minute."); }
        return json({ job: key.split("/")[2], used, limit: status.limit });
      }
      if (is("GET", "leagues", ":id", "seasons", ":sid", "read-board", ":job")) {
        if (!/^[a-z0-9]+$/.test(parts[5])) return fail(404, "That reading couldn't be found.");
        const key = `board-jobs/${league.id}/${parts[5]}`, job = await store.get(key);
        if (!job || job.season !== season.id) return fail(404, "That reading couldn't be found.");
        if (job.status === "reading") {
          if (now() - Date.parse(job.created) < 5 * 60 * 1000) return json({ status: "reading" });
          await store.del(key); return json({ status: "failed", error: "Reading the photo took too long. Try again." });
        }
        await store.del(key);
        return json(job.status === "done" ? { status: "done", result: job.result } : { status: "failed", error: job.error || "The photo couldn't be read." });
      }
      if (is("GET", "leagues", ":id", "seasons", ":sid", "history"))
        return json({ copies: await store.get(historyIndexKey(league.id, season.id)) || [] });
      // Puts back an earlier copy. The season as it is now is kept first, so a restore can itself be undone.
      if (is("POST", "leagues", ":id", "seasons", ":sid", "history", ":hid")) {
        const copy = await store.get(historyKey(league.id, season.id, parts[5]));
        if (!copy) return fail(404, "That copy couldn't be found.");
        await keepCopy(league.id, season.id, user, { force: true, reason: "Before restoring an earlier copy" });
        return json(await replaceSeason(league.id, season.id, copy.data, copy.contacts));
      }
      // Restores the season from a downloaded backup file.
      if (is("POST", "leagues", ":id", "seasons", ":sid", "restore")) {
        const b = await readBody(req);
        if (b?.skittlersBackup !== 1 || !validSeason(b.data, b.contacts || {})) return fail(400, "That file isn't a Skittlers season backup.");
        await keepCopy(league.id, season.id, user, { force: true, reason: "Before restoring from a file" });
        return json(await replaceSeason(league.id, season.id, b.data, b.contacts || {}));
      }
    }

    /* overall admin */
    if (parts[0] === "super") {
      if (!isSuper(user)) return fail(404, "Not found.");
      // The help inbox: every conversation, newest first, and one conversation to read and reply to.
      if (is("GET", "super", "support"))
        return json({ threads: (await allThreads()).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))
          .map(t => ({ userId: t.userId, name: t.name, email: t.email, leagues: t.leagues || [], updated: t.updated, unread: t.unreadAdmin || 0, last: t.messages.at(-1) || null })) });
      if (is("GET", "super", "support", ":uid")) {
        const t = await store.get(supportKey(parts[2])); if (!t) return fail(404, "That conversation couldn't be found.");
        if (t.unreadAdmin) { t.unreadAdmin = 0; await store.set(supportKey(parts[2]), t); }
        return json({ thread: { userId: t.userId, name: t.name, email: t.email, leagues: t.leagues || [], messages: t.messages } });
      }
      if (is("POST", "super", "support", ":uid")) {
        const t = await store.get(supportKey(parts[2])); if (!t) return fail(404, "That conversation couldn't be found.");
        const text = cleanMessage((await readBody(req)).text);
        if (!text) return fail(400, "Write your reply first.");
        t.updated = new Date(now()).toISOString(); t.unreadUser = (t.unreadUser || 0) + 1; t.unreadAdmin = 0;
        t.messages = [...t.messages, { id: randomId(8), from: "admin", text, at: t.updated, by: user.name }].slice(-SUPPORT_KEEP);
        await store.set(supportKey(parts[2]), t);
        if (mail && t.email) await mail({ to: t.email, subject: "Skittlers: a reply to your message",
          text: `${user.name} replied:\n\n${text}\n\nSee the conversation and reply: ${url.origin}/#help` }).catch(e => console.error("Couldn't email the reply", e));
        return json({ thread: { userId: t.userId, name: t.name, email: t.email, leagues: t.leagues || [], messages: t.messages } });
      }
      if (is("GET", "super", "users")) {
        const leagues = await allLeagues();
        const usage = {}; for (const l of leagues) usage[l.id] = await store.get(usageKey(l.id)) || {};
        return json({ month: month(), photoReading: !!startBoardJob, addons: (await siteSettings()).addons,
          users: (await allUsers()).map(u => ({ ...publicUser(u), leagues: leagues.filter(l => l.ownerId === u.id).map(l => ({ id: l.id, name: l.name, slug: l.slug, photosThisMonth: usage[l.id].photos || 0, reportsThisMonth: usage[l.id].reports || 0 })) })) });
      }
      if (is("GET", "super", "settings")) return json(await siteSettings());
      if (is("PATCH", "super", "settings")) {
        const b = await readBody(req), current = await siteSettings();
        for (const k of Object.keys(ADDONS)) {
          const a = b.addons?.[k]; if (!isObj(a)) continue;
          const limit = Number(a.monthlyLimit ?? current.addons[k].monthlyLimit), price = a.price !== undefined ? Math.round(Number(a.price) * 100) : current.addons[k].price;
          if (!["included", "extra"].includes(a.mode ?? current.addons[k].mode) || !Number.isInteger(limit) || limit < 0 || limit > 10000) return fail(400, "Choose included or extra, and a monthly limit (0 for no limit).");
          if (!Number.isInteger(price) || price < 0 || price > 100000) return fail(400, "Enter a price in pounds, such as 24.00, up to £1,000.");
          current.addons[k] = { mode: a.mode ?? current.addons[k].mode, monthlyLimit: limit, price };
        }
        await store.set("site/settings", current);
        return json(current);
      }
      if (is("PATCH", "super", "users", ":id")) {
        const u = await store.get(`users/${parts[2]}`); if (!u) return fail(404, "That account couldn't be found.");
        const b = await readBody(req), out = {};
        if (isObj(b.subscription)) {
          const until = b.subscription.until, status = b.subscription.status;
          if (!DATE_RE.test(until || "") || !["trial", "paid"].includes(status)) return fail(400, "Choose a status and an end date.");
          u.subscription = { status, until };
        }
        for (const k of Object.keys(ADDONS)) {
          if (b[k] === null) delete u[k];
          else if (isObj(b[k])) {
            const until = b[k].until, limit = Number(b[k].monthlyLimit ?? 0);
            if (!DATE_RE.test(until || "") || !Number.isInteger(limit) || limit < 0 || limit > 10000) return fail(400, "Choose an end date and a monthly limit (0 for no limit).");
            u[k] = { until, monthlyLimit: limit };
          }
        }
        if (b.resetPassword) {
          out.temporaryPassword = `${randomId(4)}-${randomId(4)}-${randomId(4)}`;
          u.password = await hashPassword(out.temporaryPassword); u.sessionV = (u.sessionV || 0) + 1;
        }
        await store.set(`users/${u.id}`, u);
        return json({ user: publicUser(u), ...out });
      }
      if (is("GET", "super", "legacy")) {
        const old = legacy && await legacy();
        return json({ available: !!old, teams: old ? Object.keys(old.league.teams || {}).length : 0, venues: old ? Object.keys(old.league.venues || {}).length : 0 });
      }
      // Copies the data from the original single-league site into a season, turning its division names into divisions.
      if (is("POST", "super", "legacy")) {
        const old = legacy && await legacy(); if (!old) return fail(404, "There's no data from the original site.");
        const b = await readBody(req), league = await store.get(`leagues/${b.leagueId}`);
        if (!league || !league.seasons.some(s => s.id === b.seasonId)) return fail(400, "Choose a league and season to copy into.");
        const data = { ...emptySeason(), teams: clone(old.league.teams || {}), venues: clone(old.league.venues || {}), fixtures: clone(old.league.fixtures || {}) };
        const divByName = {};
        for (const t of Object.values(data.teams)) {
          if (!t.division) continue;
          const name = String(t.division);
          if (!divByName[name]) { const id = randomId(8); divByName[name] = id; data.divisions[id] = { id, name, order: Object.keys(divByName).length }; }
          t.division = divByName[name];
        }
        const current = await store.get(seasonKey(league.id, b.seasonId)) || emptySeason();
        data.version = current.version + 1;
        await store.set(seasonKey(league.id, b.seasonId), data);
        await store.set(contactsKey(league.id, b.seasonId), clone(old.contacts || {}));
        const s = old.league.settings || {};
        for (const k of ["win", "draw", "loss"]) if (Number.isInteger(s[k])) league.settings[k] = s[k];
        await store.set(`leagues/${league.id}`, league);
        return json({ copied: { teams: Object.keys(data.teams).length, venues: Object.keys(data.venues).length, fixtures: Object.keys(data.fixtures).length } });
      }
    }
    return fail(404, "Not found.");
  }

  return async function handle(req) {
    try { return await route(req); }
    catch (e) { if (Array.isArray(e)) return fail(e[0], e[1]); throw e; }
  };
}
