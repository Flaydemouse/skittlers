// Checks every colour scheme on League setup is readable in light and dark mode: each text colour against
// everything it's drawn on reaches WCAG AA (4.5 to 1), and the header, highlight and page colours stay distinct.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const src = html.slice(html.indexOf("/* THEMES-START */"), html.indexOf("/* THEMES-END */"));
const { THEMES, BACKGROUNDS, themeTokens, contrast, themeCss } = new Function(`${src}; return { THEMES, BACKGROUNDS, themeTokens, contrast, themeCss };`)();

// [text, backgrounds it appears on]
const PAIRS = [
  ["ink", ["paper", "surface", "sunk", "warn-bg"]], ["muted", ["paper", "surface", "sunk"]], ["brass-ink", ["paper", "surface", "sunk", "warn-bg"]],
  ["on-baize", ["baize", "baize-2"]], ["on-baize-muted", ["baize", "baize-2"]], ["on-brass", ["brass"]],
  ["win", ["paper", "surface", "sunk"]], ["loss", ["paper", "surface", "sunk"]], ["draw", ["paper", "surface", "sunk"]], ["nick", ["paper", "surface", "sunk"]],
  ["paper", ["ink"]], ["surface", ["loss"]],
];
assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length, "scheme ids are unique");
let worst = Infinity;
// Every scheme with every page background.
for (const t of THEMES) for (const bg of BACKGROUNDS) for (const mode of ["light", "dark"]) {
  const k = themeTokens(t, mode, bg.id), name = `${t.name} on ${bg.name}`;
  for (const [fg, bgs] of PAIRS) for (const bg of bgs) {
    const c = contrast(k[fg], k[bg]); worst = Math.min(worst, c);
    assert.ok(c >= 4.5, `${name} (${mode}): ${fg} ${k[fg]} on ${bg} ${k[bg]} is only ${c.toFixed(2)} to 1`);
  }
  // The header and the page must look different, and the highlight must stand out from the page.
  // In dark mode the header is dark too, as on the default scheme, so it only needs to be a visibly different shade.
  assert.ok(contrast(k.baize, k.paper) >= (mode === "light" ? 3 : 1.2), `${name} (${mode}): header too close to the page`);
  assert.ok(contrast(k.brass, k[mode === "light" ? "surface" : "paper"]) >= 1.8, `${name} (${mode}): highlight doesn't stand out`);
  if (t.id !== "baize" || bg.bg) assert.match(themeCss(t.id, bg.id), /--paper: #[0-9A-F]{6};/);
  if (mode === "light" && bg.bg) assert.equal(k.paper, bg.bg, "the chosen background is the page");
}
assert.equal(themeCss("baize"), "", "the default scheme uses the page's own colours");
assert.equal(themeCss("nope"), "");
assert.equal(new Set(BACKGROUNDS.map(b => b.id)).size, BACKGROUNDS.length, "background ids are unique");
console.log(`all ${THEMES.length} colour schemes on ${BACKGROUNDS.length} backgrounds readable in light and dark (lowest contrast ${worst.toFixed(2)} to 1)`);
