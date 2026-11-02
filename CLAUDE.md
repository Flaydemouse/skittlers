# Skittlers league websites

- Hosted on Netlify, connected to this repo: every push to `main` deploys to production.
- Only commit and push when the user asks; a push to `main` goes live.
- Workflow: develop in the session and push to GitHub only when the user says the work is finished. After each change, rebuild the clickable preview (`node dev/build-preview.mjs <scratchpad>/preview.html`) and republish it to the same Artifact so the user can try it in Claude. The preview runs the real `lib/core.mjs` API in the browser. `npm run preview` runs a local server for browser tests; sign up as `owner@skittlers.test` for the overall admin.
- `public/index.html` is the whole front end (`/` = account area, `/<slug>` = a league; later `<slug>.skittlers.co.uk`). `lib/core.mjs` is the API; `netlify/functions/api.mjs` wraps it with Netlify Blobs.
- Data model: accounts (`users/`, `emails/`), leagues (`leagues/`, `slugs/`), and per season `seasons/<league>/<season>` (teams, venues, fixtures, divisions, cups) plus `contacts/<league>/<season>`.
- Secrets (`SESSION_SECRET`, `SUPERADMIN_EMAIL`) live in Netlify environment variables. Never commit a `.env` file.
- Captains' addresses and mobiles are stored separately ("contacts") and must only be returned to the league's secretary or the overall admin.
- League settings (`leagues/<id>.settings`): points for win/draw/loss, players a side, balls a hand, hands each player throws, and the game (rough skittles or nomination). Each division and cup can set its own `game`; otherwise it plays the league's.
- Only league secretaries for now; other roles (results secretary, captains) come later. Subscriptions are yearly, set by the overall admin until payments are added.
- Cups (Manage cups page): knockout tournaments, team or individual player, full tournament or straight final. Rounds and byes are worked out from the number of entries; only the draw and results are stored, and later rounds are derived from them.
- Photo reading (add-on, extra yearly subscription): the secretary photographs the board and Claude fills in the scorecard for checking. The overall admin sets `users/<id>.photos {until, monthlyLimit}`; readings are counted in `usage/<league>/<yyyy-mm>`. The API stores a job in `board-jobs/` and `netlify/functions/read-board-background.mjs` reads it with the Claude API (`lib/claude-reader.mjs`; needs `ANTHROPIC_API_KEY`, optional `BOARD_MODEL`/`BOARD_EFFORT`). The preview reads photos through the Claude app instead. `BOARD_FAKE=1 npm run preview` makes up readings for local tests.
