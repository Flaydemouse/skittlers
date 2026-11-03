// Local preview: serves public/ and runs the Netlify Function with an in-memory store.
// The overall admin is whoever signs up as owner@skittlers.test (or SUPERADMIN_EMAIL).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pub = root + "public";
process.env.SESSION_SECRET ||= "local-secret";
process.env.SUPERADMIN_EMAIL ||= "owner@skittlers.test";
const fn = await import(root + "netlify/functions/api.mjs");
// Photo reading runs in a background function on Netlify; here it's started the same way and answers 202 straight away.
// Set ANTHROPIC_API_KEY to read real photos, or BOARD_FAKE=1 for a made-up reading.
const boardFn = await import(root + "netlify/functions/read-board-background.mjs");
const shareFn = await import(root + "netlify/functions/share.mjs");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".csv": "text/csv" };

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/.netlify/functions/read-board-background" && req.method === "POST") {
    const chunks = []; for await (const c of req) chunks.push(c);
    boardFn.default(new Request("http://localhost:8899" + req.url, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) })).catch(e => console.error(e));
    res.writeHead(202); res.end(); return;
  }
  const share = /^\/([^/]+)\/news\/([^/]+)$/.exec(path);
  if (share && !path.startsWith("/api/")) {
    const out = await shareFn.default(new Request("http://localhost:8899" + req.url), { params: { slug: decodeURIComponent(share[1]), id: decodeURIComponent(share[2]) } });
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(await out.text()); return;
  }
  if (path.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request("http://localhost:8899" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await fn.default(r);
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer())); return;
  }
  const file = normalize(pub + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(body);
  } catch {
    // Like Netlify's redirect rule: any other address (a league's page) gets the app.
    res.writeHead(200, { "content-type": "text/html" }); res.end(await readFile(pub + "/index.html"));
  }
}).listen(8899, () => console.log(`Preview at http://localhost:8899 (overall admin: sign up as ${process.env.SUPERADMIN_EMAIL})`));
