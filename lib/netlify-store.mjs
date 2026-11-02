// The site's storage on Netlify Blobs, shared by the API and the photo-reading function.
import { getStore } from "@netlify/blobs";
import { webcrypto } from "node:crypto";
import { createBoardRunner } from "./core.mjs";
import { claudeReader } from "./claude-reader.mjs";

const blobs = () => getStore({ name: "skittlers", consistency: "strong" });

export const store = {
  get: key => blobs().get(key, { type: "json" }),
  set: (key, value) => blobs().setJSON(key, value),
  del: key => blobs().delete(key),
  list: async prefix => (await blobs().list({ prefix })).blobs.map(b => b.key),
};

export const env = { SESSION_SECRET: process.env.SESSION_SECRET, SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL };

// Photo reading is switched on once ANTHROPIC_API_KEY is set; without it the add-on shows as not available.
const read = claudeReader();
export const boardRunner = read && env.SESSION_SECRET ? createBoardRunner({ store, webcrypto, env, read }) : null;
export { webcrypto };
