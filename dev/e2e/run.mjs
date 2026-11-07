// Browser tests: runs the site locally (its own server on PORT, 8977 by default, with a fresh in-memory store and
// made-up photo readings) and drives it in Chromium through every test in dev/e2e/*.test.mjs.
//   npm run e2e                 all of them
//   npm run e2e -- cups demo    only the files whose names include "cups" or "demo"
// Needs Playwright: npm install --no-save playwright && npx playwright install chromium (once).
// A failed step saves a screenshot in .e2e-output/.
import { spawn } from "node:child_process";
import { readdir, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", "..");
const PORT = +process.env.E2E_PORT || 8977, base = `http://localhost:${PORT}`, out = join(root, ".e2e-output");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { console.error("Playwright isn't installed. Run: npm install --no-save playwright && npx playwright install chromium"); process.exit(1); }

const only = process.argv.slice(2);
const files = (await readdir(here)).filter(f => f.endsWith(".test.mjs") && (!only.length || only.some(o => f.includes(o)))).sort();
await mkdir(out, { recursive: true });

// The site, as `npm run preview` runs it, on its own port.
const server = spawn(process.execPath, ["--import", "./dev/register.mjs", "dev/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT), BOARD_FAKE: "1" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, fail) => { server.stdout.on("data", d => String(d).includes("Preview at") && ok()); server.on("exit", c => fail(new Error(`The server stopped (${c})`))); setTimeout(() => fail(new Error("The server didn't start")), 15000); });

const browser = await chromium.launch();
let failed = 0, passed = 0;
for (const file of files) {
  console.log(`\n${file}`);
  const { default: test } = await import(join(here, file));
  const pages = [];
  // Each page aborts outside requests (fonts, maps) and records any error the page throws.
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    await ctx.route(/fonts\.googleapis|fonts\.gstatic|openstreetmap|postcodes\.io|cdnjs/, r => r.abort());
    const page = await ctx.newPage(); page.errors = [];
    page.on("pageerror", e => page.errors.push(e.message));
    pages.push(page); return page;
  };
  let current = "";
  const step = async (name, fn) => {
    current = name;
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) {
      failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split("\n")[0]}`);
      const shot = join(out, `${file.replace(".test.mjs", "")}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png`);
      await pages.at(-1)?.screenshot({ path: shot, fullPage: true }).catch(() => {}); console.log(`      screenshot: ${shot}`);
      throw e;
    }
  };
  try { await test({ base, newPage, step }); }
  catch (e) { if (!current) { failed++; console.log(`  ✗ ${e.message}`); } }
  // Any error a page threw counts as a failure, even when the steps passed.
  for (const p of pages) if (p.errors.length) { failed++; console.log(`  ✗ page errors: ${p.errors.join(" | ")}`); }
  for (const p of pages) await p.context().close().catch(() => {});
}
await browser.close(); server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
