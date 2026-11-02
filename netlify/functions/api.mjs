// Netlify entry point for the API in lib/core.mjs, storing data in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { createApi } from "../../lib/core.mjs";
import { store, env, webcrypto, boardRunner } from "../../lib/netlify-store.mjs";

// Data from the original single-league version of the site, kept so it can be copied into a league.
async function legacy() {
  const old = getStore({ name: "skittles-league", consistency: "strong" });
  const league = await old.get("league", { type: "json" });
  return league && Object.keys(league.teams || {}).length ? { league, contacts: await old.get("contacts", { type: "json" }) || {} } : null;
}

// Reading a board photo can take a minute, longer than a normal request may run, so it's handed to a
// background function. The request is signed so only this API can start one.
async function startBoardJob(key, req) {
  const r = await fetch(new URL("/.netlify/functions/read-board-background", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-board-sig": await boardRunner.sign(key) },
    body: JSON.stringify({ key }),
  });
  if (!r.ok) throw new Error(`Background function answered ${r.status}`);
}

const handle = createApi({ store, webcrypto, legacy, env, startBoardJob: boardRunner ? startBoardJob : null });

export default req => handle(req);

export const config = { path: "/api/*" };
