// Checks the API in lib/core.mjs: accounts, leagues, seasons, permissions, subscriptions and the overall admin.
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { createApi, createBoardRunner, parseBoard, boardMatch, boardPrompt } from "../lib/core.mjs";
const data = new Map();
const store = { get: async k => data.has(k) ? JSON.parse(data.get(k)) : null, set: async (k, v) => data.set(k, JSON.stringify(v)), del: async k => data.delete(k), list: async p => [...data.keys()].filter(k => k.startsWith(p)) };
let day = "2026-10-29", clock = Date.parse("2026-10-29T19:00:00Z");
const legacyData = { league: { teams: { a: { id: "a", name: "Red Devils", division: "Division 1" }, b: { id: "b", name: "Rollers", division: "Division 2" }, c: { id: "c", name: "Poachers" } }, venues: { v: { id: "v", name: "The Bell" } }, fixtures: {}, settings: { win: 3, draw: 1, loss: 0 } }, contacts: { a: { mobile: "07700" } } };
const api = createApi({ store, webcrypto, env: { SESSION_SECRET: "s", SUPERADMIN_EMAIL: "Owner@Test.com" }, legacy: async () => legacyData, today: () => day, pause: async () => {}, now: () => clock });
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
r = await call("GET", "super/users", null, sec2); assert.equal(r.status, 404);
r = await call("GET", "my/leagues", null, boss); assert.equal(r.body.leagues.length, 1); assert.equal(r.body.leagues[0].owner.email, "sec@x.com");
r = await call("GET", "super/users", null, boss); const secUser = r.body.users.find(u => u.email === "sec@x.com"); assert.equal(secUser.leagues[0].slug, "yeovil"); assert.equal(secUser.canEdit, false);
r = await call("PATCH", `super/users/${secUser.id}`, { subscription: { status: "paid", until: "2027-12-01" } }, boss); assert.equal(r.body.user.canEdit, true);
r = await call("PATCH", `leagues/${L.id}`, { name: "New name", slug: "yeovil-league", settings: { win: 3 } }, sec2); assert.equal(r.status, 200);
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
r = await call2("GET", `leagues/${L.id}/photo-reading`, null, sec3); assert.deepEqual(r.body, { available: true, reason: null, used: 0, limit: 2, until: "2027-12-01" });
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
assert.equal(boardMatch({ ...match, teams: [{ title: "", players: [] }] }), null);
assert.match(boardPrompt(boardMatch({ ...match, game: "nomination", balls: 2 })), /nomination skittles.*up to 18/s);
assert.deepEqual(parseBoard(null, boardMatch(match)), { teams: [], notes: "" });
r = await call("DELETE", `leagues/${L.id}`, null, boss); r = await call("GET", "public/yeovil-league"); assert.equal(r.status, 404);
assert.equal([...data.keys()].filter(k => ["seasons/", "contacts/", "history", "board-jobs/", "usage/"].some(p => k.startsWith(p))).length, 0);
console.log("all API checks passed");
