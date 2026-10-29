import http from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("..", import.meta.url).pathname;
const fn = await import(root + "/netlify/functions/api.mjs");
process.env.ADMIN_PASSWORD ||= "test-pass-123"; process.env.SESSION_SECRET ||= "local-secret";
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await fn.default(r);
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(await out.text()); return;
  }
  res.writeHead(200, { "content-type": "text/html" }); res.end(await readFile(root + "/public/index.html"));
}).listen(8899, () => console.log("Preview at http://localhost:8899 (admin password: " + process.env.ADMIN_PASSWORD + ")"));
