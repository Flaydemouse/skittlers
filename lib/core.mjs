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
const emptySeason = () => ({ version: 0, teams: {}, venues: {}, fixtures: {}, divisions: {} });

export function createApi({ store, webcrypto, env = {}, legacy = null, today = () => new Date().toISOString().slice(0, 10), pause = ms => new Promise(r => setTimeout(r, ms)) }) {
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
  const publicUser = u => ({ id: u.id, email: u.email, name: u.name, created: u.created, subscription: u.subscription, isSuper: isSuper(u), canEdit: subActive(u) });
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
  const canManage = (u, l) => !!u && (isSuper(u) || l.ownerId === u.id);
  const publicLeague = l => ({ id: l.id, slug: l.slug, name: l.name, settings: l.settings, seasons: l.seasons, currentSeasonId: l.currentSeasonId });
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
  async function readBody(req) {
    const text = await req.text();
    if (text.length > MAX_BODY) throw [413, "That's too much data to save in one go."];
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
      return json(await store.get(seasonKey(l.id, parts[3])) || emptySeason());
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
      const l = { id: randomId(), slug, name, ownerId: user.id, created: today(), seasons: [], currentSeasonId: null, settings: { win: 2, draw: 1, loss: 0 } };
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
        if (isObj(b.settings)) for (const k of ["win", "draw", "loss"]) {
          const n = Number(b.settings[k]); if (Number.isInteger(n) && n >= 0 && n <= 20) league.settings[k] = n;
        }
        if (b.currentSeasonId !== undefined) {
          if (!league.seasons.some(s => s.id === b.currentSeasonId)) return fail(400, "That season couldn't be found.");
          league.currentSeasonId = b.currentSeasonId;
        }
        await save();
        return json({ league: publicLeague(league) });
      }
      if (is("DELETE", "leagues", ":id")) {
        for (const s of league.seasons) { await store.del(seasonKey(league.id, s.id)); await store.del(contactsKey(league.id, s.id)); }
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
        await store.del(seasonKey(league.id, season.id)); await store.del(contactsKey(league.id, season.id));
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
        if (!isObj(data) || !isObj(contacts) || !["teams", "venues", "fixtures"].every(k => isObj(data[k])) || (data.divisions !== undefined && !isObj(data.divisions)))
          return fail(400, "The data sent wasn't valid.");
        const current = await store.get(seasonKey(league.id, season.id)) || emptySeason();
        if (version !== current.version)
          return fail(409, "conflict", { ...current, contacts: await store.get(contactsKey(league.id, season.id)) || {} });
        const next = { version: current.version + 1, updatedAt: new Date().toISOString(), teams: data.teams, venues: data.venues, fixtures: data.fixtures, divisions: data.divisions || {} };
        await store.set(contactsKey(league.id, season.id), contacts);
        await store.set(seasonKey(league.id, season.id), next);
        return json({ ...next, contacts });
      }
    }

    /* overall admin */
    if (parts[0] === "super") {
      if (!isSuper(user)) return fail(404, "Not found.");
      if (is("GET", "super", "users")) {
        const leagues = await allLeagues();
        return json({ users: (await allUsers()).map(u => ({ ...publicUser(u), leagues: leagues.filter(l => l.ownerId === u.id).map(l => ({ id: l.id, name: l.name, slug: l.slug })) })) });
      }
      if (is("PATCH", "super", "users", ":id")) {
        const u = await store.get(`users/${parts[2]}`); if (!u) return fail(404, "That account couldn't be found.");
        const b = await readBody(req), out = {};
        if (isObj(b.subscription)) {
          const until = b.subscription.until, status = b.subscription.status;
          if (!DATE_RE.test(until || "") || !["trial", "paid"].includes(status)) return fail(400, "Choose a status and an end date.");
          u.subscription = { status, until };
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
