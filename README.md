# PANTaU — Pemantauan Aktiviti Nadi dan TekAnan dalam Unit

Home log for blood pressure (systolic, diastolic, BPM) and finger clip oximeter (SpO₂, pulse) readings.
Built with plain HTML/CSS/JS and a Cloudflare Worker + D1 database.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `index.js` | Log in / sign up page |
| `dashboard.html`, `dashboard.js` | Patient dashboard (new reading, latest reading, history, print / PDF) |
| `offline.html` | Shown when there is no connection |
| `common.js`, `index.css` | Shared code and styles |
| `cloudflare_worker.js` | API (`/api/*`) and static page hosting |
| `schema.sql` | D1 tables: `users`, `sessions`, `readings` |
| `wrangler.json` | Worker config (D1 binding `DB`, assets binding `ASSETS`) |
| `.assetsignore` | Keeps the Worker, config and SQL files out of the public pages |

## First-time setup

1. Create the database, then copy the `database_id` it prints into `wrangler.json`:

   ```
   npx wrangler d1 create pantau-db
   ```

2. Create the tables:

   ```
   npx wrangler d1 execute pantau-db --local --file=schema.sql     # for local testing
   npx wrangler d1 execute pantau-db --remote --file=schema.sql    # for the live site
   ```

3. Test locally, then deploy:

   ```
   npx wrangler dev
   npx wrangler deploy
   ```

## Making an admin (for the admin dashboard later)

Sign up normally first, then:

```
npx wrangler d1 execute pantau-db --remote --command "UPDATE users SET role='admin' WHERE ic='900101015555'"
```

## Notes

- IC numbers are saved without dashes. Age is calculated from the IC when shown.
- Times are saved in UTC and shown in Malaysia time (UTC+8).
- PINs are stored only as PBKDF2 hashes. After 5 wrong PINs an account is locked for 15 minutes.
- Because a PIN is only 4–6 digits, keep the site private to people you trust.
