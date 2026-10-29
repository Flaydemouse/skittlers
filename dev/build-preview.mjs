// Builds a self-contained preview of public/index.html that runs without Netlify:
// the /api/* calls are answered in the page, and data is kept in the viewer's browser.
// Usage: node dev/build-preview.mjs <output.html>
import { readFile, writeFile } from "node:fs/promises";

const out = process.argv[2];
if (!out) { console.error("Usage: node dev/build-preview.mjs <output.html>"); process.exit(1); }

let html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

// The preview host supplies its own document skeleton.
for (const tag of [/<!doctype html>\n/i, /<html[^>]*>\n/, /<head>\n/, /<meta charset[^>]*>\n/, /<meta name="viewport"[^>]*>\n/, /<\/head>\n/, /<body>\n/, /<\/body>\n/, /<\/html>\n?/])
  html = html.replace(tag, "");
html = html.replace(/<title>[^<]*<\/title>/, `<title>Skittles League Preview</title>\n<meta name="claude:viewport-fit-sides" content="cover">`);

const banner = `<div style="background:var(--warn-bg);color:var(--ink);font-size:.9rem">
  <div class="wrap" style="padding-block:8px"><strong>Preview.</strong> Changes here are saved in your browser only and don't touch the live site. Admin password: <code>preview</code></div>
</div>
`;
html = html.replace('<header class="band">', banner + '<header class="band">');

const mockApi = `<script>
// Preview only: answers the site's API calls in the page.
(() => {
  const KEY = "skittles-preview-data";
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!db) db = { league: { version: 0, teams: {}, venues: {}, fixtures: {}, settings: {} }, contacts: {} };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const path = new URL(url, location.href).pathname;
    if (!path.startsWith("/api/")) return realFetch(url, opts);
    const method = (opts.method || "GET").toUpperCase();
    const authed = (opts.headers || {}).authorization === "Bearer preview-token";
    if (path === "/api/league") return reply(db.league);
    if (path === "/api/login") {
      const { password } = JSON.parse(opts.body || "{}");
      return password === "preview" ? reply({ token: "preview-token" }) : reply({ error: "That password isn't right. In the preview it's: preview" }, 401);
    }
    if (path === "/api/admin") {
      if (!authed) return reply({ error: "Your admin session has ended. Log in again." }, 401);
      if (method === "GET") return reply({ ...db.league, contacts: db.contacts });
      const body = JSON.parse(opts.body);
      if (body.version !== db.league.version) return reply({ error: "conflict", ...db.league, contacts: db.contacts }, 409);
      db.league = { ...body.league, version: db.league.version + 1, updatedAt: new Date().toISOString() };
      db.contacts = body.contacts;
      persist();
      return reply({ ...db.league, contacts: db.contacts });
    }
    return reply({ error: "Not found" }, 404);
  };
})();
</script>
`;
const i = html.indexOf("<script>\nconst $");
if (i < 0) throw new Error("Couldn't find the main script in public/index.html");
html = html.slice(0, i) + mockApi + html.slice(i);

await writeFile(out, html);
console.log("Preview written to " + out);
