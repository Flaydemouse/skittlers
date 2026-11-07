// The demo site: every public page, scorecards, trying colours and fonts, a renamed team, and closing it.
import { go, text, expect, fitsWidth } from "./helpers.mjs";

export default async function ({ base, newPage, step }) {
  const page = await newPage();
  await step("the front page links to the demo", async () => {
    await page.goto(base + "/#welcome"); await page.click(".lp-demo"); await page.waitForSelector("#demo-bar:not([hidden])");
    expect((await text(page, "#league-name")).includes("Westcombe"), "the demo league opens");
  });
  await step("public pages, with nothing to manage", async () => {
    for (const [hash, sel] of [["tables", ".league tbody tr"], ["fixtures", ".fx, .nf-list li"], ["cup", "[data-cup-jump]"], ["stats", "#main table"], ["league-teams", "#pt-list"], ["past", "[data-past]"]]) {
      await go(page, hash); await page.waitForSelector(sel);
    }
    expect(!(await page.$(".admin-row")), "no admin tabs"); expect((await text(page, "#acct")).includes("free trial"), "the header offers the free trial");
  });
  await step("results open on a finished season, with scorecards", async () => {
    await go(page, "fixtures"); await page.waitForSelector('[data-show="results"][aria-pressed="true"]');
  });
  await step("an old team name links to the team it became", async () => {
    await go(page, "past"); await page.click('[data-past="s2425"]');
    const old = page.locator(".past-strip .tn-link", { hasText: "Bell Boys" }).first(); await old.waitFor();
    expect((await old.getAttribute("title")).includes("now Ding Dongs"), "says what it's called now");
    await old.click(); await page.waitForFunction(() => location.hash.startsWith("#team/"));
    await page.waitForFunction(() => /as Bell Boys/.test(document.querySelector("#main").innerText));
  });
  await step("the roll of honour", async () => {
    await go(page, "past"); await page.click('[data-past="honours"]'); await page.waitForSelector(".roh-table");
    await page.click('[data-roh-cup="knockoutcup"]'); await page.waitForFunction(() => /Old Market Rollers/.test(document.querySelector("#past-body").innerText));
  });
  await step("try colours and fonts, then put them back", async () => {
    await page.click('[data-demo="look"]'); await page.selectOption('[data-look="theme"]', "navy"); await page.selectOption('[data-look="font"]', "modern");
    expect((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-body"))).includes("Inter"), "the font changes");
    await page.click('[data-demo="reset"]');
    expect(!(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-body"))).includes("Inter"), "and goes back");
  });
  await step("× goes back to the front page", async () => {
    await page.click(".demo-x"); await page.waitForSelector(".lp-cta"); expect(await page.isHidden("#demo-bar"), "the bar has gone");
  });
  await step("the demo fits a phone", async () => {
    const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const hash of ["home", "tables", "cup", "stats"]) { await phone.goto(`${base}/demo#${hash}`); await phone.waitForTimeout(900); expect(await fitsWidth(phone), `${hash} is wider than a phone`); }
  });
}
