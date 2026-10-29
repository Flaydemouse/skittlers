# Skittles league website

- Hosted on Netlify, connected to this repo: every push to `main` deploys to production.
- Only commit and push when the user asks; a push to `main` goes live.
- Workflow: develop in the session and push to GitHub only when the user says the work is finished. After each change, rebuild the clickable preview (`node dev/build-preview.mjs <scratchpad>/preview.html`, admin password `preview`) and republish it to the same Artifact so the user can try it in Claude. `npm run preview` runs a local server for browser tests (admin password `test-pass-123`).
- `public/index.html` is the whole front end; `netlify/functions/api.mjs` is the API (Netlify Blobs storage).
- Secrets (`ADMIN_PASSWORD`, `SESSION_SECRET`) live in Netlify environment variables. Never commit a `.env` file.
- Captains' addresses and mobiles are stored separately ("contacts" blob) and must only be returned to logged-in admins.
