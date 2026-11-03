// /<league>/news/<post>: the app, with the post's preview details for Facebook, WhatsApp and X.
import { newsSharePage } from "../../lib/core.mjs";
import { store } from "../../lib/netlify-store.mjs";

export default async (req, context) => {
  const url = new URL(req.url);
  const html = await (await fetch(new URL("/index.html", url))).text();
  const page = await newsSharePage({ store, slug: context.params.slug, id: context.params.id, origin: url.origin, html }).catch(e => { console.error(e); return null; });
  return new Response(page || html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
};

export const config = { path: "/:slug/news/:id", excludedPath: ["/api/*", "/.netlify/*"] };
