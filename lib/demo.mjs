// The demo league shown to people thinking of signing up, at /demo. It's made up, built from this code each time
// the API starts (the same every time), and served by the real API to the real page, so everything the site does
// shows in it. When a feature is added, give the demo something to show for it here.
//
// Two finished seasons of a 30-team, 3-division league: last season's results only (as if imported), with promotion
// and relegation into this season, which has every scorecard, four team knockout cups (one drawn by hand), and the
// Captains Cup, Pairs Cup and Sticker Up Cup finals. Plus team logos, a committee, news and a roll of honour.

export const DEMO_SLUG = "demo", DEMO_ID = "demoleague";

const VENUES = [
  ["The Wheatsheaf", "Westcombe"], ["The Black Horse", "Ashbury"], ["The Old Bell", "Little Haddon"], ["The Ship Inn", "Stowey Cross"],
  ["The Royal Oak", "Kingsmead"], ["The Plough & Harrow", "Ashbury"], ["The New Inn", "Coldharbour"], ["The Three Horseshoes", "Westcombe"],
  ["The Cider Press", "Orchard End"], ["The Rising Sun", "Brockley Green"], ["The Swan", "Millbrook"], ["The Railway Tavern", "Westcombe"],
  ["The Fox & Hounds", "Hatherleigh Down"], ["The White Hart", "Kingsmead"], ["Westcombe Social Club", "Westcombe"],
];
// Two teams to a venue, on its two alleys.
const TEAMS = [
  "Wheatsheaf Wanderers", "Sheaf Shooters", "Black Horse Bandits", "Dark Horses", "Bell Ringers", "Ding Dongs",
  "Ship Shape", "Shipwrecks", "Oak Leaves", "Acorns", "Plough Boys", "Harrow Hitters", "New Inn Nomads", "Innbetweeners",
  "Horseshoe Hammers", "Lucky Shoes", "Press Gang", "Scrumpy Jacks", "Sun Seekers", "Early Risers", "Swan Song", "Cygnets",
  "Railway Rattlers", "Last Orders", "Fox Trotters", "Hounds", "Hart Breakers", "Stags", "Social Climbers", "Club Swingers",
];
const FIRST = ["Dave", "Sue", "Tom", "Jan", "Pete", "Liz", "Mark", "Kate", "Steve", "Ann", "Rob", "Jo", "Mike", "Sally", "Gary", "Tina", "Phil", "Karen",
  "Andy", "Wendy", "Nigel", "Julie", "Colin", "Debbie", "Keith", "Lynn", "Barry", "Carol", "Ian", "Mandy", "Les", "Pam", "Rich", "Bev", "Terry", "Gill"];
const LAST = ["Ashby", "Brook", "Carter", "Dunn", "Ellis", "Fry", "Gould", "Hale", "Isaac", "Jarvis", "Keen", "Lock", "Marsh", "Nash", "Osborne", "Parfitt",
  "Quick", "Rowe", "Sealy", "Tucker", "Upham", "Vowles", "Webber", "Yeo", "Baker", "Coles", "Dyer", "Farr", "Greed", "Hobbs", "Lang", "Moxey", "Pike", "Snook"];
const NICKS = ["Tank", "Lucky", "Smudge", "Chalky", "Sticks", "Bomber", "Spud", "Dusty", "Flash", "Nobby", "Tiny", "Spanner"];
const COLOURS = [["#1E3A5F", "#C9A227"], ["#6B1E2E", "#E8C766"], ["#1D4533", "#B7842A"], ["#3B2A6B", "#D9C27A"], ["#7A3B0E", "#F2D17C"], ["#0F4C5C", "#9FD3C7"],
  ["#2F2F2F", "#D64545"], ["#5A1A4A", "#F0B3D9"], ["#244B1F", "#C6E377"], ["#8A1C1C", "#F4F1E8"]];

