// Builds a self-contained preview of public/index.html that runs without Netlify:
// the real API runs in the page, and data is kept in the artifact's database (or the browser).
// Usage: node dev/build-preview.mjs <output.html>
import { readFile, writeFile } from "node:fs/promises";

const out = process.argv[2];
if (!out) { console.error("Usage: node dev/build-preview.mjs <output.html>"); process.exit(1); }

let html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

// The preview host supplies its own document skeleton.
for (const tag of [/<!doctype html>\n/i, /<html[^>]*>\n/, /<head>\n/, /<meta charset[^>]*>\n/, /<meta name="viewport"[^>]*>\n/, /<\/head>\n/, /<body>\n/, /<\/body>\n/, /<\/html>\n?/])
  html = html.replace(tag, "");
// Artifacts can't load the site's own vendor files: inline Leaflet's CSS and load its script from cdnjs.
const leafletCss = await readFile(new URL("../public/vendor/leaflet/leaflet.css", import.meta.url), "utf8");
html = html.replace('<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', () => `<style>\n${leafletCss}\n</style>`);
html = html.replace('<script src="vendor/leaflet/leaflet.js"></script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>');
html = html.replace(/<title>[^<]*<\/title>/, `<title>Skittlers Preview</title>\n<meta name="claude:viewport-fit-sides" content="cover">`);

// The preview can't offer file downloads, so point to the live site for the template.
const TEMPLATE_HEADINGS = {
  "venues-template.csv": "Venue Name, Address Line 1, Address Line 2, Address Line 3, Postcode, Telephone, Number of Alleys",
  "players-template.csv": "Teams, First Name, Last Name",
};
html = html.replace(/<p style="margin:0"><a class="btn ghost sm" href="templates\/([^"]+)"[^]*?<\/p>/g, (_, file) =>
  `<p class="lookup-note">The template download works on the live site. Its headings are: ${TEMPLATE_HEADINGS[file] || "see the live site"}.</p>`);
const banner = `<div style="background:var(--warn-bg);color:var(--ink);font-size:.9rem">
  <div class="wrap" style="padding-block:8px"><strong>Preview.</strong> It doesn't touch the live site. <span id="preview-store-note">Connecting to your saved preview data…</span> Sign up with any email to try it as a league secretary. Sign up as <code>owner@skittlers.test</code> to see the overall admin pages. Postcode lookups and maps only work on the live site.</div>
</div>
`;
html = html.replace('<header class="band">', banner + '<header class="band">');

