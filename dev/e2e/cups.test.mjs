// A knockout cup drawn by hand, with semi-finals at a neutral venue and the final at a set alley, played through to
// the final; then the public Cups page as a chart and as a list.
import { newLeague, loadExample, go, text, toast, expect } from "./helpers.mjs";

export default async function ({ base, newPage, step }) {
  const page = await newPage();
  const resultsFor = async round => {
    const rows = () => page.locator(`.cup-round[data-round="${round}"] .cup-match`);
    const n = await rows().count();
    for (let i = 0; i < n; i++) {
      const r = rows().nth(i);
      await r.locator('[data-pins="a"]').fill(String(300 + i)); await r.locator('[data-pins="b"]').fill("250");
      await r.locator('[data-act="cup-save-match"]').click(); await toast(page, "Result saved");
    }
  };
  await step("a league with the example teams", async () => { await newLeague(page, base); await loadExample(page); });
  await step("create a cup drawn by hand, neutral semis, final at a set alley", async () => {
    await go(page, "cups"); await page.waitForSelector("#cup-form");
    await page.fill("#c-name", "Hand Cup"); await page.fill("#c-entries", "6");
    await page.check("[name=c-drawmode][value=manual]"); await page.check("[name=c-semi][value=neutral]"); await page.check("[name=c-final][value=set]");
    await page.selectOption("#c-fvenue", { index: 0 }); await page.click("#c-go"); await toast(page, "created");
  });
  await step("choose six entries and set the first round by hand", async () => {
    const boxes = page.locator("#ce-list input[data-entrant]");
    for (let i = 0; i < 6; i++) await boxes.nth(i).check();
    await page.waitForSelector("#draw-box .pairs-form");
    expect((await page.locator("#draw-box .pair-row.bye").count()) === 2, "two byes in the first round");
    await page.click('#draw-box [data-act="cup-pairs-save"]'); await toast(page, "Fill in every place");
    await page.click('#draw-box [data-act="cup-pairs-random"]'); await page.click('#draw-box [data-act="cup-pairs-save"]'); await toast(page, "draw has been saved");
  });
  await step("first round results, then the semi-final draw by hand", async () => {
    await resultsFor(1);
    await page.waitForSelector('.cup-round[data-round="2"] .pairs-form');
    await page.click('.cup-round[data-round="2"] [data-act="cup-pairs-random"]'); await page.click('.cup-round[data-round="2"] [data-act="cup-pairs-save"]');
    await toast(page, "Semi-finals draw saved");
    expect((await page.textContent('.cup-round[data-round="2"] select[data-venue] option')).includes("Neutral"), "semi-finals at a neutral venue");
  });
  await step("semi-final results; the final pairs itself at the set alley", async () => {
    await resultsFor(2);
    await page.waitForSelector('.cup-round[data-round="3"] .cup-match');
    expect((await page.textContent('.cup-round[data-round="3"] select[data-venue] option')).startsWith("Finals venue"), "the final at the set alley");
  });
  await step("public Cups page: chart, then list, remembered", async () => {
    await go(page, "cup"); await page.click('[data-cup-jump]:has-text("Hand Cup")'); await page.waitForSelector(".bracket");
    expect((await text(page, ".bracket")).includes("Neutral venue to be confirmed"), "neutral semis shown");
    await page.click('[data-cup-view="list"]'); await page.waitForSelector(".cup-list .fx");
    await page.reload(); await page.waitForSelector("[data-cup-jump]"); await page.click('[data-cup-jump]:has-text("Hand Cup")');
    await page.waitForSelector(".cup-list"); await page.click('[data-cup-view="chart"]'); await page.waitForSelector(".bracket");
  });
}
