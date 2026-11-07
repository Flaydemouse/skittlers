// Things most browser tests do: sign up, set up a league, wait for a message, check a value.
export const toast = (page, text, timeout = 10000) => page.waitForSelector(`#toast:has-text(${JSON.stringify(text)})`, { timeout });
export function expect(ok, message) { if (!ok) throw new Error(message); }
export const text = async (page, sel) => (await page.innerText(sel)).replace(/\s+/g, " ").trim();
export const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
let n = 0;
export const unique = prefix => `${prefix}${Date.now() % 100000}${++n}`;

// A new account with a new league and its first season. The Super Admin (owner@skittlers.test) has every extra.
export async function newLeague(page, base, { name = unique("Test League "), email = unique("sec") + "@example.com", superAdmin = false } = {}) {
  email = superAdmin ? "owner@skittlers.test" : email;
  await page.goto(base + "/#signup");
  await page.fill("#a-name", "Sam"); await page.fill("#a-email", email); await page.fill("#a-pass", "skittles123"); await page.click("#auth-go");
  await page.waitForTimeout(700);
  if (await page.$("#auth-go")) { // already signed up (the Super Admin, in a later test): log in instead
    await page.goto(base + "/#login"); await page.fill("#a-email", email); await page.fill("#a-pass", "skittles123"); await page.click("#auth-go");
    await page.waitForTimeout(800); await go(page, "leagues");
  }
  await page.waitForSelector("#lg-name"); await page.fill("#lg-name", name);
  await page.waitForFunction(() => /Available/.test(document.querySelector("#lg-slug-note")?.textContent || ""));
  await page.click("#lg-go");
  await page.waitForSelector("#ss-form"); await page.click("#ss-save"); await toast(page, "added");
  return { name, email };
}
export async function loadExample(page) {
  await go(page, "teams"); await page.click('[data-act="load-example"]'); await page.waitForSelector("#team-list .card"); await toast(page, "Example season loaded");
}
// The page is no wider than the screen (nothing to scroll sideways).
export const fitsWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
