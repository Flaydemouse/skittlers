// League API: public read, password login, and admin read/write.
// Data lives in Netlify Blobs: "league" (public) and "contacts" (captains' private details).
import { getStore } from "@netlify/blobs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const EMPTY = { version: 0, teams: {}, venues: {}, fixtures: {}, settings: {} };
const MAX_BODY = 2 * 1024 * 1024;
const SESSION_HOURS = 12;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const store = () => getStore({ name: "skittles-league", consistency: "strong" });
const env = name => process.env[name] || "";
const secret = () => env("SESSION_SECRET") || env("ADMIN_PASSWORD");

const sign = payload => createHmac("sha256", secret()).update(payload).digest("base64url");

function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}

function isAdmin(req) {
  const m = /^Bearer (\d+)\.([\w-]+)$/.exec(req.headers.get("authorization") || "");
  if (!m || !secret() || Number(m[1]) < Date.now()) return false;
  const want = Buffer.from(sign(m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

function passwordMatches(given) {
  if (!env("ADMIN_PASSWORD")) return false;
  const hash = v => createHash("sha256").update(String(v ?? "")).digest();
  return timingSafeEqual(hash(given), hash(env("ADMIN_PASSWORD")));
}

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

async function readAll() {
  const s = store();
  const [league, contacts] = await Promise.all([s.get("league", { type: "json" }), s.get("contacts", { type: "json" })]);
  return { league: { ...EMPTY, ...(league || {}) }, contacts: contacts || {} };
}

export default async req => {
  const path = new URL(req.url).pathname;

  if (path === "/api/league" && req.method === "GET") {
    const { league } = await readAll();
    return json(league);
  }

  if (path === "/api/login" && req.method === "POST") {
    if (!env("ADMIN_PASSWORD")) return json({ error: "The admin password hasn't been set up on Netlify yet." }, 500);
    const body = await req.json().catch(() => ({}));
    if (!passwordMatches(body.password)) {
      await new Promise(r => setTimeout(r, 800)); // slow down guessing
      return json({ error: "That password isn't right." }, 401);
    }
    return json({ token: makeToken() });
  }

  if (path === "/api/admin") {
    if (!isAdmin(req)) return json({ error: "Your admin session has ended. Log in again." }, 401);

    if (req.method === "GET") {
      const { league, contacts } = await readAll();
      return json({ ...league, contacts });
    }

    if (req.method === "PUT") {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "That's too much data to save in one go." }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: "The data sent wasn't valid." }, 400); }
      const { version, league, contacts } = body || {};
      if (!isObj(league) || !isObj(contacts) || !["teams", "venues", "fixtures", "settings"].every(k => isObj(league[k])))
        return json({ error: "The data sent wasn't valid." }, 400);

      const current = await readAll();
      if (version !== current.league.version)
        return json({ error: "conflict", ...current.league, contacts: current.contacts }, 409);

      const next = {
        version: current.league.version + 1,
        updatedAt: new Date().toISOString(),
        teams: league.teams, venues: league.venues, fixtures: league.fixtures, settings: league.settings,
      };
      const s = store();
      await s.setJSON("contacts", contacts);
      await s.setJSON("league", next);
      return json({ ...next, contacts });
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: ["/api/league", "/api/login", "/api/admin"] };
