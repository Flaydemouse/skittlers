# Skittlers league websites

- Hosted on Netlify, connected to this repo: every push to `main` deploys to production.
- Only commit and push when the user asks; a push to `main` goes live.
- Workflow: develop in the session and push to GitHub only when the user says the work is finished. After each change, rebuild the clickable preview (`node dev/build-preview.mjs <scratchpad>/preview.html`) and republish it to the same Artifact so the user can try it in Claude. The preview runs the real `lib/core.mjs` API in the browser. `npm run preview` runs a local server for browser tests; sign up as `owner@skittlers.test` for the overall admin.
- `public/index.html` is the whole front end (`/` = account area, `/<slug>` = a league; later `<slug>.skittlers.co.uk`). `lib/core.mjs` is the API; `netlify/functions/api.mjs` wraps it with Netlify Blobs.
- Data model: accounts (`users/`, `emails/`), leagues (`leagues/`, `slugs/`), and per season `seasons/<league>/<season>` (teams, venues, fixtures, divisions, cups) plus `contacts/<league>/<season>`.
- Secrets (`SESSION_SECRET`, `SUPERADMIN_EMAIL`) live in Netlify environment variables. Never commit a `.env` file.
- Captains' addresses and mobiles are stored separately ("contacts") and must only be returned to the league's secretary or the overall admin.
- Only league secretaries for now; other roles (results secretary, captains) come later. Subscriptions are yearly, set by the overall admin until payments are added.
- Cups (Manage cups page): knockout tournaments, team or individual player, full tournament or straight final. Rounds and byes are worked out from the number of entries; only the draw and results are stored, and later rounds are derived from them.
