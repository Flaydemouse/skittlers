// Checks every colour scheme on League setup is readable in light and dark mode: each text colour against
// everything it's drawn on reaches WCAG AA (4.5 to 1), and the header, highlight and page colours stay distinct.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const src = html.slice(html.indexOf("/* THEMES-START */"), html.indexOf("/* THEMES-END */"));
const { THEMES, themeTokens, contrast, themeCss } = new Function(`${src}; return { THEMES, themeTokens, contrast, themeCss };`)();

// [text, backgrounds it appears on]
const PAIRS = [
  ["ink", ["paper", "surface", "sunk", "warn-bg"]], ["muted", ["paper", "surface", "sunk"]], ["brass-ink", ["paper", "surface", "sunk", "warn-bg"]],
  ["on-baize", ["baize", "baize-2"]], ["on-baize-muted", ["baize", "baize-2"]], ["on-brass", ["brass"]],
  ["win", ["paper", "surface", "sunk"]], ["loss", ["paper", "surface", "sunk"]], ["draw", ["paper", "surface", "sunk"]], ["nick", ["paper", "surface", "sunk"]],
  ["paper", ["ink"]], ["surface", ["loss"]],
];
assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length, "scheme ids are unique");
let worst = Infinity;
for (const t of THEMES) for (const mode of ["light", "dark"]) {
  const k = themeTokens(t, mode);
  for (const [fg, bgs] of PAIRS) for (const bg of bgs) {
    const c = contrast(k[fg], k[bg]); worst = Math.min(worst, c);
    assert.ok(c >= 4.5, `${t.name} (${mode}): ${fg} ${k[fg]} on ${bg} ${k[bg]} is only ${c.toFixed(2)} to 1`);
  }
  // The header and the page must look different, and the highlight must stand out from the page.
  // In dark mode the header is dark too, as on the default scheme, so it only needs to be a visibly different shade.
  assert.ok(contrast(k.baize, k.paper) >= (mode === "light" ? 3 : 1.2), `${t.name} (${mode}): header too close to the page`);
  assert.ok(contrast(k.brass, k[mode === "light" ? "surface" : "paper"]) >= 1.8, `${t.name} (${mode}): highlight doesn't stand out`);
  if (t.id !== "baize") assert.match(themeCss(t.id), /--paper: #[0-9A-F]{6};/);
}
assert.equal(themeCss("baize"), "", "the default scheme uses the page's own colours");
assert.equal(themeCss("nope"), "");
console.log(`all ${THEMES.length} colour schemes readable in light and dark (lowest contrast ${worst.toFixed(2)} to 1)`);
