# Skittlers

Websites for skittles leagues. A league secretary signs up, creates one or more leagues, and for each season adds venues, teams and players, sets up divisions, and publishes tables, fixtures and results.

## How it works

1. **Account.** A secretary signs up with their name, email and password. New accounts get a 30-day free trial, then a yearly subscription. Payments aren't connected yet; the overall admin sets each account's paid-until date.
2. **League.** Each league gets its own web address, such as `skittlers.co.uk/yeovil` (and later `yeovil.skittlers.co.uk`).
3. **Season.** Each season has a start and finish date. A new season can bring across venues, teams (with captains' details), players and divisions from an earlier one.
4. **Venues, teams and players.** Add them one at a time or import them from CSV files (templates are on the Venues and Teams pages).
5. **Divisions.** Choose how many, then put each team in the division it plays in. More can be added later.
6. **Fixtures and results.** Generate a league fixture list per division, add cup ties, and enter results. The tables update automatically.

The **overall admin** (the account whose email matches `SUPERADMIN_EMAIL`) can see and manage every league, set subscriptions, reset passwords, and copy in the data from the original single-league version of the site.

## Code

| Part | What it does |
| --- | --- |
| `public/index.html` | The whole website. `/` is the account area; `/<league-address>` is a league's site. |
| `lib/core.mjs` | The API: accounts, leagues, seasons and season data. It doesn't depend on Netlify, so the same code runs in the preview. |
| `netlify/functions/api.mjs` | Runs the API on Netlify, storing data in Netlify Blobs (store `skittlers`). |
| `dev/` | Local preview server and the build for the clickable preview. |

Captains' addresses and mobile numbers are stored separately and only returned to the league's secretary and the overall admin.

## Netlify settings

Under **Site configuration → Environment variables**:

- `SESSION_SECRET`: any long random string. Keeps logins secure; changing it logs everyone out.
- `SUPERADMIN_EMAIL`: the email address of the overall admin. Sign up with this email to get the overall admin pages.

`ADMIN_PASSWORD` was used by the original single-league version and is no longer needed.

After changing a variable, go to **Deploys → Trigger deploy** so it takes effect. Every push to `main` deploys automatically.

## Running it locally

```bash
npm install
```

```bash
npm run preview
```

Then open http://localhost:8899. Data is kept in memory until the server stops. Sign up as `owner@skittlers.test` to be the overall admin.
