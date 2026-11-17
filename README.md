# AURA Personal Finance

AURA is a vanilla JavaScript personal-finance app backed by Supabase. It uses Supabase Auth for sign-in and PostgreSQL with per-user row-level security for financial data.

## Local setup

1. Install Node.js 20.19+ or 22.12+.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. In `.env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from your Supabase project's API settings.
5. Start the app with `npm run dev`.

The publishable key is meant to be visible in browser code. Never use a Supabase service-role or secret key in this app.

## Supabase setup

1. Run [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql) in the Supabase SQL Editor.
2. Create your personal user from the Supabase dashboard; AURA does not expose a sign-up flow.
3. Disable public sign-ups in Supabase Auth settings. Hiding sign-up in the UI is not a substitute for this server-side setting.
4. Set the Supabase Auth site URL and allowed redirect URLs for local development and your deployed Pages URL. Password recovery redirects to the current app origin.
5. Confirm RLS is enabled on all three public tables and test with the authenticated user.

Supabase Auth manages its own persistent browser session. AURA does not write transactions or budget data to localStorage after migration.

## Local data migration

After you sign in, AURA checks the legacy keys `aura.transactions.v1` and `aura.monthlyBudget.v1` in that browser. It shows a confirmation with the import counts before sending data to your account. The original localStorage values are not deleted.

Imported transactions use their legacy IDs to make retries idempotent. If the current-month cloud budget already exists, AURA keeps it and reports that the local budget was skipped. Invalid local transactions block the import rather than being silently discarded.

## Build and Cloudflare Pages

Run `npm run build`; the static output is written to `dist/`. For Cloudflare Pages, set:

- Build command: `npm run build`
- Build output directory: `dist`
- Build environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

Connect the repository to Cloudflare Pages yourself and use the HTTPS Pages URL in the Supabase Auth redirect settings. This project does not deploy automatically.

## Offline and PWA behavior

The service worker caches only the static app shell and same-origin build assets. Supabase Auth and database requests are never cached. Offline status is shown and database-changing actions are disabled; transactions are not queued or reported as saved while offline. Financial records remain available only after successful authentication and a database fetch.

Installability requires an HTTPS deployment (localhost is also a secure context). Android uses the web manifest icons; iOS uses the Apple touch icon metadata.
