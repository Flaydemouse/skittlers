# Skittles league website

- Hosted on Netlify, connected to this repo: every push to `main` deploys to production.
- Only commit and push when the user asks; a push to `main` goes live.
- `public/index.html` is the whole front end; `netlify/functions/api.mjs` is the API (Netlify Blobs storage).
- Secrets (`ADMIN_PASSWORD`, `SESSION_SECRET`) live in Netlify environment variables. Never commit a `.env` file.
- Captains' addresses and mobiles are stored separately ("contacts" blob) and must only be returned to logged-in admins.
