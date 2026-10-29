// Builds a self-contained preview of public/index.html that runs without Netlify:
// the real API runs in the page, and data is kept in the viewer's browser.
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
  <div class="wrap" style="padding-block:8px"><strong>Preview.</strong> Everything here is saved in your browser only and doesn't touch the live site. Sign up with any email to try it as a league secretary. Sign up as <code>owner@skittlers.test</code> to see the overall admin pages. Postcode lookups and maps only work on the live site.</div>
</div>
`;
html = html.replace('<header class="band">', banner + '<header class="band">');

// The preview runs the real API (lib/core.mjs) in the page, storing data in the browser,
// and swaps page addresses for an in-memory one because an artifact can't change its address.
const core = (await readFile(new URL("../lib/core.mjs", import.meta.url), "utf8")).replace(/^export /gm, "");
const previewApi = `<script>
(() => {
${core}
  const KEY = "skittlers-preview-db";
  let db = {};
  try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const store = {
    get: async k => k in db ? JSON.parse(JSON.stringify(db[k])) : null,
    set: async (k, v) => { db[k] = JSON.parse(JSON.stringify(v)); persist(); },
    del: async k => { delete db[k]; persist(); },
    list: async prefix => Object.keys(db).filter(k => k.startsWith(prefix)),
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
