// Netlify entry point for the API in lib/core.mjs, storing data in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { webcrypto } from "node:crypto";
import { createApi } from "../../lib/core.mjs";

const blobs = () => getStore({ name: "skittlers", consistency: "strong" });

const store = {
  get: key => blobs().get(key, { type: "json" }),
  set: (key, value) => blobs().setJSON(key, value),
  del: key => blobs().delete(key),
  list: async prefix => (await blobs().list({ prefix })).blobs.map(b => b.key),
};

// Data from the original single-league version of the site, kept so it can be copied into a league.
async function legacy() {
  const old = getStore({ name: "skittles-league", consistency: "strong" });
  const league = await old.get("league", { type: "json" });
  return league && Object.keys(league.teams || {}).length ? { league, contacts: await old.get("contacts", { type: "json" }) || {} } : null;
}

const handle = createApi({
  store, webcrypto, legacy,
  env: { SESSION_SECRET: process.env.SESSION_SECRET, SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL },
});

export default req => handle(req);

export const config = { path: "/api/*" };
