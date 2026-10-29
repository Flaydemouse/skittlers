# Skittles League website

League tables, league fixtures and cup fixtures, plus a password-protected admin area for teams, venues, fixtures and results.

## How it fits together

| Part | What it does |
| --- | --- |
| `public/index.html` | The whole website (one page). |
| `netlify/functions/api.mjs` | A small API that runs on Netlify. Anyone can read the league data; saving needs the admin password. |
| Netlify Blobs | Netlify's built-in storage. Holds the league data and, separately, the captains' addresses and mobile numbers. |

Captains' addresses and mobile numbers are never sent to public visitors. Only someone logged in as admin can see them.

## Deploying to Netlify

Netlify's drag-and-drop deploy doesn't include Functions, so use one of these two methods.

### Option A: from GitHub (recommended)

1. Put this folder in a GitHub repository.
2. In Netlify, choose **Add new site → Import an existing project** and pick the repository. The build settings come from `netlify.toml`, so leave them as they are.
3. Go to **Site configuration → Environment variables** and add:
   - `ADMIN_PASSWORD`: the password league admins will use to log in.
   - `SESSION_SECRET`: any long random string. It keeps admin logins secure, and changing it logs everyone out.
4. Go to **Deploys → Trigger deploy** so the new variables take effect.

After that, every push to GitHub redeploys the site. Your league data is kept between deploys.

### Option B: from your computer with the Netlify CLI

```bash
npm install
```

```bash
npx netlify-cli login
```

```bash
npx netlify-cli init
```

Set `ADMIN_PASSWORD` and `SESSION_SECRET` as in step 3 above, then deploy:

```bash
npx netlify-cli deploy --prod
```

## Using it

- Open the site and click **Admin login**, then enter the admin password.
- To try it out, open **League setup → Load example season**. When you're done, use **Delete all teams, venues and fixtures** to clear it.
- Admin logins last 12 hours on each device.
- Every admin shares the one password. If two admins save at the same moment, the second is asked to redo the change instead of overwriting the first.

## Running it locally

```bash
npm install
```

Create a `.env` file containing `ADMIN_PASSWORD=...` and `SESSION_SECRET=...`, then run:

```bash
npx netlify-cli dev
```