const searchText = s => String(s || "").toLowerCase().replace(/[“”"'’.,]/g, "").replace(/\s+/g, " ");
const fullName = p => [p.first, p.last].filter(Boolean).join(" ");
const playerLabel = p => [p.first, p.last, p.nick && `“${p.nick}”`].filter(Boolean).join(" ");
const addDays = (date, n) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const b64 = s => typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");

function logoSvg(name, i) {
  const [bg, fg] = COLOURS[i % COLOURS.length], words = name.replace(/&/g, "").split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  const shape = [
    `<path d="M32 3 58 11v20c0 15-11 25-26 30C17 56 6 46 6 31V11Z" fill="${bg}" stroke="${fg}" stroke-width="3"/>`,
    `<circle cx="32" cy="32" r="28" fill="${bg}" stroke="${fg}" stroke-width="3"/>`,
    `<rect x="5" y="5" width="54" height="54" rx="14" fill="${bg}" stroke="${fg}" stroke-width="3"/>`,
  ][i % 3];
  // A small skittle pin above the letters.
  const pin = `<path d="M32 9c2 0 3 2 2.6 4-.3 1.2-1 2-1 3 0 1.6 2.4 3 2.4 6 0 2-1.5 3-4 3s-4-1-4-3c0-3 2.4-4.4 2.4-6 0-1-.7-1.8-1-3-.4-2 .6-4 2.6-4Z" fill="${fg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${shape}${pin}<text x="32" y="48" font-family="Georgia, serif" font-size="17" font-weight="700" text-anchor="middle" fill="${fg}">${initials}</text></svg>`;
}

// cupMatches comes from core: the knockout rounds worked out the same way the page does.
export function buildDemo(cupMatches) {
  let seed = 20250911;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Venues, teams and players: the same in both seasons.
  const venues = {}, teams = {}, skill = {};
  VENUES.forEach(([name, town], i) => {
    const id = `v${i + 1}`;
    venues[id] = { id, name, address1: `${10 + i * 3} High Street`, address2: town, address3: "Somerset", postcode: "", phone: "", alleys: 2 };
  });
  const usedNames = new Set();
  TEAMS.forEach((name, i) => {
    const id = `t${i + 1}`, players = [];
    while (players.length < 8) {
      const first = pick(FIRST), last = pick(LAST), key = `${first} ${last}`;
      if (usedNames.has(key)) continue;
      usedNames.add(key);
      players.push({ first, last, nick: rnd() < 0.18 ? pick(NICKS) : "" });
    }
    players[0].captain = true; players[1].vice = true; players[2].sticker = true; players[3].pairs = true; players[4].pairs = true;
    teams[id] = { id, name, venue: `v${Math.floor(i / 2) + 1}`, alley: i % 2 + 1, players };
    skill[id] = (rnd() - 0.5) * 1.6;
    players.forEach(p => skill[`${id}|${searchText(fullName(p))}`] = (rnd() - 0.5) * 1.4);
  });
  const logos = {}, logoIds = {};
  TEAMS.forEach((name, i) => { const id = `logo${i + 1}`; logos[id] = { mediaType: "image/svg+xml", data: b64(logoSvg(name, i)) }; logoIds[name.toLowerCase()] = id; });

  // A player's six hands: most between 3 and 9, about one in nine a spare (all nine down), which scores more.
  const row = (tid, p) => {
    const key = searchText(fullName(p)), lift = skill[tid] + skill[`${tid}|${key}`], hands = [], spares = [];
    for (let h = 0; h < 6; h++) {
      const sp = rnd() < 0.09 + lift * 0.03; spares.push(sp);
      hands.push(sp ? 9 + Math.floor(rnd() * 7) : Math.max(1, Math.min(9, Math.round(5.6 + lift + (rnd() - 0.5) * 5))));
    }
    return { key, name: fullName(p), nick: p.nick || "", hands, spares, total: hands.reduce((a, b) => a + b, 0) };
  };
  // Six of the team's eight players; two sit out, a different two most weeks.
  const teamCard = (tid, week) => { const ps = teams[tid].players, out = new Set([(week * 3) % 8, (week * 3 + 5) % 8]);
    return { mode: "hands", rows: ps.filter((_, i) => !out.has(i)).map(p => row(tid, p)) }; };
  const total = card => card.rows.reduce((n, r) => n + r.total, 0);

  // Each division plays everyone twice: the circle method, the second half with home and away swapped.
  const roundRobin = ids => {
    const list = [...ids], n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) { const a = list[i], b = list[n - 1 - i]; pairs.push(r % 2 ? [b, a] : [a, b]); }
      rounds.push(pairs); list.splice(1, 0, list.pop());
    }
    return [...rounds, ...rounds.map(r => r.map(([a, b]) => [b, a]))];
  };
  const table = (ids, fixtures) => {
    const t = Object.fromEntries(ids.map(id => [id, { id, pts: 0, pd: 0 }]));
    for (const f of fixtures) { if (!t[f.home] || !t[f.away]) continue;
      const d = f.homePins - f.awayPins; t[f.home].pd += d; t[f.away].pd -= d;
      if (d > 0) t[f.home].pts += 2; else if (d < 0) t[f.away].pts += 2; else { t[f.home].pts++; t[f.away].pts++; } }
    return Object.values(t).sort((a, b) => b.pts - a.pts || b.pd - a.pd).map(x => x.id);
  };

  function season({ sid, name, start, divisionsOf, cards }) {
    const d = { version: 1, teams: {}, venues: structuredClone(venues), fixtures: {}, divisions: {}, cups: {}, transfers: {}, committee: {} };
    for (const n of [1, 2, 3]) d.divisions[`d${n}`] = { id: `d${n}`, name: `Division ${n}`, order: n };
    for (const [id, t] of Object.entries(teams)) d.teams[id] = { ...structuredClone(t), division: divisionsOf[id] };
    // League nights on Thursdays; every third week is a cup week, and Christmas and New Year are off.
    const nights = [], cupWeeks = [];
    for (let w = 0; nights.length < 18; w++) { const day = addDays(start, w * 7); if (/-12-2[4-9]|-12-3|-01-0[1-3]/.test(day.slice(4))) continue; (w % 3 === 2 ? cupWeeks : nights).push(day); }
    while (cupWeeks.length < 10) cupWeeks.push(addDays(cupWeeks.at(-1), 21));
    let k = 0;
    for (const div of ["d1", "d2", "d3"]) {
      const ids = Object.keys(d.teams).filter(id => d.teams[id].division === div);
      roundRobin(shuffle(ids)).forEach((pairs, r) => { for (const [home, away] of pairs) {
        const id = `${sid}f${++k}`, f = { id, comp: "league", round: null, date: nights[r], time: "19:45", home, away, venue: null, alley: null };
        if (cards) { f.cards = { home: teamCard(home, r), away: teamCard(away, r + 1) }; f.homePins = total(f.cards.home); f.awayPins = total(f.cards.away); }
        else { const s = id => Math.round(232 + skill[id] * 18 + (rnd() - 0.5) * 50); f.homePins = s(home); f.awayPins = s(away); }
        d.fixtures[id] = f;
      } });
    }

    // The finals all on one night at the social club.
    const finalsNight = addDays(nights[17], 21), finalsAt = { mode: "set", venue: "v15", alley: 1 }, all = Object.keys(d.teams);
    // Cup rounds in the cup weeks (on the Tuesday for some cups), a round every other cup week or so.
    const cupNight = (r, offset) => addDays(cupWeeks[Math.min(cupWeeks.length - 1, (r - 1) * 2 + (offset % 2))], offset >= 4 ? -2 : 0);
    const playCup = (cup, offset) => {
      cup.roundDates = {};
      for (let guard = 0; guard < 12; guard++) {
        const ms = cupMatches(cup, d.teams, d.venues), R = Math.max(...ms.map(m => m.r));
        for (let r = 1; r <= R; r++) cup.roundDates[r] = { date: r === R ? finalsNight : cupNight(r, offset), time: "19:45" };
        const open = ms.filter(m => m.a && m.b && !m.winner);
        if (open.length) { const r = open[0].r;
          for (const m of open.filter(x => x.r === r)) {
            const res = { a: m.a, b: m.b };
            if (cards) { res.cards = { a: teamCard(m.a, r + 4), b: teamCard(m.b, r + 6) }; res.aPins = total(res.cards.a); res.bPins = total(res.cards.b); }
            else { res.aPins = Math.round(235 + skill[m.a] * 18 + (rnd() - 0.5) * 50); res.bPins = Math.round(235 + skill[m.b] * 18 + (rnd() - 0.5) * 50); }
            if (res.aPins === res.bPins) res.winner = m.a; // decided on the last hand
            cup.results[m.id] = res;
          }
          continue;
        }
        // Drawn by hand: the next round's matches from the winners of the round before.
        if (cup.drawMode === "manual") {
          const waiting = ms.find(m => !m.empty && !m.a && !m.b);
          if (waiting) { const prev = ms.filter(m => m.r === waiting.r - 1 && !m.empty).map(m => m.winner), w = shuffle(prev), slots = ms.filter(m => m.r === waiting.r).length;
            const pairs = []; for (let i = 0; i < w.length; i += 2) pairs.push([w[i], w[i + 1] || null]);
            while (pairs.length < slots) pairs.push([null, null]);
            (cup.pairings ||= {})[waiting.r] = pairs; continue; }
        }
        break;
      }
    };
    const knockout = (id, name, entrants, offset, extra = {}) => {
      const cup = { id, name, type: "knockout", game: "rough", format: "team", structure: "full", entries: entrants.length, entrants: entrants.map(t => ({ id: t, label: d.teams[t].name })),
        draw: shuffle(entrants), byeIds: [], results: {}, schedule: {}, final: { scores: {} }, created: `${start}T12:00:00.000Z`, semiVenue: "home", finalAt: finalsAt, drawMode: "auto", ...extra };
      playCup(cup, offset); d.cups[id] = cup;
    };
    knockout(`${sid}c1`, "Knockout Cup", all, 0);
    knockout(`${sid}c2`, "Charity Cup", shuffle(all).slice(0, 16), 2);
    knockout(`${sid}c3`, "Presidents Cup", all.filter(id => d.teams[id].division !== "d1"), 4, { semiVenue: "neutral" });
    knockout(`${sid}c4`, "Hospital Cup", shuffle(all).slice(0, 12), 5, { drawMode: "manual", semiVenue: "neutral" });
    // Neutral semi-finals are played at the social club too.
    for (const c of [d.cups[`${sid}c3`], d.cups[`${sid}c4`]]) for (const m of cupMatches(c, d.teams, d.venues)) if (m.roundName === "Semi-finals" && m.a && m.b) c.schedule[m.id] = { venue: "v15", alley: m.id.endsWith("0") ? 1 : 2 };

    // Straight finals: eight entries each, highest pins wins.
    const fin = { date: finalsNight, time: "19:00", venue: "v15", alley: 2 };
    const straight = (id, name, extra, entries) => {
      const cup = { id, name, type: "knockout", game: "rough", structure: "final", entries: entries.length, entrants: entries.map(e => ({ id: e.id, label: e.label })),
        draw: [], results: {}, schedule: {}, created: `${start}T12:00:00.000Z`, final: { ...fin, scores: {}, cards: {} }, ...extra };
      for (const e of entries) { if (cards) { cup.final.cards[e.id] = e.card(); cup.final.scores[e.id] = total(cup.final.cards[e.id]); } else cup.final.scores[e.id] = e.pins(); }
      const top = Math.max(...Object.values(cup.final.scores)), tied = Object.keys(cup.final.scores).filter(k => cup.final.scores[k] === top);
      if (tied.length > 1) cup.final.winner = tied[0];
      d.cups[id] = cup;
    };
    const person = role => shuffle(all).slice(0, 8).map(tid => { const p = d.teams[tid].players.find(x => x[role]);
      return { id: `p:${tid}:${searchText(fullName(p))}`, label: `${playerLabel(p)} (${d.teams[tid].name})`, card: () => ({ mode: "hands", rows: [row(tid, p)] }), pins: () => Math.round(38 + skill[tid] * 6 + (rnd() - 0.5) * 14) }; });
    straight(`${sid}c5`, "Captains Cup", { format: "individual", captains: true }, person("captain"));
    straight(`${sid}c6`, "Pairs Cup", { format: "team", pairs: true }, shuffle(all).slice(0, 8).map(tid => ({ id: tid, label: d.teams[tid].name,
      card: () => ({ mode: "hands", rows: d.teams[tid].players.filter(p => p.pairs).map(p => row(tid, p)) }), pins: () => Math.round(78 + skill[tid] * 10 + (rnd() - 0.5) * 22) })));
    straight(`${sid}c7`, "Sticker Up Cup", { format: "individual" }, person("sticker"));

    // The committee.
    const who = (role, tid, n, id = role) => { const p = d.teams[tid].players[n]; d.committee[id] = { id, role, team: tid, key: searchText(fullName(p)), first: p.first, last: p.last, nick: p.nick }; };
    who("president", "t29", 5); who("chairman", "t3", 6); who("treasurer", "t12", 7); who("secretary", "t21", 5); who("member", "t8", 6, "m1"); who("member", "t17", 7, "m2");
    const leagueFixtures = Object.values(d.fixtures);
    const order = Object.fromEntries(["d1", "d2", "d3"].map(div => [div, table(Object.keys(d.teams).filter(id => d.teams[id].division === div), leagueFixtures)]));
    return { id: sid, name, start, end: addDays(finalsNight, 7), data: d, order };
  }

  // Last season: teams in divisions of ten in the order they're listed. This season: two up and two down.
  const first = Object.fromEntries(Object.keys(teams).map((id, i) => [id, `d${Math.floor(i / 10) + 1}`]));
  const last = season({ sid: "s2425", name: "2024–25", start: "2024-09-12", divisionsOf: first, cards: false });
  const now = { ...first };
  for (const [up, down] of [["d2", "d1"], ["d3", "d2"]]) { last.order[up].slice(0, 2).forEach(id => now[id] = down); last.order[down].slice(-2).forEach(id => now[id] = up); }
  const cur = season({ sid: "s2526", name: "2025–26", start: "2025-09-11", divisionsOf: now, cards: true });

  const champ = div => teams[cur.order[div][0]].name;
  const cupWinner = (c, data) => { const ms = cupMatches(c, data.teams, data.venues), f = ms.at(-1); return data.teams[f.winner]?.name; };
  const knock = cupWinner(cur.data.cups.s2526c1, cur.data);
  const news = [
    { id: "n4", title: "Season review: what a finish", pinned: true, photos: [], created: `${cur.end}T20:00:00.000Z`, by: "League Secretary",
      body: `That's a wrap on the ${cur.name} season, and what a season it was.\n\nCongratulations to ${champ("d1")}, champions of Division 1, to ${champ("d2")} who won Division 2, and to ${champ("d3")}, top of Division 3.\n\n${knock} lifted the Knockout Cup on finals night at Westcombe Social Club. Every result, scorecard and cup draw is still here to look back on, and the stats show who threw the most spares.\n\nThank you to every captain, sticker up and alley for another great season. See you all in September.` },
    { id: "n3", title: "Finals night", photos: [], created: `${addDays(cur.end, -7)}T22:30:00.000Z`, by: "League Secretary",
      body: "A packed house at Westcombe Social Club for finals night: four team cup finals, plus the Captains Cup, Pairs Cup and Sticker Up Cup finals. All the scorecards are on the Cups page." },
    { id: "n2", title: "Christmas break", photos: [], created: "2025-12-19T18:00:00.000Z", by: "League Secretary",
      body: "No league games over Christmas and New Year. Fixtures start again in January. Merry Christmas from the committee." },
    { id: "n1", title: `Welcome to the ${cur.name} season`, photos: [], created: "2025-09-01T18:00:00.000Z", by: "League Secretary",
      body: `Thirty teams in three divisions this season. Promoted from Division 2: ${last.order.d2.slice(0, 2).map(id => teams[id].name).join(" and ")}. Up from Division 3: ${last.order.d3.slice(0, 2).map(id => teams[id].name).join(" and ")}.\n\nFixtures, venues and the cup draws are all on the site. Good luck everyone.` },
  ];

  // A roll of honour going back before the site's two seasons, as a league would bring in from its records.
  const honours = [], hn = { n: 0 };
  const capt = tid => teams[tid].players.find(p => p.captain);
  for (let y = 2008; y <= 2023; y++) {
    const season = `${y}–${String(y + 1).slice(2)}`;
    if (y === 2020) { honours.push({ id: `h${++hn.n}`, cup: "Captains Cup", season, winner: null, runner: null, joint: null, note: "No competition (Covid)" });
      honours.push({ id: `h${++hn.n}`, cup: "Knockout Cup", season, winner: null, runner: null, joint: null, note: "No competition (Covid)" }); continue; }
    const [a, b, c] = shuffle(Object.keys(teams));
    honours.push({ id: `h${++hn.n}`, cup: "Captains Cup", season, winner: { team: teams[a].name, player: fullName(capt(a)), pins: y >= 2016 ? 46 + Math.floor(rnd() * 12) : null },
      runner: { team: teams[b].name, player: fullName(capt(b)), pins: y >= 2016 ? 40 + Math.floor(rnd() * 6) : null }, joint: y === 2017 ? { team: teams[c].name, player: fullName(capt(c)), pins: null } : null, note: "" });
    const [k1, k2] = shuffle(Object.keys(teams));
    honours.push({ id: `h${++hn.n}`, cup: "Knockout Cup", season, winner: { team: teams[k1].name, player: "", pins: null }, runner: { team: teams[k2].name, player: "", pins: null }, joint: null, note: "" });
  }
  // One old team that's no longer in the league, as old records have.
  honours.push({ id: `h${++hn.n}`, cup: "Knockout Cup", season: "2007–08", winner: { team: "Old Market Rollers", player: "", pins: null }, runner: { team: teams.t5.name, player: "", pins: null }, joint: null, note: "" });

  const league = {
    id: DEMO_ID, slug: DEMO_SLUG, name: "Westcombe & District Skittles League", ownerId: "demo", demo: true,
    settings: { win: 2, draw: 1, loss: 0, handWin: 0, handDraw: 0, players: 6, balls: 3, hands: 6, game: "rough", tiebreak: ["pd", "apd"], startTime: "19:45", theme: "baize", font: "classic" },
    seasons: [last, cur].map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end })), currentSeasonId: cur.id, logos: logoIds, teamNames: [], honoursCount: honours.length,
  };
  return { league, seasons: { [last.id]: last.data, [cur.id]: cur.data }, news: { items: news }, logos, honours: { items: honours } };
}
