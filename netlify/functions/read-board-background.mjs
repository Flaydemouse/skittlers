// Background function (the "-background" name gives it up to 15 minutes): reads one scoreboard photo with Claude
// and stores the result for the page to collect. Only the API can start it, with a signed job key.
import { boardRunner } from "../../lib/netlify-store.mjs";

export default async req => {
  const { key } = await req.json().catch(() => ({}));
  if (!boardRunner || !await boardRunner.verify(key, req.headers.get("x-board-sig"))) return new Response("", { status: 403 });
  await boardRunner.run(key);
  return new Response("", { status: 200 });
};
