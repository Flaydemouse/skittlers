// Checks the API in lib/core.mjs: accounts, leagues, seasons, permissions, subscriptions and the overall admin.
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { createApi, createBoardRunner, parseBoard, boardMatch, boardPrompt, newsSharePage, sheetMatch, sheetPrompt, parseSheet } from "../lib/core.mjs";
const data = new Map();
const store = { get: async k => data.has(k) ? JSON.parse(data.get(k)) : null, set: async (k, v) => data.set(k, JSON.stringify(v)), del: async k => data.delete(k), list: async p => [...data.keys()].filter(k => k.startsWith(p)) };
let day = "2026-10-29", clock = Date.parse("2026-10-29T19:00:00Z");
const legacyData = { league: { teams: { a: { id: "a", name: "Red Devils", division: "Division 1" }, b: { id: "b", name: "Rollers", division: "Division 2" }, c: { id: "c", name: "Poachers" } }, venues: { v: { id: "v", name: "The Bell" } }, fixtures: {}, settings: { win: 3, draw: 1, loss: 0 } }, contacts: { a: { mobile: "07700" } } };
const mails = [];
const api = createApi({ store, webcrypto, env: { SESSION_SECRET: "s", SUPERADMIN_EMAIL: "Owner@Test.com" }, legacy: async () => legacyData, today: () => day, pause: async () => {}, now: () => clock, sendEmail: async m => { mails.push(m); } });
const call = async (method, path, body, token) => { const r = await api(new Request("http://x/api/" + path, { method, headers: token ? { authorization: "Bearer " + token } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };
let r;
r = await call("POST", "auth/signup", { name: "Sec", email: "sec@x.com", password: "short" }); assert.equal(r.status, 400);
r = await call("POST", "auth/signup", { name: "Sec", email: "Sec@X.com", password: "longenough" }); assert.equal(r.status, 200); const sec = r.body.token;
assert.equal(r.body.user.subscription.until, "2026-11-28"); assert.equal(r.body.user.isSuper, false);
r = await call("POST", "auth/signup", { name: "Dup", email: "sec@x.com", password: "longenough" }); assert.equal(r.status, 409);
r = await call("POST", "auth/login", { email: "sec@x.com", password: "wrongpass" }); assert.equal(r.status, 401);
r = await call("POST", "auth/login", { email: "SEC@x.com ", password: "longenough" }); assert.equal(r.status, 200);
r = await call("GET", "auth/me", null, "garbage"); assert.equal(r.status, 401);
r = await call("GET", "slug-check?slug=api"); assert.equal(r.body.available, false);
r = await call("POST", "leagues", { name: "Yeovil Skittles", slug: "yeovil" }, sec); assert.equal(r.status, 200); const L = r.body.league;
r = await call("POST", "leagues", { name: "Other", slug: "yeovil" }, sec); assert.equal(r.status, 400);
r = await call("GET", "public/yeovil"); assert.equal(r.body.league.name, "Yeovil Skittles"); assert.equal(r.body.league.ownerId, undefined);
r = await call("POST", `leagues/${L.id}/seasons`, { name: "2026–27", start: "2026-09-01", end: "2026-05-01" }, sec); assert.equal(r.status, 400);
r = await call("POST", `leagues/${L.id}/seasons`, { name: "2026–27", start: "2026-09-01", end: "2027-05-01" }, sec); const S1 = r.body.season; assert.equal(r.body.league.currentSeasonId, S1.id);
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, sec); assert.equal(r.body.version, 0);
const season = { teams: { t1: { id: "t1", name: "Red Devils", venue: "v1", alley: 2, players: [{ first: "Sue", last: "Ashby" }], division: "d1" } }, venues: { v1: { id: "v1", name: "The Bell", alleys: 2 } }, fixtures: { f1: { id: "f1" } }, divisions: { d1: { id: "d1", name: "Premier", order: 1 } } };
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 0, data: season, contacts: { t1: { mobile: "0770" } } }, sec); assert.equal(r.body.version, 1);
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 0, data: season, contacts: {} }, sec); assert.equal(r.status, 409); assert.equal(r.body.version, 1);
r = await call("GET", `public/yeovil/seasons/${S1.id}`); assert.equal(r.body.contacts, undefined); assert.equal(r.body.teams.t1.name, "Red Devils");
// results and notes only reach the public once published
{
  const fx = { old: { id: "old", homePins: 200, awayPins: 190 },
    fresh: { id: "fresh", homePins: 210, awayPins: 205, cards: { home: { rows: [] } }, note: "Checked by phone", notePublic: false, ready: true, pub: null },
    changed: { id: "changed", homePins: 230, awayPins: 220, note: "Corrected after the match", notePublic: true, ready: false, pub: { homePins: 229, awayPins: 220, note: "Result under review" } },
    noteOnly: { id: "noteOnly", homePins: null, awayPins: null, note: "Postponed: frozen alley", notePublic: true, pub: { homePins: null, awayPins: null, note: "Postponed: frozen alley" } } };
  r = await call("POST", `leagues/${L.id}/seasons`, { name: "Publishing test", start: "2030-09-01", end: "2031-05-01" }, sec); const SP = r.body.season;
  r = await call("PUT", `leagues/${L.id}/seasons/${SP.id}`, { version: 0, data: { ...season, fixtures: fx }, contacts: {} }, sec); assert.equal(r.status, 200);
  assert.equal(r.body.fixtures.fresh.note, "Checked by phone", "admins see everything");
  r = await call("GET", `public/yeovil/seasons/${SP.id}`); const pf = r.body.fixtures;
  assert.deepEqual(pf.old, { id: "old", homePins: 200, awayPins: 190 }, "fixtures from before publishing are unchanged");
  assert.deepEqual(pf.fresh, { id: "fresh" }, "unpublished result, scorecard, note and ticks are hidden");
  assert.deepEqual(pf.changed, { id: "changed", homePins: 229, awayPins: 220, note: "Result under review" }, "the last published version shows");
  assert.deepEqual(pf.noteOnly, { id: "noteOnly", note: "Postponed: frozen alley" });
  // cups: published match results, final and notes only
  const cups = { legacy: { id: "legacy", results: { "1-0": { aPins: 1, bPins: 0 } }, check: { "1-0": { note: "private" } } },
    drawn: { id: "drawn", results: { "1-0": { a: "x", b: "y", aPins: 300, bPins: 290 }, "1-1": { a: "p", b: "q", aPins: 250, bPins: 240 } },
      check: { "1-0": { note: "Rang the captain", notePublic: false, ready: true } },
      pub: { results: { "1-1": { a: "p", b: "q", aPins: 249, bPins: 240 } }, notes: { "1-1": "Score corrected" } } },
    final: { id: "final", structure: "final", final: { date: "2031-01-01", scores: { x: 200, y: 190 }, cards: {}, winner: null }, pub: { results: {}, final: { scores: {}, cards: {}, winner: null }, notes: {} } } };
  r = await call("PUT", `leagues/${L.id}/seasons/${SP.id}`, { version: 1, data: { ...season, fixtures: fx, cups }, contacts: {} }, sec); assert.equal(r.status, 200);
  r = await call("GET", `public/yeovil/seasons/${SP.id}`); const pc = r.body.cups;
  assert.deepEqual(pc.legacy, { id: "legacy", results: { "1-0": { aPins: 1, bPins: 0 } } }, "cups from before publishing are unchanged, notes hidden");
  assert.deepEqual(pc.drawn.results, { "1-1": { a: "p", b: "q", aPins: 249, bPins: 240 } }); assert.deepEqual(pc.drawn.publicNotes, { "1-1": "Score corrected" });
  assert.equal(pc.drawn.check, undefined); assert.equal(pc.drawn.pub, undefined);
  assert.deepEqual(pc.final.final, { date: "2031-01-01", scores: {}, cards: {}, winner: null }, "an unpublished final shows no scores, but keeps its date");
  // the calendar feed: dated games only, published results only, one team's games with ?team=
  const ical = async q => { const res = await api(new Request(`http://x/api/public/yeovil/calendar.ics?season=${SP.id}${q}`)); return { status: res.status, type: res.headers.get("content-type"), text: await res.text() }; };
  const teams2 = { ...season.teams, t2: { id: "t2", name: "Pin Pals; Bristol, Avon", venue: null, players: [] }, t3: { id: "t3", name: "Third", players: [] } };
  const venues2 = { v1: { id: "v1", name: "The Bell", alleys: 2, address1: "1 High St", postcode: "BA1 1AA" } };
  const calFx = { a: { id: "a", comp: "league", date: "2031-01-08", time: "20:45", home: "t1", away: "t2", homePins: 250, awayPins: 240, pub: { homePins: 249, awayPins: 240 } },
    b: { id: "b", comp: "league", date: "2031-07-02", time: "19:30", home: "t2", away: "t1", homePins: null, awayPins: null },
    c: { id: "c", comp: "league", date: "2031-01-15", time: "", home: "t3", away: "t2", homePins: null, awayPins: null },
    tba: { id: "tba", comp: "league", date: null, home: "t1", away: "t3" } };
  r = await call("PUT", `leagues/${L.id}/seasons/${SP.id}`, { version: 2, data: { teams: teams2, venues: venues2, divisions: season.divisions, fixtures: calFx,
    cups: { k: { id: "k", name: "Charity Shield", format: "team", structure: "final", entrants: [{ id: "t1" }, { id: "t3" }], final: { date: "2031-04-01", time: "20:00", venue: "v1" } } } }, contacts: {} }, sec); assert.equal(r.status, 200);
  let cal = await ical("");
  assert.equal(cal.status, 200); assert.match(cal.type, /^text\/calendar/);
  assert.match(cal.text, /^BEGIN:VCALENDAR\r\n/); assert.match(cal.text, /END:VCALENDAR\r\n$/);
  assert.equal((cal.text.match(/BEGIN:VEVENT/g) || []).length, 4, "three dated games and the cup final; the undated game is left out");
  assert.match(cal.text, /SUMMARY:Red Devils 249–240 Pin Pals\\; Bristol\\, Avon/, "the published score, with commas and semicolons escaped");
  assert.match(cal.text, /DTSTART;TZID=Europe\/London:20310108T204500\r\nDTEND;TZID=Europe\/London:20310108T234500/);
  assert.match(cal.text, /DTSTART;VALUE=DATE:20310115\r\nDTEND;VALUE=DATE:20310116/, "a game with no time is all day");
  assert.match(cal.text, /LOCATION:The Bell \(alley 2\)\\, 1 High St\\, BA1 1AA/);
  assert.match(cal.text, /DESCRIPTION:Yeovil Skittles: Premier/);
  assert.ok(cal.text.split("\r\n").every(l => new TextEncoder().encode(l).length <= 75), "long lines are folded");
  cal = await ical("&team=t3");
  assert.equal((cal.text.match(/BEGIN:VEVENT/g) || []).length, 2, "the team's game and the final it's in");
  assert.match(cal.text, /X-WR-CALNAME:Yeovil Skittles: Third/);
  assert.equal((await ical("&team=nobody")).status, 404);
  // a knockout cup: matches follow the draw, winners go through, and later rounds show once their date is set
  r = await call("GET", `leagues/${L.id}/seasons/${SP.id}`, null, sec);
  const ko = { id: "ko", name: "KO Cup", format: "team", structure: "full", entries: 3, draw: ["t1", "t2", "t3"], entrants: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    roundDates: { 1: { date: "2031-02-05", time: "20:45" }, 2: { date: "2031-03-05", time: "20:45" } }, results: {}, schedule: {} };
  r = await call("PUT", `leagues/${L.id}/seasons/${SP.id}`, { version: r.body.version, data: { ...r.body, cups: { ...r.body.cups, ko } }, contacts: {} }, sec); assert.equal(r.status, 200);
  cal = await ical("&team=t3");
  assert.match(cal.text, /SUMMARY:KO Cup semi-finals: Pin Pals\\; Bristol\\, Avon v Third/, "a first-round match with its teams");
  assert.match(cal.text, /SUMMARY:KO Cup final: Red Devils v To be decided/, "the final, waiting on the other semi");
  cal = await ical("&team=t2"); assert.match(cal.text, /KO Cup final: Red Devils v To be decided/, "a team still in with a chance sees the final");
  r = await call("GET", `leagues/${L.id}/seasons/${SP.id}`, null, sec);
  r = await call("PUT", `leagues/${L.id}/seasons/${SP.id}`, { version: r.body.version, data: { ...r.body, cups: { ...r.body.cups, ko: { ...ko, results: { "1-1": { a: "t2", b: "t3", aPins: 200, bPins: 210 } }, pub: { results: { "1-1": { a: "t2", b: "t3", aPins: 200, bPins: 210 } }, final: {}, notes: {} } } } }, contacts: {} }, sec);
  cal = await ical("&team=t3"); assert.match(cal.text, /KO Cup final: Red Devils v Third/, "once the result is published, the winner goes through");
  cal = await ical("&team=t2"); assert.doesNotMatch(cal.text, /KO Cup final/, "the losers' calendar drops the final");
  // a division: its league games and its teams' cup games
  cal = await ical("&division=d1"); assert.match(cal.text, /X-WR-CALNAME:Yeovil Skittles: Premier/);
  assert.doesNotMatch(cal.text, /SUMMARY:Third v Pin Pals/, "league games of teams outside the division are left out");
  assert.match(cal.text, /SUMMARY:Red Devils 249–240/);
  assert.equal((await ical("&division=nope")).status, 404);
  // captains send in results with the league's code; the secretary approves them
  const send = b => call("POST", `public/yeovil/seasons/${SP.id}/submissions`, b);
  const card = (key, total) => ({ mode: "totals", rows: [{ key, name: key, total, spareScores: [12] }] });
  const good = { code: "pins-2031", fixtureId: "c", team: "t3", name: "Cap Tain", note: "Good game", contact: "cap@x.com", cards: { home: card("amy", 41), away: card("bob", 39) } };
  r = await send(good); assert.equal(r.status, 403, "no code set: not taking results");
  r = await call("GET", "public/yeovil"); assert.equal(r.body.league.takesResults, false); assert.equal(r.body.league.captainCode, undefined);
  r = await call("PATCH", `leagues/${L.id}`, { captainCode: "no" }, sec); assert.equal(r.status, 400);
  r = await call("PATCH", `leagues/${L.id}`, { captainCode: "Pins-2031" }, sec); assert.equal(r.body.league.takesResults, true); assert.equal(r.body.league.captainCode, undefined, "the code stays private");
  r = await send({ ...good, code: "wrong" }); assert.equal(r.status, 403);
  r = await send({ ...good, fixtureId: "b", team: "t2" }); assert.equal(r.status, 400, "the game is in the future"); assert.match(r.body.error, /hasn't been played/);
  r = await call("GET", `leagues/${L.id}/seasons/${SP.id}`, null, sec);
  r = await call("PATCH", `leagues/${L.id}/seasons/${SP.id}/data`, { base: r.body.version, changes: [{ in: "fixtures", id: "c", value: { ...calFx.c, date: "2026-10-28" } }, { in: "fixtures", id: "a", value: { ...calFx.a, date: "2026-10-21" } }] }, sec); assert.equal(r.status, 200);
  r = await send({ ...good, team: "t1" }); assert.equal(r.status, 400, "not one of the teams playing");
  r = await send({ ...good, fixtureId: "a", team: "t1" }); assert.equal(r.status, 409, "already published");
  r = await send({ ...good, cards: { home: card("amy", 41) } }); assert.equal(r.status, 400);
  r = await send({ ...good, cards: { home: { mode: "hands", rows: [{ key: "amy", name: "Amy", total: 9, hands: [4, 4], spares: [false, false] }] }, away: card("bob", 39) } }); assert.equal(r.status, 400, "hands that don't add up");
  r = await send({ ...good, name: "" }); assert.equal(r.status, 400);
  mails.length = 0;
  r = await send(good); assert.equal(r.status, 200); assert.equal(r.body.emailed, true);
  assert.equal(mails.length, 1); assert.equal(mails[0].to, "sec@x.com"); assert.equal(mails[0].replyTo, "cap@x.com");
  assert.match(mails[0].subject, /Third 41–39 Pin Pals/); assert.match(mails[0].text, /amy: 41 \(spares 12\)/); assert.match(mails[0].text, /Note: Good game/);
  r = await call("GET", `public/yeovil/seasons/${SP.id}`); assert.equal(r.body.fixtures.c.homePins, null, "nothing goes live until it's approved");
  r = await call("GET", `leagues/${L.id}/seasons/${SP.id}/submissions`, null, sec);
  assert.equal(r.body.code, "Pins-2031"); assert.equal(r.body.items.length, 1); const sub = r.body.items[0];
  assert.equal(sub.status, "pending"); assert.equal(sub.homePins, 41); assert.equal(sub.cards.home.rows[0].spareScores[0], 12);
  r = await call("GET", `leagues/${L.id}/seasons/${SP.id}/submissions`); assert.equal(r.status, 401, "only admins see them");
  r = await call("POST", `leagues/${L.id}/seasons/${SP.id}/submissions/${sub.id}`, { status: "maybe" }, sec); assert.equal(r.status, 400);
  r = await call("POST", `leagues/${L.id}/seasons/${SP.id}/submissions/${sub.id}`, { status: "approved" }, sec); assert.equal(r.body.items[0].status, "approved"); assert.equal(r.body.items[0].by, "Sec");
  for (let i = 0; i < 3; i++) await send(good);
  r = await send(good); assert.equal(r.status, 429, "at most three waiting for one game");
  r = await call("PATCH", `leagues/${L.id}`, { captainCode: "" }, sec); assert.equal(r.body.league.takesResults, false);
  r = await call("DELETE", `leagues/${L.id}/seasons/${SP.id}`, null, sec); assert.equal(r.body.league.currentSeasonId, S1.id);
}
// cups are saved with the season and start empty in a copied season
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 1, data: { ...season, cups: { c1: { id: "c1", name: "Cup" } } }, contacts: {} }, sec); assert.equal(r.body.cups.c1.name, "Cup");
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 2, data: { ...season, cups: "nope" }, contacts: {} }, sec); assert.equal(r.status, 400);
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 2, data: season, contacts: { t1: { mobile: "0770" } } }, sec); assert.equal(r.body.version, 3);
// another account can't see or touch this league
r = await call("POST", "auth/signup", { name: "Other", email: "o@x.com", password: "longenough" }); const other = r.body.token;
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, other); assert.equal(r.status, 404);
r = await call("GET", "my/leagues", null, other); assert.equal(r.body.leagues.length, 0);
// copy into a new season: teams + players but not venues/divisions
r = await call("POST", `leagues/${L.id}/seasons`, { name: "2027–28", start: "2027-09-01", end: "2028-05-01", copyFrom: S1.id, copy: { teams: true, players: true } }, sec);
const S2 = r.body.season; assert.equal(r.body.league.currentSeasonId, S1.id, "not current unless asked");
r = await call("GET", `leagues/${L.id}/seasons/${S2.id}`, null, sec);
assert.deepEqual(Object.keys(r.body.venues), []); assert.deepEqual(r.body.cups, {}); assert.equal(r.body.teams.t1.venue, null); assert.equal(r.body.teams.t1.division, undefined); assert.equal(r.body.teams.t1.players.length, 1); assert.equal(r.body.contacts.t1.mobile, "0770"); assert.deepEqual(r.body.fixtures, {});
r = await call("POST", `leagues/${L.id}/seasons`, { name: "2028–29", start: "2028-09-01", end: "2029-05-01", copyFrom: S1.id, copy: { venues: true, teams: true, divisions: true }, makeCurrent: true }, sec);
const S3 = r.body.season; assert.equal(r.body.league.currentSeasonId, S3.id);
r = await call("GET", `leagues/${L.id}/seasons/${S3.id}`, null, sec); assert.equal(r.body.teams.t1.venue, "v1"); assert.equal(r.body.teams.t1.division, "d1"); assert.equal(r.body.teams.t1.players.length, 0);
r = await call("DELETE", `leagues/${L.id}/seasons/${S3.id}`, null, sec); assert.equal(r.body.league.currentSeasonId, S2.id);
// password change logs out old token
r = await call("POST", "auth/password", { current: "longenough", next: "newpassword1" }, sec); const sec2 = r.body.token;
r = await call("GET", "auth/me", null, sec); assert.equal(r.status, 401); r = await call("GET", "auth/me", null, sec2); assert.equal(r.status, 200);
// subscription expiry: read OK, write blocked
day = "2026-12-01";
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, sec2); assert.equal(r.status, 200);
r = await call("PATCH", `leagues/${L.id}`, { name: "New name" }, sec2); assert.equal(r.status, 402); console.log("expired message:", r.body.error);
r = await call("POST", "leagues", { name: "Another", slug: "another" }, sec2); assert.equal(r.status, 402);
// overall admin
r = await call("POST", "auth/signup", { name: "Neil", email: "owner@test.com", password: "superpass1" }); const boss = r.body.token; assert.equal(r.body.user.isSuper, true);
// help & requests: a secretary writes, the overall admin sees it in the inbox and replies
{
  mails.length = 0;
  r = await call("POST", "auth/support", { text: "   " }, sec2); assert.equal(r.status, 400);
  r = await call("POST", "auth/support", { text: "How do I set up a cup?\r\n\n\n\nThanks" }, sec2); assert.equal(r.status, 200);
  assert.equal(r.body.messages.length, 1); assert.equal(r.body.messages[0].text, "How do I set up a cup?\n\nThanks", "line breaks kept, blank runs squeezed");
  assert.equal(mails.length, 1); assert.equal(mails[0].to, "Owner@Test.com"); assert.equal(mails[0].replyTo, "sec@x.com"); assert.match(mails[0].text, /Yeovil Skittles wrote/);
  r = await call("GET", "auth/support/unread", null, boss); assert.equal(r.body.inbox, 1);
  r = await call("GET", "auth/support/unread", null, sec2); assert.deepEqual(r.body, { mine: 0, inbox: 0 }, "a secretary has no inbox");
  r = await call("GET", "super/support", null, sec2); assert.equal(r.status, 404, "only the overall admin sees the inbox");
  r = await call("GET", "super/support", null, boss); const th = r.body.threads[0];
  assert.equal(th.name, "Sec"); assert.equal(th.unread, 1); assert.equal(th.last.text.slice(0, 6), "How do");
  r = await call("GET", `super/support/${th.userId}`, null, boss); assert.equal(r.body.thread.messages.length, 1);
  r = await call("GET", "auth/support/unread", null, boss); assert.equal(r.body.inbox, 0, "reading it clears the count");
  r = await call("POST", `super/support/${th.userId}`, { text: "Manage cups, then New cup." }, boss); assert.equal(r.body.thread.messages[1].from, "admin");
  assert.equal(mails.at(-1).to, "sec@x.com"); assert.match(mails.at(-1).text, /Manage cups/);
  r = await call("GET", "auth/support/unread", null, sec2); assert.equal(r.body.mine, 1);
  r = await call("GET", "auth/support", null, sec2); assert.equal(r.body.messages[1].by, "Neil");
  r = await call("GET", "auth/support/unread", null, sec2); assert.equal(r.body.mine, 0);
  r = await call("GET", "auth/support"); assert.equal(r.status, 401);
  for (let i = 0; i < 19; i++) await call("POST", "auth/support", { text: "again " + i }, sec2);
  r = await call("POST", "auth/support", { text: "one too many" }, sec2); assert.equal(r.status, 429);
}
r = await call("GET", "super/users", null, sec2); assert.equal(r.status, 404);
r = await call("GET", "my/leagues", null, boss); assert.equal(r.body.leagues.length, 1); assert.equal(r.body.leagues[0].owner.email, "sec@x.com");
r = await call("GET", "super/users", null, boss); const secUser = r.body.users.find(u => u.email === "sec@x.com"); assert.equal(secUser.leagues[0].slug, "yeovil"); assert.equal(secUser.canEdit, false);
r = await call("PATCH", `super/users/${secUser.id}`, { subscription: { status: "paid", until: "2027-12-01" } }, boss); assert.equal(r.body.user.canEdit, true);
r = await call("PATCH", `leagues/${L.id}`, { name: "New name", slug: "yeovil-league", settings: { win: 3 } }, sec2); assert.equal(r.status, 200);
assert.deepEqual(r.body.league.settings.tiebreak, ["pd", "apd"], "pin difference, then away pin difference, by default");
r = await call("PATCH", `leagues/${L.id}`, { settings: { tiebreak: ["h2h", "bogus", "h2h", "pd"] } }, sec2); assert.deepEqual(r.body.league.settings.tiebreak, ["h2h", "pd"]);
r = await call("PATCH", `leagues/${L.id}`, { settings: { tiebreak: [] } }, sec2); assert.deepEqual(r.body.league.settings.tiebreak, ["h2h", "pd"], "an empty choice keeps the last one");
assert.equal(r.body.league.settings.startTime, "19:45", "league games start at 19:45 by default");
r = await call("PATCH", `leagues/${L.id}`, { settings: { startTime: "20:45" } }, sec2); assert.equal(r.body.league.settings.startTime, "20:45");
r = await call("PATCH", `leagues/${L.id}`, { settings: { startTime: "25:00" } }, sec2); assert.equal(r.body.league.settings.startTime, "20:45", "a time that isn't real is ignored");
r = await call("GET", "public/yeovil"); assert.equal(r.status, 404); r = await call("GET", "public/yeovil-league"); assert.equal(r.body.league.settings.win, 3);
r = await call("PATCH", `super/users/${secUser.id}`, { resetPassword: true }, boss); const temp = r.body.temporaryPassword; assert.match(temp, /^\w{4}-\w{4}-\w{4}$/);
r = await call("GET", "auth/me", null, sec2); assert.equal(r.status, 401);
r = await call("POST", "auth/login", { email: "sec@x.com", password: temp }); assert.equal(r.status, 200); const sec3 = r.body.token;
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 3, data: season, contacts: {} }, boss); assert.equal(r.status, 200, "overall admin can edit any league");
// legacy import
r = await call("GET", "super/legacy", null, boss); assert.equal(r.body.teams, 3);
r = await call("POST", "super/legacy", { leagueId: L.id, seasonId: S2.id }, boss); assert.deepEqual(r.body.copied, { teams: 3, venues: 1, fixtures: 0 });
r = await call("GET", `leagues/${L.id}/seasons/${S2.id}`, null, boss);
const divs = Object.values(r.body.divisions).map(d => d.name).sort(); assert.deepEqual(divs, ["Division 1", "Division 2"]);
assert.equal(r.body.divisions[r.body.teams.a.division].name, "Division 1"); assert.equal(r.body.teams.c.division, undefined); assert.equal(r.body.contacts.a.mobile, "07700");
// automatic backups: a copy before changes, no more than one every 10 minutes; restore from a copy or a file
const hist = async () => (await call("GET", `leagues/${L.id}/seasons/${S1.id}/history`, null, boss)).body.copies;
const ver = async () => (await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, boss)).body.version;
const n0 = (await hist()).length; assert.ok(n0 >= 1, "earlier saves kept copies");
clock += 5 * 60e3; r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: { ...season, venues: {} }, contacts: {} }, boss);
clock += 11 * 60e3; await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: season, contacts: {} }, boss);
assert.equal((await hist()).length, n0 + 1, "a copy after 10 minutes");
clock += 60e3; await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: { ...season, venues: { v2: { id: "v2" } } }, contacts: {} }, boss);
assert.equal((await hist()).length, n0 + 1, "no new copy within 10 minutes");
clock += 60e3; r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: { ...season, fixtures: {} }, contacts: {} }, boss);
assert.equal((await hist()).length, n0 + 2, "removing something always keeps a copy first"); assert.equal((await hist())[0].fixtures, 1);
clock += 11 * 60e3; r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: { ...season, teams: {} }, contacts: {} }, boss);
let copies = await hist(); assert.equal(copies.length, n0 + 3); assert.equal(copies[0].teams, 1, "the copy is of the season before the change"); assert.equal(copies[0].by, "Neil");
r = await call("POST", `leagues/${L.id}/seasons/${S1.id}/history/${copies[0].id}`, null, boss); assert.equal(Object.keys(r.body.teams).length, 1, "restored");
copies = await hist(); assert.equal(copies.length, n0 + 4); assert.equal(copies[0].teams, 0, "the season before the restore was kept"); assert.match(copies[0].reason, /Before restoring/);
r = await call("POST", `leagues/${L.id}/seasons/${S1.id}/restore`, { skittlersBackup: 1, data: { ...season, teams: { z: { id: "z", name: "From file" } } }, contacts: { z: { mobile: "1" } } }, boss);
assert.equal(r.body.teams.z.name, "From file"); assert.equal(r.body.contacts.z.mobile, "1");
r = await call("POST", `leagues/${L.id}/seasons/${S1.id}/restore`, { data: season }, boss); assert.equal(r.status, 400, "not a backup file");
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}/history`, null, other); assert.equal(r.status, 404, "other accounts can't see backups");
// saving just the changed items, applied to the latest copy
let v0 = await ver();
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: v0, changes: [{ in: "fixtures", id: "f9", value: { id: "f9", homePins: 300 } }, { in: "contacts", id: "z", value: { mobile: "2" } }] }, boss);
assert.equal(r.body.version, v0 + 1); assert.equal(r.body.stale, false);
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: v0, changes: [{ in: "teams", id: "t2", value: { id: "t2", name: "Late" } }] }, boss);
assert.equal(r.body.stale, true, "someone else saved in between");
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, boss); assert.equal(r.body.fixtures.f9.homePins, 300); assert.equal(r.body.teams.t2.name, "Late"); assert.equal(r.body.contacts.z.mobile, "2"); assert.equal(r.body.teams.z.name, "From file", "other items kept");
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: 0, changes: [{ in: "teams", id: "t2", value: null }] }, boss); assert.equal(r.status, 200);
r = await call("GET", `leagues/${L.id}/seasons/${S1.id}`, null, boss); assert.equal(r.body.teams.t2, undefined);
// player transfers are saved with the season and shown publicly
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: 0, changes: [{ in: "transfers", id: "x1", value: { id: "x1", date: "2026-11-05", first: "Sue", last: "Ashby", key: "sue ashby", from: "t1", to: "z" } }] }, boss); assert.equal(r.status, 200);
r = await call("GET", `public/yeovil-league/seasons/${S1.id}`); assert.equal(r.body.transfers.x1.to, "z");
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: 0, changes: [{ in: "committee", id: "president", value: { id: "president", role: "president", team: "z", key: "sue ashby", first: "Sue", last: "Ashby" } }] }, boss); assert.equal(r.status, 200);
r = await call("GET", `public/yeovil-league/seasons/${S1.id}`); assert.equal(r.body.committee.president.first, "Sue", "the committee is public");
// a team's earlier names, kept with the league
r = await call("PATCH", `leagues/${L.id}`, { teamNames: [{ name: "The Rejects", was: ["The Friday Rejects", " The Reckleford  Rejects ", "the rejects", ""] }, { name: "No history", was: [] }] }, boss);
assert.deepEqual(r.body.league.teamNames, [{ name: "The Rejects", was: ["The Friday Rejects", "The Reckleford Rejects"] }], "blank and same-as-now names are dropped, and teams with none");
r = await call("GET", "public/yeovil-league"); assert.equal(r.body.league.teamNames[0].was.length, 2, "they're public");
r = await call("PATCH", `leagues/${L.id}`, { teamNames: [{ name: "A", was: ["Old"] }, { name: "B", was: ["old"] }] }, boss); assert.equal(r.status, 400, "a name belongs to one team");
r = await call("PATCH", `leagues/${L.id}`, { teamNames: "x" }, boss); assert.equal(r.status, 400);
// a league's own domain: an add-on, connected by hand by the overall admin
{
  r = await call("PATCH", `leagues/${L.id}`, { domain: "https://www.YeovilSkittles.co.uk/fixtures" }, boss);
  assert.equal(r.status, 200, "the overall admin can always set one"); assert.equal(r.body.league.domain, "yeovilskittles.co.uk"); assert.equal(r.body.league.domainConnected, false);
  r = await call("GET", "public-domain/yeovilskittles.co.uk"); assert.equal(r.body.slug, "yeovil-league");
  r = await call("GET", "public-domain/www.yeovilskittles.co.uk"); assert.equal(r.body.slug, "yeovil-league", "with or without www");
  r = await call("GET", "public-domain/nobody.co.uk"); assert.equal(r.status, 404);
  for (const bad of ["not a domain", "x.skittlers.co.uk", "mysite.netlify.app"]) { r = await call("PATCH", `leagues/${L.id}`, { domain: bad }, boss); assert.equal(r.status, 400, bad); }
  r = await call("GET", "super/domains", null, boss); assert.deepEqual(r.body.domains.map(d => [d.domain, d.connected]), [["yeovilskittles.co.uk", false]]);
  r = await call("PATCH", `super/domains/${L.id}`, { connected: true }, boss); assert.equal(r.body.connected, true);
  r = await call("GET", "public/yeovil-league"); assert.equal(r.body.league.domainConnected, true);
  r = await call("GET", "super/domains", null, sec2); assert.notEqual(r.status, 200, "only the overall admin");
  r = await call("PATCH", `leagues/${L.id}`, { domain: "skittles-yeovil.org.uk" }, boss); assert.equal(r.body.league.domainConnected, false, "a new address needs connecting again");
  r = await call("GET", "public-domain/yeovilskittles.co.uk"); assert.equal(r.status, 404, "the old address is freed");
  r = await call("PATCH", `leagues/${L.id}`, { domain: "" }, boss); assert.equal(r.body.league.domain, null);
  r = await call("GET", "super/settings", null, boss); assert.equal(r.body.addons.domain.mode, "extra", "an extra unless the overall admin includes it");
}
// the front page: prices by league size, extras, and the contact form
{
  r = await call("GET", "site"); assert.deepEqual(r.body.plans.map(p => p.maxTeams), [30, 60, 90]); assert.equal(r.body.addons.photos.name, "Photo reading");
  r = await call("PATCH", "super/settings", { plans: [{ maxTeams: 30, price: 60 }, { maxTeams: 20, price: 90 }] }, boss); assert.equal(r.status, 400, "each break has more teams than the last");
  r = await call("PATCH", "super/settings", { plans: [] }, boss); assert.equal(r.status, 400);
  r = await call("PATCH", "super/settings", { plans: [{ maxTeams: 30, price: 60 }, { maxTeams: 60, price: "90.50" }, { maxTeams: 90, price: 120 }] }, boss); assert.deepEqual(r.body.plans.map(p => p.price), [6000, 9050, 12000]);
  r = await call("GET", "site"); assert.equal(r.body.plans[1].price, 9050); assert.equal(r.body.addons.domain.price !== undefined, true);
  mails.length = 0;
  r = await call("POST", "contact", { name: "Bob", email: "bob@pub.co.uk", league: "Taunton Skittles", message: "How much for 40 teams?", website: "" }); assert.equal(r.status, 200);
  assert.equal(mails[0].to, "Owner@Test.com"); assert.equal(mails[0].replyTo, "bob@pub.co.uk");
  r = await call("POST", "contact", { name: "Spam", email: "x@y.zz", message: "buy now", website: "http://spam" }); assert.equal(r.status, 200); assert.equal(mails.length, 1, "the hidden box catches robots");
  r = await call("POST", "contact", { name: "Bob", email: "not an email", message: "hello there" }); assert.equal(r.status, 400);
  r = await call("GET", "super/support", null, boss); const g = r.body.threads.find(t => t.guest);
  assert.equal(g.name, "Bob"); assert.deepEqual(g.leagues, ["Taunton Skittles"]);
  r = await call("POST", `super/support/${g.userId}`, { text: "£90.50 a year." }, boss); assert.equal(r.body.emailed, true);
  assert.equal(mails.at(-1).to, "bob@pub.co.uk"); assert.match(mails.at(-1).subject, /enquiry/);
  for (let i = 0; i < 4; i++) await call("POST", "contact", { name: "Bob", email: "bob@pub.co.uk", message: "again " + i });
  r = await call("POST", "contact", { name: "Bob", email: "bob@pub.co.uk", message: "and again" }); assert.equal(r.status, 429);
}
// price breaks: a league that goes over its plan's teams is asked first, then moves up and the extra is noted
{
  r = await call("PATCH", "super/settings", { plans: [{ maxTeams: 4, price: 60 }, { maxTeams: 6, price: 90 }, { maxTeams: 8, price: 120 }, { maxTeams: 10, price: 150 }] }, boss);
  assert.equal(r.body.plans.length, 4, "breaks can be added");
  r = await call("POST", "auth/signup", { name: "Pat", email: "pat@plans.test", password: "longenough" }); const pat = r.body.token;
  r = await call("POST", "leagues", { name: "Plan League", slug: "plan-league" }, pat); const PL = r.body.league;
  assert.deepEqual([PL.plan.maxTeams, PL.plan.price], [4, 6000], "a new league starts on the smallest plan");
  r = await call("POST", `leagues/${PL.id}/seasons`, { name: "2026–27", start: "2026-09-01", end: "2027-05-31" }, pat); const PS = r.body.season;
  const team = i => ({ in: "teams", id: "t" + i, value: { id: "t" + i, name: "Team " + i, players: [] } });
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 0, changes: [1, 2, 3, 4].map(team) }, pat); assert.equal(r.status, 200, "4 teams fit");
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 1, changes: [team(5)] }, pat);
  assert.equal(r.status, 402); const offer = r.body.planNeeded;
  assert.deepEqual([offer.teams, offer.from.maxTeams, offer.to.maxTeams, offer.to.price], [5, 4, 6, 9000]);
  assert.equal(offer.until, "2026-12-31"); assert.equal(offer.days, 30); assert.equal(offer.extra, Math.round(3000 * 30 / 365), "the difference for the rest of the year");
  r = await call("GET", `leagues/${PL.id}/seasons/${PS.id}`, null, pat); assert.equal(Object.keys(r.body.teams).length, 4, "nothing saved until accepted");
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 1, changes: [team(5)], acceptPlan: true }, pat); assert.equal(r.status, 200);
  r = await call("GET", "public/plan-league"); assert.equal(r.body.league.plan.maxTeams, 6); assert.equal(r.body.league.plan.price, 9000);
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 2, changes: [team(6)] }, pat); assert.equal(r.status, 200, "up to the new plan's teams is fine");
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 3, changes: [7, 8, 9, 10, 11].map(team) }, pat);
  assert.equal(r.status, 402); assert.equal(r.body.planNeeded.to.poa, true, "past the last break is on application"); assert.equal(r.body.planNeeded.extra, null);
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 3, changes: [7, 8, 9, 10, 11].map(team), acceptPlan: true }, pat); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${PL.id}/seasons/${PS.id}/data`, { base: 4, changes: [team(12)] }, pat); assert.equal(r.status, 200, "no more questions once on application");
  // a past season doesn't count
  r = await call("POST", `leagues/${PL.id}/seasons`, { name: "2019–20", start: "2019-09-01", end: "2020-05-31" }, pat); const old = r.body.season;
  r = await call("PUT", `leagues/${PL.id}/seasons/${old.id}`, { version: 0, data: { teams: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["o" + i, { id: "o" + i, name: "Old " + i }])), venues: {}, fixtures: {} }, contacts: {} }, pat);
  assert.equal(r.status, 200, "importing an old season isn't limited");
  // the overall admin's list to bill
  r = await call("GET", "super/plans", null, boss); const moves = r.body.changes.filter(c => c.leagueId === PL.id);
  const up = moves.find(c => c.to.maxTeams === 6);
  assert.equal(moves.length, 2); assert.ok(up); assert.ok(moves.some(c => c.to.poa)); assert.equal(up.billed, false); assert.equal(up.from.maxTeams, 4);
  r = await call("PATCH", `super/plans/${PL.id}/${up.id}`, { billed: true }, boss); assert.equal(r.body.billed, true);
  r = await call("PATCH", "super/settings", { plans: [{ maxTeams: 30, price: 60 }, { maxTeams: 60, price: 90 }, { maxTeams: 90, price: 120 }] }, boss);
  r = await call("DELETE", `leagues/${PL.id}`, null, boss); assert.equal(r.status, 200);
}
// downloads: files a league puts up for anyone
{
  const b64 = str => Buffer.from(str, "binary").toString("base64");
  const up = body => call("POST", `leagues/${L.id}/docs`, body, boss);
  r = await up({ name: "evil.html", data: b64("<script>") }); assert.equal(r.status, 400, "only listed kinds of file");
  r = await up({ name: "book.pdf", data: b64("not a pdf") }); assert.equal(r.status, 400, "the first bytes must match");
  r = await up({ name: "notes.txt", data: b64("ok\x01\x02binary") }); assert.equal(r.status, 400);
  r = await up({ name: "empty.pdf", data: "" }); assert.equal(r.status, 400);
  r = await up({ name: "../Fixture Book 2026.pdf", title: "", category: "Fixture books", data: b64("%PDF-1.4 hello") });
  assert.equal(r.status, 200); const d = r.body.item;
  assert.equal(d.name, "Fixture Book 2026.pdf"); assert.equal(d.title, "Fixture Book 2026", "the title defaults to the file name"); assert.equal(d.size, 14); assert.equal(d.category, "Fixture books");
  r = await call("GET", "public/yeovil-league/docs"); assert.equal(r.body.items[0].id, d.id);
  let res = await api(new Request(`http://x/api/public/yeovil-league/docs/${d.id}`));
  assert.equal(res.headers.get("content-type"), "application/pdf"); assert.match(res.headers.get("content-disposition"), /^inline; filename="Fixture Book 2026.pdf"/);
  assert.equal(await res.text(), "%PDF-1.4 hello");
  res = await api(new Request(`http://x/api/public/yeovil-league/docs/${d.id}?download=1`)); assert.match(res.headers.get("content-disposition"), /^attachment/);
  r = await up({ name: "rules.docx", data: b64("PK\x03\x04 word") }); const w = r.body.item;
  res = await api(new Request(`http://x/api/public/yeovil-league/docs/${w.id}`)); assert.match(res.headers.get("content-disposition"), /^attachment/, "Word files always download");
  r = await call("PATCH", `leagues/${L.id}/docs/${d.id}`, { title: "Fixture book 2026–27", category: "Fixtures" }, boss); assert.equal(r.body.items.find(x => x.id === d.id).title, "Fixture book 2026–27");
  r = await call("POST", `leagues/${L.id}/docs`, { name: "x.pdf", data: b64("%PDF") }); assert.equal(r.status, 401, "only admins add files");
  r = await call("DELETE", `leagues/${L.id}/docs/${w.id}`, null, boss); assert.equal(r.body.items.length, 1);
  assert.equal((await api(new Request(`http://x/api/public/yeovil-league/docs/${w.id}`))).status, 404);
}
for (const bad of [[], [{ in: "users", id: "x", value: {} }], [{ in: "teams", id: "__proto__", value: { a: 1 } }], [{ in: "teams", id: "x", value: "str" }]]) {
  r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: 0, changes: bad }, boss); assert.equal(r.status, 400);
}
r = await call("PATCH", `leagues/${L.id}/seasons/${S1.id}/data`, { base: 0, changes: [{ in: "teams", id: "x", value: {} }] }, other); assert.equal(r.status, 404);
for (let i = 0; i < 45; i++) { clock += 11 * 60e3; await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: await ver(), data: season, contacts: {} }, boss); }
assert.equal((await hist()).length, 40, "only the newest 40 copies are kept"); assert.equal([...data.keys()].filter(k => k.startsWith(`history/${L.id}/${S1.id}/`)).length, 40);
// reading a photo of the board: an add-on set by the overall admin, counted per league each month
r = await call("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.equal(r.body.available, false); assert.match(r.body.reason, /switched on/);
let lastRead = null, readerFails = false;
const runner = createBoardRunner({ store, webcrypto, env: { SESSION_SECRET: "s" }, read: async input => {
  lastRead = input; if (readerFails) throw new Error("Overloaded");
  return { teams: [{ team: 0, rows: [{ boardName: "Sue", playerKey: "sue ashby", hands: [7, 13, 5.2, 40, "x", 6], spares: [false, true, false, false, false, true], unsure: [2, 9], writtenTotal: 43 },
    { boardName: "Sue again", playerKey: "sue ashby", hands: [1, 1, 1, 1, 1, 1], spares: [], unsure: [], writtenTotal: -1 }], handTotals: [8, 14], writtenTotal: 49 },
    { team: 7, rows: [] }], notes: "Second row is hard to read." };
} });
const started = [];
const api2 = createApi({ store, webcrypto, env: { SESSION_SECRET: "s", SUPERADMIN_EMAIL: "Owner@Test.com" }, today: () => day, pause: async () => {}, now: () => clock, startBoardJob: async key => { started.push(key); } });
const call2 = async (method, path, body, token) => { const r = await api2(new Request("http://x/api/" + path, { method, headers: token ? { authorization: "Bearer " + token } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };
const match = { title: "Red Devils v Rollers", game: "rough", hands: 6, balls: 3, teams: [{ title: "Red Devils", rows: 6, players: [{ key: "sue ashby", name: "Sue Ashby", nick: "" }] }, { title: "Rollers", rows: 6, players: [] }] };
const photo = { mediaType: "image/jpeg", data: "A".repeat(400) };
r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.equal(r.body.available, false); assert.match(r.body.reason, /add-on/);
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, sec3); assert.equal(r.status, 403);
r = await call2("PATCH", `super/users/${secUser.id}`, { photos: { until: "2026-11-30", monthlyLimit: 2 } }, boss); assert.equal(r.body.user.photos.monthlyLimit, 2);
r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.match(r.body.reason, /ended on 30 November 2026/);
r = await call2("PATCH", `super/users/${secUser.id}`, { photos: { until: "2027-12-01", monthlyLimit: "lots" } }, boss); assert.equal(r.status, 400);
r = await call2("PATCH", `super/users/${secUser.id}`, { photos: { until: "2027-12-01", monthlyLimit: 2 } }, boss);
r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.deepEqual(r.body, { available: true, reason: null, used: 0, limit: 2, until: "2027-12-01", mode: "extra" });
for (const bad of [{ images: [], match }, { images: [{ ...photo, mediaType: "image/gif" }], match }, { images: [{ ...photo, data: "not base64!" + "A".repeat(200) }], match }, { images: [photo, photo, photo], match }, { images: [photo], match: { ...match, hands: 0 } }, { images: [photo], match: { ...match, teams: [] } }]) {
  r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, bad, sec3); assert.equal(r.status, 400);
}
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, other); assert.equal(r.status, 404, "other accounts can't use it");
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, sec3); assert.equal(r.status, 200); assert.equal(r.body.used, 1);
const job1 = r.body.job, key1 = started.at(-1);
r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${job1}`, null, sec3); assert.equal(r.body.status, "reading");
assert.equal(await runner.verify(key1, await runner.sign(key1)), true); assert.equal(await runner.verify(key1, "nope"), false); assert.equal(await runner.verify("users/x", await runner.sign("users/x")), false);
await runner.run(key1);
assert.equal(lastRead.images[0].data, photo.data); assert.match(lastRead.prompt, /sue ashby \| Sue Ashby/); assert.match(lastRead.prompt, /up to 27/); assert.equal(lastRead.schema.required[0], "teams");
assert.equal((await store.get(key1)).images, null, "photos are dropped once read");
r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${job1}`, null, other); assert.equal(r.status, 404);
r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${job1}`, null, sec3); assert.equal(r.body.status, "done");
const read1 = r.body.result; assert.equal(read1.teams.length, 1, "unknown team dropped"); assert.equal(read1.notes, "Second row is hard to read.");
assert.deepEqual(read1.teams[0].rows[0], { boardName: "Sue", key: "sue ashby", hands: [7, 13, 5, null, null, 6], spares: [false, true, false, false, false, true], unsure: [2, 3, 4], writtenTotal: 43 });
assert.equal(read1.teams[0].rows[1].key, "", "a player can only be matched once"); assert.equal(read1.teams[0].rows[1].writtenTotal, null);
assert.deepEqual(read1.teams[0].handTotals, [8, 14]);
r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${job1}`, null, sec3); assert.equal(r.status, 404, "a reading is collected once");
readerFails = true;
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, sec3); assert.equal(r.body.used, 2);
await runner.run(started.at(-1));
r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${r.body.job}`, null, sec3); assert.deepEqual(r.body, { status: "failed", error: "Overloaded" });
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, sec3); assert.equal(r.status, 403); assert.match(r.body.error, /all 2 photo readings/);
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/read-board`, { images: [photo], match }, boss); assert.equal(r.status, 200, "no limit for the overall admin");
clock += 6 * 60e3; r = await call2("GET", `leagues/${L.id}/seasons/${S1.id}/read-board/${r.body.job}`, null, boss); assert.equal(r.body.status, "failed", "a reading that never finishes times out");
r = await call2("GET", "super/users", null, boss); assert.equal(r.body.users.find(u => u.email === "sec@x.com").leagues[0].photosThisMonth, 3); assert.equal(r.body.photoReading, true);
day = "2027-01-02"; r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.equal(r.body.used, 0, "a new month starts again"); day = "2026-12-01";
r = await call2("PATCH", `super/users/${secUser.id}`, { photos: null }, boss); assert.equal(r.body.user.photos, null);
// add-ons can be included in the basic subscription instead, with a site-wide monthly limit
r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.equal(r.body.available, false);
r = await call2("PATCH", "super/settings", { addons: { photos: { mode: "free" } } }, boss); assert.equal(r.status, 400);
r = await call2("PATCH", "super/settings", { addons: { photos: { mode: "included", monthlyLimit: 5 } } }, sec3); assert.equal(r.status, 404);
r = await call2("PATCH", "super/settings", { addons: { photos: { mode: "included", monthlyLimit: 5 } } }, boss); assert.deepEqual(r.body.addons.photos, { mode: "included", monthlyLimit: 5, price: 0 }); assert.equal(r.body.addons.reports.mode, "extra");
r = await call2("GET", `leagues/${L.id}/addons`, null, sec3); assert.equal(r.body.photos.available, true); assert.equal(r.body.photos.limit, 5); assert.equal(r.body.reports.available, false); assert.match(r.body.reports.reason, /Match night reports is an add-on/);
// match night reports: drafted by Claude from the night's facts, published by the secretary
const facts = { league: "Yeovil", date: "2026-11-26", results: [{ home: "Red Devils", away: "Rollers", homePins: 240, awayPins: 231 }] };
r = await call2("PATCH", "super/settings", { addons: { reports: { price: "lots" } } }, boss); assert.equal(r.status, 400);
r = await call2("PATCH", "super/settings", { addons: { reports: { price: 24.5 } } }, boss); assert.equal(r.body.addons.reports.price, 2450); assert.equal(r.body.addons.photos.mode, "included", "other settings kept");
r = await call2("GET", `leagues/${L.id}/addons`, null, sec3); assert.match(r.body.reports.reason, /£24\.50 a year/);
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "2026-11-26", facts }, sec3); assert.equal(r.status, 403);
r = await call2("PATCH", `super/users/${secUser.id}`, { reports: { until: "2027-12-01" } }, boss); assert.equal(r.body.user.reports.until, "2027-12-01");
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "nope", facts }, sec3); assert.equal(r.status, 400);
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "2026-11-26", facts, auto: true }, sec3); assert.equal(r.status, 200);
const rid = r.body.id; assert.equal(r.body.items.find(n => n.id === rid).status, "drafting");
let reportRead = null; const reportRunner = createBoardRunner({ store, webcrypto, env: { SESSION_SECRET: "s" }, read: async input => { reportRead = input; return { title: "Devils edge Rollers", body: "Red Devils won 240 to 231.\n\n\n\nRollers next." }; } });
r = await call2("GET", "public/yeovil-league/news"); assert.equal(r.body.items.some(n => n.id === rid), false, "drafts aren't public");
await reportRunner.run(started.at(-1));
assert.match(reportRead.prompt, /"homePins":240/); assert.equal(reportRead.images.length, 0); assert.deepEqual(reportRead.schema.required, ["title", "body"]);
assert.equal(data.has(started.at(-1)), false, "the job is removed once written");
r = await call2("GET", `leagues/${L.id}/news`, null, sec3); let rep = r.body.items.find(n => n.id === rid);
assert.equal(rep.status, "draft"); assert.equal(rep.title, "Devils edge Rollers"); assert.equal(rep.body, "Red Devils won 240 to 231.\n\nRollers next."); assert.deepEqual(rep.report, { date: "2026-11-26", season: S1.id });
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "2026-11-26", facts, auto: true }, sec3); assert.equal(r.body.skipped, true, "only one automatic report a night");
r = await call2("GET", `leagues/${L.id}/news`, null, other); assert.equal(r.status, 404);
r = await call2("PATCH", `leagues/${L.id}/news/${rid}`, { body: "Edited by the secretary.", photos: ["abc", "abc", "BAD!"] }, sec3); rep = r.body.items.find(n => n.id === rid);
assert.equal(rep.status, "draft", "editing keeps it a draft"); assert.deepEqual(rep.photos, ["abc"]);
clock += 60e3; r = await call2("PATCH", `leagues/${L.id}/news/${rid}`, { publish: true }, sec3); rep = r.body.items.find(n => n.id === rid); assert.equal(rep.status, undefined);
r = await call2("GET", "public/yeovil-league/news"); assert.equal(r.body.items.find(n => n.id === rid).body, "Edited by the secretary.");
// asking again for a published night starts a new draft; a failed draft says why and can be retried
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "2026-11-26", facts }, sec3); const rid2 = r.body.id; assert.notEqual(rid2, rid);
await createBoardRunner({ store, webcrypto, env: { SESSION_SECRET: "s" }, read: async () => { throw new Error("Busy"); } }).run(started.at(-1));
r = await call2("GET", `leagues/${L.id}/news`, null, sec3); assert.deepEqual([r.body.items.find(n => n.id === rid2).status, r.body.items.find(n => n.id === rid2).error], ["failed", "Busy"]);
r = await call2("POST", `leagues/${L.id}/seasons/${S1.id}/report`, { date: "2026-11-26", facts }, sec3); assert.equal(r.body.id, rid2, "a retry reuses the draft");
clock += 6 * 60e3; r = await call2("GET", `leagues/${L.id}/news`, null, sec3); assert.equal(r.body.items.find(n => n.id === rid2).status, "failed", "a report that never finishes shows as failed");
r = await call2("POST", `leagues/${L.id}/news`, { title: "Draft note", body: "Not yet", draft: true }, sec3); assert.equal(r.body.item.status, "draft");
r = await call2("GET", "public/yeovil-league/news"); assert.equal(r.body.items.some(n => n.title === "Draft note"), false);
r = await call2("GET", "super/users", null, boss); assert.equal(r.body.users.find(u => u.email === "sec@x.com").leagues[0].reportsThisMonth, 3); assert.equal(r.body.addons.photos.mode, "included");
assert.equal(boardMatch({ ...match, teams: [{ title: "", players: [] }] }), null);
assert.match(boardPrompt(boardMatch({ ...match, game: "nomination", balls: 2 })), /nomination skittles.*up to 18/s);
assert.deepEqual(parseBoard(null, boardMatch(match)), { teams: [], notes: "" });
// news posts and photos: secretary posts, everyone reads
r = await call("POST", `leagues/${L.id}/news`, { title: "", body: "x" }, sec3); assert.equal(r.status, 400);
r = await call("POST", `leagues/${L.id}/news`, { title: "Cup draw", body: "Drawn tonight.\r\n\r\n\r\n\r\nGood luck!" }, sec3); assert.equal(r.status, 200); assert.equal(r.body.item.body, "Drawn tonight.\n\nGood luck!");
clock += 1000; r = await call("POST", `leagues/${L.id}/news`, { title: "AGM", body: "Monday 8pm." }, sec3); const agm = r.body.item.id;
clock += 1000; r = await call("POST", `leagues/${L.id}/news`, { title: "Pinned", body: "Read me", pinned: true }, sec3);
const mine = items => items.filter(x => ["Pinned", "AGM", "AGM moved", "Cup draw"].includes(x.title));
r = await call("GET", "public/yeovil-league/news"); assert.deepEqual(mine(r.body.items).map(x => x.title), ["Pinned", "AGM", "Cup draw"]);
r = await call("PATCH", `leagues/${L.id}/news/${agm}`, { title: "AGM moved", pinned: true }, sec3); assert.deepEqual(mine(r.body.items).map(x => x.title), ["Pinned", "AGM moved", "Cup draw"], "pinned first, newest first"); assert.equal(mine(r.body.items)[1].body, "Monday 8pm.");
r = await call("DELETE", `leagues/${L.id}/news/${agm}`, null, sec3); assert.equal(mine(r.body.items).length, 2);
r = await call("POST", `leagues/${L.id}/news`, { title: "Hack", body: "x" }, other); assert.equal(r.status, 404);
const img = { mediaType: "image/jpeg", data: Buffer.from("fake jpeg bytes ".repeat(20)).toString("base64") };
r = await call("POST", `leagues/${L.id}/media`, { image: { ...img, mediaType: "text/html" } }, sec3); assert.equal(r.status, 400);
r = await call("POST", `leagues/${L.id}/media`, { image: img, thumb: { ...img, data: Buffer.from("small".repeat(20)).toString("base64") }, caption: "Cup winners", cupId: "c1", cupName: "KO Cup", seasonId: S1.id, width: 1600, height: 1200 }, sec3);
const mid = r.body.item.id; assert.equal(r.body.item.cupName, "KO Cup"); assert.equal(r.body.item.width, 1600);
r = await call("GET", "public/yeovil-league/media"); assert.equal(r.body.items[0].caption, "Cup winners"); assert.equal(r.body.items[0].data, undefined, "the index doesn't carry the photo itself");
let res = await api(new Request(`http://x/api/public/yeovil-league/media/${mid}`)); assert.equal(res.headers.get("content-type"), "image/jpeg"); assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "fake jpeg bytes ".repeat(20));
res = await api(new Request(`http://x/api/public/yeovil-league/media/${mid}?size=thumb`)); assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "small".repeat(20));
r = await call("PATCH", `leagues/${L.id}/media/${mid}`, { caption: "Winners 2026", cupId: "" }, sec3); assert.equal(r.body.items[0].cupId, null); assert.equal(r.body.items[0].caption, "Winners 2026");
r = await call("DELETE", `leagues/${L.id}/media/${mid}`, null, other); assert.equal(r.status, 404);
r = await call("POST", `leagues/${L.id}/media`, { image: img }, sec3); assert.equal(r.status, 200);
r = await call("DELETE", `leagues/${L.id}/media/${mid}`, null, sec3); assert.equal(r.body.items.length, 1); assert.equal(data.has(`media/${L.id}/${mid}`), false); assert.equal(data.has(`media/${L.id}/${mid}/thumb`), false);
r = await call("GET", "public/yeovil-league/media/nope"); assert.equal(r.status, 404);
r = await call("DELETE", `leagues/${L.id}`, null, boss); r = await call("GET", "public/yeovil-league"); assert.equal(r.status, 404);
assert.equal([...data.keys()].filter(k => ["seasons/", "contacts/", "history", "board-jobs/", "usage/", "news/", "media"].some(p => k.startsWith(p))).length, 0);
// a shared news post's page carries its preview details
{
  const html = `<html><head><title>Skittles League</title><meta name="description" content="x"></head><body></body></html>`;
  await store.set("slugs/share-test", { leagueId: "LS" }); await store.set("leagues/LS", { id: "LS", name: "Share & Co" });
  await store.set("news/LS", { items: [{ id: "p1", title: 'Cup "final" night', body: "A great night.\n\nWell done all. ".repeat(20), photos: ["m1"] }, { id: "d1", title: "Draft", body: "x", status: "draft" }] });
  const page = await newsSharePage({ store, slug: "Share-Test", id: "p1", origin: "https://s.example", html });
  assert.match(page, /<title>Cup &quot;final&quot; night · Share &amp; Co<\/title>/);
  assert.match(page, /<meta property="og:image" content="https:\/\/s.example\/api\/public\/share-test\/media\/m1">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/s.example\/share-test\/news\/p1">/);
  assert.match(page, /name="twitter:card" content="summary_large_image"/);
  assert.ok(/og:description" content="([^"]*)"/.exec(page)[1].length <= 200, "the description is kept short");
  assert.equal(await newsSharePage({ store, slug: "share-test", id: "d1", origin: "https://s.example", html }), null, "drafts aren't shared");
  assert.equal(await newsSharePage({ store, slug: "nope", id: "p1", origin: "https://s.example", html }), null);
}
// admin roles and captain logins
{
  const su = async (name, email) => (await call("POST", "auth/signup", { name, email, password: "longenough" })).body.token;
  const own = await su("Roles Sec", "roles-sec@x.com"), res = await su("Res", "res@x.com"), fix = await su("Fix", "fix@x.com"), med = await su("Med", "med@x.com"), cap = await su("Cap", "cap@x.com"), nobody = await su("No", "no@x.com");
  r = await call("POST", "leagues", { name: "Roles League", slug: "roles-league" }, own); const RL = r.body.league;
  r = await call("POST", `leagues/${RL.id}/seasons`, { name: "2026–27", start: "2026-09-01", end: "2027-05-01" }, own); const RS = r.body.season;
  const data0 = { teams: { a: { id: "a", name: "Aces", players: [{ first: "Al", last: "One" }] }, b: { id: "b", name: "Bees", players: [] } }, venues: { v: { id: "v", name: "Hall" } },
    fixtures: { f: { id: "f", comp: "league", date: "2026-10-01", home: "a", away: "b", homePins: null, awayPins: null }, f2: { id: "f2", comp: "league", date: "2026-10-02", home: "b", away: "a", homePins: null, awayPins: null } }, divisions: {}, cups: { c: { id: "c", name: "Cup", results: {} } } };
  r = await call("PUT", `leagues/${RL.id}/seasons/${RS.id}`, { version: 0, data: data0, contacts: { a: { mobile: "07700 900000" } } }, own); assert.equal(r.status, 200);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, res); assert.equal(r.status, 404, "not an admin yet");
  r = await call("PATCH", `leagues/${RL.id}`, { members: [{ email: "RES@x.com", roles: ["results"] }, { email: "fix@x.com", roles: ["fixtures"] }, { email: "med@x.com", roles: ["media", "nope"] }] }, own); assert.equal(r.status, 200);
  assert.equal(mails.filter(m => /added you to Roles League/.test(m.text)).length, 3, "each new admin is emailed");
  r = await call("PATCH", `leagues/${RL.id}`, { members: [{ email: "x@x.com", roles: [] }] }, own); assert.equal(r.status, 400);
  r = await call("PATCH", `leagues/${RL.id}`, { members: [] }, res); assert.equal(r.status, 403, "only the secretary changes admins");
  r = await call("GET", `leagues/${RL.id}/members`, null, own); assert.deepEqual(r.body.members.map(m => [m.email, m.roles]), [["res@x.com", ["results"]], ["fix@x.com", ["fixtures"]], ["med@x.com", ["media"]]]);
  assert.equal(r.body.captainLogins, false); assert.equal(r.body.contactRoles.results, false);
  r = await call("GET", `leagues/${RL.id}/members`, null, res); assert.equal(r.status, 403);
  r = await call("GET", "my/leagues", null, res); assert.deepEqual(r.body.leagues.map(l => [l.name, l.access.roles, l.access.owner]), [["Roles League", ["results"], false]]);
  // contacts: hidden from roles until the secretary allows them
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, res); const v1 = r.body.version; assert.deepEqual(r.body.contacts, {}); assert.equal(r.body.contactsHidden, true);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, own); assert.equal(r.body.contacts.a.mobile, "07700 900000");
  r = await call("PATCH", `leagues/${RL.id}`, { contactRoles: { results: true } }, own);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, res); assert.equal(r.body.contacts.a.mobile, "07700 900000");
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, fix); assert.deepEqual(r.body.contacts, {});
  // results secretary: results of games already there, nothing else
  const ch = (k, id, value) => ({ base: v1, changes: [{ in: k, id, value }] });
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "f2", { ...data0.fixtures.f2, homePins: 250, awayPins: 240, ready: true }), res); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "f2", { ...data0.fixtures.f2, homePins: 250, awayPins: 240, ready: true, date: "2026-11-01" }), res); assert.equal(r.status, 403, "results secretaries don't move games");
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "new", { id: "new", comp: "league" }), res); assert.equal(r.status, 403);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "f", null), res); assert.equal(r.status, 403);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("cups", "c", { id: "c", name: "Cup", results: { "1-0": { aPins: 1, bPins: 0 } } }), res); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("cups", "c", { id: "c", name: "Renamed", results: {} }), res); assert.equal(r.status, 403);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("teams", "a", { ...data0.teams.a, name: "X" }), res); assert.equal(r.status, 403);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}/submissions`, null, res); assert.equal(r.status, 200);
  r = await call("PUT", `leagues/${RL.id}/seasons/${RS.id}`, { version: 0, data: data0, contacts: {} }, res); assert.equal(r.status, 403);
  r = await call("POST", `leagues/${RL.id}/news`, { title: "Hi", body: "x" }, res); assert.equal(r.status, 403);
  r = await call("PATCH", `leagues/${RL.id}`, { name: "Hijack" }, res); assert.equal(r.status, 403);
  r = await call("POST", `leagues/${RL.id}/seasons`, { name: "X", start: "2027-09-01", end: "2028-05-01" }, res); assert.equal(r.status, 403);
  // fixtures & cups secretary: games, venues, divisions and cups, but not teams or seasons
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "new", { id: "new", comp: "league", date: "2026-12-01", home: "b", away: "a" }), fix); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("venues", "v2", { id: "v2", name: "Club" }), fix); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("teams", "z", { id: "z", name: "Zeds" }), fix); assert.equal(r.status, 403);
  r = await call("DELETE", `leagues/${RL.id}/seasons/${RS.id}`, null, fix); assert.equal(r.status, 403);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}/history`, null, fix); assert.equal(r.status, 403);
  // news & media: posts, but no season changes
  r = await call("POST", `leagues/${RL.id}/news`, { title: "Hi", body: "x" }, med); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, ch("fixtures", "f", { ...data0.fixtures.f, homePins: 1, awayPins: 2 }), med); assert.equal(r.status, 403);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}/submissions`, null, med); assert.equal(r.status, 403);
  // captains: off by default; once on, a captain sends their own team's result without the code and keeps its players
  r = await call("PATCH", `leagues/${RL.id}`, { captains: [{ email: "cap@x.com", team: "Aces" }] }, own); assert.equal(r.status, 200);
  r = await call("GET", "public/roles-league"); assert.equal(r.body.league.takesResults, false); assert.equal(r.body.league.captainLogins, false);
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, cap); assert.equal(r.status, 404, "captain logins are off");
  r = await call("PATCH", `leagues/${RL.id}`, { captainLogins: true }, own);
  r = await call("GET", "public/roles-league"); assert.equal(r.body.league.takesResults, true);
  r = await call("GET", "my/leagues", null, cap); assert.equal(r.body.leagues[0].access.captain, "Aces");
  r = await call("GET", `leagues/${RL.id}/seasons/${RS.id}`, null, cap); assert.equal(r.status, 200); assert.deepEqual(r.body.contacts, {}); const vc = r.body.version;
  r = await call("GET", `leagues/${RL.id}/news`, null, cap); assert.equal(r.status, 403);
  const capCh = (id, value) => ({ base: vc, changes: [{ in: "teams", id, value }] });
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, capCh("a", { ...data0.teams.a, players: [{ first: "Al", last: "One" }, { first: "Bo", last: "Two" }] }), cap); assert.equal(r.status, 200);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, capCh("a", { ...data0.teams.a, name: "Aces Up" }), cap); assert.equal(r.status, 403, "captains change only players");
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, capCh("b", { ...data0.teams.b, players: [{ first: "X", last: "Y" }] }), cap); assert.equal(r.status, 403, "only their own team");
  const card = n => ({ mode: "totals", rows: [{ key: n, name: n, total: 40 }, { key: n + "2", name: n + "2", total: 41 }] });
  const sub = (body, token) => api(new Request(`http://x/api/public/roles-league/seasons/${RS.id}/submissions`, { method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body: JSON.stringify(body) })).then(async x => ({ status: x.status, body: await x.json() }));
  r = await sub({ fixtureId: "f", team: "a", cards: { home: card("A"), away: card("B") } }, null); assert.equal(r.status, 403, "no code and not logged in");
  r = await sub({ fixtureId: "f", team: "b", cards: { home: card("A"), away: card("B") } }, cap); assert.equal(r.status, 403, "not their team");
  r = await sub({ fixtureId: "f", team: "a", cards: { home: card("A"), away: card("B") } }, cap); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await sub({ fixtureId: "f", team: "a", cards: { home: card("A"), away: card("B") } }, nobody); assert.equal(r.status, 403);
  // importing past results is an add-on
  r = await call("POST", `leagues/${RL.id}/seasons`, { name: "2019–20", start: "2019-09-01", end: "2020-05-01", import: true }, own); assert.equal(r.status, 402); assert.match(r.body.error, /Past results import/);
  r = await call("PATCH", `leagues/${RL.id}/seasons/${RS.id}/data`, { base: 0, changes: [{ in: "venues", id: "vx", value: { id: "vx", name: "X" } }], import: true }, own); assert.equal(r.status, 402);
  r = await call("GET", `leagues/${RL.id}/addons`, null, own); assert.equal(r.body.history.available, false); assert.equal(r.body.batch.available, false);
  r = await call("DELETE", `leagues/${RL.id}`, null, own); assert.equal(r.status, 200);
}
// reading a batch of photos: the game is found from the list, and a results-book page gives the other side's hand totals
{
  const m = sheetMatch({ kind: "sheet", game: "rough", hands: 6, balls: 3, rows: 6, teams: [{ name: "Aces", venue: "Duke of York", players: [{ key: "paul best", name: "Paul Best", nick: "Besty" }] }, { name: "Headhunters" }],
    fixtures: [{ id: "f1", date: "2026-10-01", home: 0, away: 1 }, { id: "bad", home: 0, away: 0 }] });
  assert.equal(m.fixtures.length, 1, "a team can't play itself");
  assert.match(sheetPrompt(m), /f1 \| 2026-10-01 \| home T0 Aces v away T1 Headhunters/);
  assert.equal(sheetMatch({ kind: "sheet", hands: 6, balls: 3, rows: 6, teams: [], fixtures: [] }), null);
  const got = parseSheet({ fixtureId: "f1", sides: [{ side: "home", rows: [{ boardName: "Besty", playerKey: "paul best", hands: [6, 7, 16, 16, 7, 99], spares: [false, false, true, true, false, false], unsure: [], writtenTotal: 60 }], handTotals: [40, 43, 55, 53, 40, 53], writtenTotal: 284 },
    { side: "away", rows: [], handTotals: [38, 42, 40, 50, 48, 37], writtenTotal: 255 }, { side: "away", rows: [] }], notes: "" }, m);
  assert.equal(got.sides.length, 2, "each side once");
  assert.deepEqual(got.sides[0].rows[0].hands, [6, 7, 16, 16, 7, null]); assert.deepEqual(got.sides[0].rows[0].unsure, [5], "an impossible score is left for checking");
  assert.equal(got.sides[0].rows[0].key, "paul best"); assert.equal(got.sides[1].writtenTotal, 255);
  assert.equal(parseSheet({ fixtureId: "nope", sides: [] }, m).fixtureId, "", "only games from the list");
}
console.log("all API checks passed");
