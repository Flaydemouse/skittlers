// A league from sign-up to its public pages: the example season, then every public tab on a computer and a phone.
import { newLeague, loadExample, go, text, expect, fitsWidth } from "./helpers.mjs";

export default async function ({ base, newPage, step }) {
  const page = await newPage();
  await step("sign up, create a league and its first season", () => newLeague(page, base));
  await step("load the example season", () => loadExample(page));
  await step("league tables show each team and can step back a night", async () => {
    await go(page, "tables"); await page.waitForSelector(".league tbody tr");
    expect((await page.locator(".league tbody tr").count()) >= 6, "a table row for each team");
    const back = page.locator('[data-tt="back"]').first();
    if (await back.count() && !(await back.isDisabled())) { await back.click(); await page.waitForSelector(".tt-when:not(.tt-now)"); }
  });
  await step("fixtures show results with scorecards", async () => {
    await go(page, "fixtures"); await page.click('[data-show="results"]');
    await page.waitForSelector(".fx-list .fx, .nf-list li");
  });
  await step("stats, teams, venues and cups pages open", async () => {
    for (const [hash, sel] of [["stats", "#main table"], ["league-teams", "#pt-list"], ["venues", "#main"], ["cup", "#cup-body"]]) {
      await go(page, hash); await page.waitForSelector(sel);
    }
    await go(page, "league-teams"); await page.click("#pt-list .tn >> nth=0"); await page.waitForTimeout(300);
  });
  await step("a team name links to its team page", async () => {
    await go(page, "tables"); await page.waitForSelector(".league .tn-link");
    const name = (await page.textContent(".league .tn-link >> nth=0")).trim();
    await page.click(".league .tn-link >> nth=0"); await page.waitForFunction(() => location.hash.startsWith("#team/"));
    // Just that team, open (its season-by-season record shows once a league has more than one season).
    await page.waitForSelector("#pt-list .card"); expect((await page.locator("#pt-list .card").count()) === 1, "only that team");
    expect((await text(page, "#pt-list")).includes(name) && (await text(page, "#pt-list")).includes("Captain"), "the team is open");
  });
  await step("every public page fits a phone screen", async () => {
    const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const url = page.url().split("#")[0];
    for (const hash of ["home", "tables", "fixtures", "cup", "stats", "league-teams"]) {
      await phone.goto(`${url}#${hash}`); await phone.waitForTimeout(700);
      expect(await fitsWidth(phone), `${hash} is wider than a phone`);
    }
  });
}