// The preview runs the real API (lib/core.mjs) in the page, storing data in the browser,
// and swaps page addresses for an in-memory one because an artifact can't change its address.
const core = (await readFile(new URL("../lib/core.mjs", import.meta.url), "utf8")).replace(/^export /gm, "");
const previewApi = `<script>
(() => {
${core}
  // Data lives in the artifact's database, so the preview shows the same leagues in any browser
  // signed in to Claude. Each store key is one document in "kv"; values too big for one document
  // continue in "kvparts". If the database can't be reached, the preview falls back to this browser.
  const KEY = "skittlers-preview-db", MOVED = "skittlers-preview-moved", PART = 200000;
  let db = {}, local = {};
  try { local = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  let shared = null;
  const docId = k => encodeURIComponent(k).replace(/[!*'()]/g, c => "%" + c.charCodeAt(0).toString(16)).replace(/%/g, "+");
  const note = text => { const el = document.getElementById("preview-store-note"); if (el) el.textContent = text; else setTimeout(() => note(text), 200); };
  const waitForClaude = async () => { for (let i = 0; i < 30 && !window.claude?.use; i++) await new Promise(r => setTimeout(r, 100)); return window.claude?.use ? window.claude.use("db") : null; };
  let mains = new Map(), parts = new Map();
  const rebuild = () => {
    const next = {};
    for (const d of mains.values()) {
      let text = d.v;
      for (let i = 1; i < (d.n || 1); i++) { const p = parts.get(d.id + "." + i); if (!p || p.at !== d.at) { text = null; break; } text += p.v; }
      try { next[d.k] = text === null ? db[d.k] : JSON.parse(text); } catch { next[d.k] = db[d.k]; }
    }
    for (const k of writes.keys()) if (k in db) next[k] = db[k]; else delete next[k];
    db = next;
  };
  const writes = new Map();
  const queue = (k, job) => { const p = (writes.get(k) || Promise.resolve()).then(job).catch(e => { console.error("Couldn't save to the shared preview data", e); note("Changes couldn't be saved to your Claude account just now. Reload the page and try again."); })
    .finally(() => { if (writes.get(k) === p) writes.delete(k); }); writes.set(k, p); return p; };
  const writeShared = (k, v) => queue(k, async () => {
    const id = docId(k), text = JSON.stringify(v), at = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const old = mains.get(id)?.n || 1, n = Math.max(1, Math.ceil(text.length / PART));
    for (let i = 1; i < n; i++) await shared.doc("kvparts/" + id + "." + i).set({ v: text.slice(i * PART, (i + 1) * PART), at });
    await shared.doc("kv/" + id).set({ k, n, at, v: text.slice(0, PART) });
    for (let i = n; i < old; i++) await shared.doc("kvparts/" + id + "." + i).delete();
  });
  const deleteShared = k => queue(k, async () => {
    const id = docId(k), n = mains.get(id)?.n || 1;
    await shared.doc("kv/" + id).delete();
    for (let i = 1; i < n; i++) await shared.doc("kvparts/" + id + "." + i).delete();
  });
  const ready = (async () => {
    try { shared = await waitForClaude(); } catch { shared = null; }
    if (!shared) { db = local; note("Saved in this browser only: your Claude account's storage isn't available here."); return; }
    try {
      const timeout = new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 15000));
      const [a, b] = await Promise.race([Promise.all([shared.collection("kv").get(), shared.collection("kvparts").get()]), timeout]);
      mains = new Map(a.docs.map(d => [d.id, { id: d.id, ...d.data() }])); parts = new Map(b.docs.map(d => [d.id, d.data()]));
      rebuild();
    } catch (e) { console.error(e); shared = null; db = local; note("Couldn't reach your Claude account's storage, so this visit is saved in this browser only."); return; }
    // Bring across anything this browser saved before the preview used shared storage.
    let moved = false; try { moved = !!localStorage.getItem(MOVED); } catch {}
    const missing = moved ? [] : Object.keys(local).filter(k => !(k in db));
    for (const k of missing) { db[k] = local[k]; writeShared(k, local[k]); }
    if (!moved) Promise.all(missing.map(k => writes.get(k))).then(() => { try { localStorage.setItem(MOVED, new Date().toISOString()); } catch {} });
    note(missing.length ? "Saved to your Claude account. This browser's earlier preview data has been copied across." : "Saved to your Claude account, so it's the same in any browser where you're signed in to Claude.");
    const watch = (name, set) => shared.collection(name).onSnapshot(snap => { set(new Map(snap.docs.map(d => [d.id, name === "kv" ? { id: d.id, ...d.data() } : d.data()]))); rebuild(); }, e => console.error(e));
    watch("kv", m => mains = m); watch("kvparts", m => parts = m);
  })();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const store = {
    get: async k => { await ready; return k in db ? JSON.parse(JSON.stringify(db[k])) : null; },
    set: async (k, v) => { await ready; db[k] = JSON.parse(JSON.stringify(v)); if (shared) await writeShared(k, db[k]); else persist(); },
    del: async k => { await ready; delete db[k]; if (shared) await deleteShared(k); else persist(); },
    list: async prefix => { await ready; return Object.keys(db).filter(k => k.startsWith(prefix)); },
  };
  const handle = createApi({ store, webcrypto: window.crypto, env: { SESSION_SECRET: "preview-only-secret", SUPERADMIN_EMAIL: "owner@skittlers.test" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, "https://preview.skittlers.co.uk");
    if (!u.pathname.startsWith("/api/")) return realFetch(url, opts);
    return handle(new Request("https://preview.skittlers.co.uk" + u.pathname + u.search, { method: opts.method || "GET", headers: opts.headers, body: opts.body }));
  };
  const PATH = "skittlers-preview-path";
  window.SKITTLERS_HOST = "skittlers.co.uk";
  window.SKITTLERS_NAV = {
    path: () => { try { return sessionStorage.getItem(PATH) || "/"; } catch { return "/"; } },
    go: (path, hash) => {
      try { sessionStorage.setItem(PATH, path); } catch {}
      try { history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search); } catch { location.hash = hash || ""; }
      window.scrollTo(0, 0);
      window.SKITTLERS_BOOT();
    },
  };
})();
</script>
`;
const i = html.indexOf("<script>\nconst $");
if (i < 0) throw new Error("Couldn't find the main script in public/index.html");
html = html.slice(0, i) + previewApi + html.slice(i);

await writeFile(out, html);
console.log("Preview written to " + out);
