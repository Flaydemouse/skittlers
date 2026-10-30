// Checks the API in lib/core.mjs: accounts, leagues, seasons, permissions, subscriptions and the overall admin.
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { createApi } from "../lib/core.mjs";
const data = new Map();
const store = { get: async k => data.has(k) ? JSON.parse(data.get(k)) : null, set: async (k, v) => data.set(k, JSON.stringify(v)), del: async k => data.delete(k), list: async p => [...data.keys()].filter(k => k.startsWith(p)) };
let day = "2026-10-29";
const legacyData = { league: { teams: { a: { id: "a", name: "Red Devils", division: "Division 1" }, b: { id: "b", name: "Rollers", division: "Division 2" }, c: { id: "c", name: "Poachers" } }, venues: { v: { id: "v", name: "The Bell" } }, fixtures: {}, settings: { win: 3, draw: 1, loss: 0 } }, contacts: { a: { mobile: "07700" } } };
const api = createApi({ store, webcrypto, env: { SESSION_SECRET: "s", SUPERADMIN_EMAIL: "Owner@Test.com" }, legacy: async () => legacyData, today: () => day, pause: async () => {} });
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
r = await call("POST", "auth/login", { email: "sec@x.com", password: temp }); assert.equal(r.status, 200);
r = await call("PUT", `leagues/${L.id}/seasons/${S1.id}`, { version: 3, data: season, contacts: {} }, boss); assert.equal(r.status, 200, "overall admin can edit any league");
// legacy import
r = await call("GET", "super/legacy", null, boss); assert.equal(r.body.teams, 3);
r = await call("POST", "super/legacy", { leagueId: L.id, seasonId: S2.id }, boss); assert.deepEqual(r.body.copied, { teams: 3, venues: 1, fixtures: 0 });
r = await call("GET", `leagues/${L.id}/seasons/${S2.id}`, null, boss);
const divs = Object.values(r.body.divisions).map(d => d.name).sort(); assert.deepEqual(divs, ["Division 1", "Division 2"]);
assert.equal(r.body.divisions[r.body.teams.a.division].name, "Division 1"); assert.equal(r.body.teams.c.division, undefined); assert.equal(r.body.contacts.a.mobile, "07700");
r = await call("DELETE", `leagues/${L.id}`, null, boss); r = await call("GET", "public/yeovil-league"); assert.equal(r.status, 404);
assert.equal([...data.keys()].filter(k => k.startsWith("seasons/") || k.startsWith("contacts/")).length, 0);
console.log("all API checks passed");
