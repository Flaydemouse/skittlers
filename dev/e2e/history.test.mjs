// Teams over the years: a team renamed in a new season keeps its old name in the old season, linked to the team it
// became; a roll of honour brought in from a file keeps the names as written and links them; and the secretary can
// link, join and separate teams afterwards.
import { newLeague, loadExample, go, text, toast, expect } from "./helpers.mjs";
import { fileURLToPath } from "node:url";

const ROLL = fileURLToPath(new URL("./fixtures/Hall_of_Fame_-_Captains_Cups.csv", import.meta.url));
const SEASON = fileURLToPath(new URL("./fixtures/season-2019-20.csv", import.meta.url));

export default async function ({ base, newPage, step }) {
  const page = await newPage();
  let oldSeason;
  await step("the Super Admin's league with the example season", async () => { await newLeague(page, base, { superAdmin: true }); await loadExample(page); });
  await step("a new season brings across the teams and cups", async () => {
    await go(page, "seasons"); await page.waitForSelector("#ss-form");
    oldSeason = await page.evaluate(() => S.seasonId);
    await page.fill("#ss-start", "2031-09-01"); await page.fill("#ss-end", "2032-04-30");
    expect(await page.isChecked("#ss-c-cups"), "cups are brought across by default");
    await page.click("#ss-save"); await toast(page, "You're now working on it");
  });
  await step("rename a team in the new season", async () => {
    await go(page, "teams"); await page.waitForSelector("#team-list .card");
    await page.locator("#team-list .card", { hasText: "Lion Hearts (example)" }).locator('[data-act="edit-team"]').click();
    await page.fill("#t-name", "Lionhearts"); await page.click("#tf-save"); await toast(page, "Saved Lionhearts");
    expect((await page.evaluate(() => Object.values(S.league.clubs).find(c => c.name === "Lionhearts")?.was || [])).includes("Lion Hearts (example)"), "the old name is kept");
  });
  await step("the old season keeps the old name, linked to the team it became", async () => {
    await go(page, "past"); await page.click(`[data-past="${oldSeason}"]`);
    const old = page.locator(".past-strip .tn-link", { hasText: "Lion Hearts (example)" }).first(); await old.waitFor();
    expect((await old.getAttribute("title")).includes("now Lionhearts"), "it says what the team is called now");
    await old.click(); await page.waitForFunction(() => /as Lion Hearts \(example\)/.test(document.querySelector("#main").innerText));
    expect((await text(page, "#main")).includes("Previously Lion Hearts (example)"), "the team page lists its old name");
  });
  await step("import a past season; Check names links an old name and joins a misspelling", async () => {
    await go(page, "seasons"); await page.waitForSelector("#ri-file");
    await page.setInputFiles("#ri-file", SEASON); await page.waitForFunction(() => !document.querySelector("#ri-go").disabled);
    await page.click("#ri-go"); await page.click("#ri-go"); await page.waitForSelector("#nc-panel:not([hidden]) [data-nc-team]", { timeout: 15000 });
    const pick = async (name, value) => page.locator("[data-nc-team]", { hasText: name }).locator("select").selectOption(value);
    await pick("The Lions", "old:Lionhearts"); await pick("Ancor Men", "same:Anchor Men (example)");
    await page.click('[data-act="nc-save"]'); await toast(page, "Names saved");
    const lion = await page.evaluate(() => Object.values(S.league.clubs).find(c => c.name === "Lionhearts").was);
    expect(lion.includes("The Lions"), "The Lions is an old name of Lionhearts");
    await go(page, "past"); const s19 = await page.evaluate(() => S.league.seasons.find(x => x.name.startsWith("2019")).id);
    await page.click(`[data-past="${s19}"]`); await page.waitForSelector(".past-strip .tn-link");
    const t = await text(page, ".past-strip");
    expect(t.includes("The Lions") && !t.includes("Lionhearts"), "the season keeps the name the team had"); expect(t.includes("Anchor Men (example)") && !t.includes("Ancor Men"), "the misspelling is corrected");
  });
  await step("bring in a roll of honour: names kept as written, matched names linked", async () => {
    await go(page, "seasons"); await page.waitForSelector("#roh-panel h3");
    await page.setInputFiles("#roh-file", ROLL); await page.waitForSelector('[data-roh="import"]');
    expect((await page.inputValue("#roh-cup")) === "Captains Cup", "the cup's name comes from the file's name");
    const match = name => page.locator(".roh-m", { has: page.locator(".roh-m-name", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) }).locator("select");
    expect((await match("Crown Jewls (example)").inputValue()) === "Crown Jewels (example)", "a misspelling is matched to the closest team");
    expect((await match("Old Codger").inputValue()) === "Old Codgers", "a name spelt differently later in the file is matched to it");
    expect((await match("Old Codgers").inputValue()) === "", "an old team that isn't in the league is kept as written");
    await page.click('[data-roh="import"]'); await toast(page, "4 seasons of the Captains Cup brought in");
  });
  await step("the roll shows the names as written, linking to today's teams", async () => {
    await go(page, "past"); await page.click('[data-past="honours"]'); await page.waitForSelector(".roh-table");
    const t = await text(page, ".roh-table");
    for (const n of ["Crown Jewls (example)", "Lion Hearts (example)", "Old Codger", "No competition (Covid)", "Joint runner-up"]) expect(t.includes(n), `${n} is in the roll`);
    const typo = page.locator(".roh-table .tn-link", { hasText: "Crown Jewls (example)" }).first(); await typo.waitFor();
    expect((await typo.getAttribute("title")).includes("now Crown Jewels (example)"), "the misspelling links to the team");
    await page.locator(".roh-table .tn-link", { hasText: "Lion Hearts (example)" }).first().click();
    await page.waitForFunction(() => /Captains Cup \(Dave Carter\)/.test(document.querySelector("#main").innerText));
  });
  await step("link an old team in the roll to a team later", async () => {
    await go(page, "seasons"); await page.waitForSelector("#roh-lname");
    await page.selectOption("#roh-lname", "Old Codgers"); await page.fill("#roh-lto", "Anchor Men (example)"); await page.click('[data-roh="link"]');
    await toast(page, "Old Codgers is linked to Anchor Men (example)");
    expect((await text(page, ".roh-admin")).includes("Old Codgers (now Anchor Men (example))"), "the roll's list says who it is now");
  });
  await step("Teams over the years: separate a name, and join two teams", async () => {
    await page.waitForSelector("#clubs-panel .cl-list");
    expect((await text(page, "#clubs-panel")).includes("Lionhearts played as Lion Hearts (example)"), "the renamed team is listed");
    const sep = page.locator('#clubs-panel [data-cl="unlink"][data-name="Crown Jewls (example)"]');
    await sep.click(); await sep.click(); await toast(page, "Crown Jewls (example) is a team of its own again");
    expect(!(await text(page, "#clubs-panel .cl-list")).includes("Crown Jewls"), "no longer linked");
    const clubs = await page.evaluate(() => S.league.clubs), id = n => Object.values(clubs).find(c => c.name === n).id;
    await page.selectOption("#cl-from", id("Crown Jewls (example)")); await page.selectOption("#cl-into", id("Crown Jewels (example)"));
    const join = page.locator('[data-cl="merge"]'); await join.click(); await join.click(); await toast(page, "Teams joined");
    expect((await text(page, "#clubs-panel")).includes("Crown Jewels (example) played as Crown Jewls (example)"), "joined again");
  });
}
