// Local preview: serves public/ and runs the Netlify Function with an in-memory store.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pub = root + "public";
const fn = await import(root + "netlify/functions/api.mjs");
process.env.ADMIN_PASSWORD ||= "test-pass-123"; process.env.SESSION_SECRET ||= "local-secret";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await fn.default(r);
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(await out.text()); return;
  }
  const file = normalize(pub + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(8899, () => console.log("Preview at http://localhost:8899 (admin password: " + process.env.ADMIN_PASSWORD + ")"));
