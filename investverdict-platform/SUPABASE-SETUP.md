# Supabase setup — InvestVerdict tool

One-time setup (2 minutes), then everything is automatic.

## 1. Create the tables

Supabase dashboard → **SQL Editor** → *New query* → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

That creates three tool-only tables (they never touch the master site's tables):

| Table | Purpose |
|---|---|
| `iv_analyses` | One row per (owner, company): confirmed statements, forecast model, valuations, market inputs — all auto-saved |
| `iv_extractions` | PDF dedupe cache: the same annual report is extracted by Gemini **once ever**, then served instantly to everyone |
| `iv_terms` | Shared "What is this?" explanation cache (optional) |

The only link to the master site is `iv_analyses.profile_id → public.profiles(id)`.

## 2. Nothing else — the keys are already wired

- Frontend: `webapp/static/lib/config.mjs` (publishable key — safe in the browser,
  Row Level Security scopes it to the `iv_*` tables only).
- Server (dedupe cache): `webapp/supa_store.py`, overridable with the
  `SUPABASE_URL` / `SUPABASE_KEY` environment variables.
- **Never** put the `service_role` key in either place.

## How it behaves

- **Auto-save**: confirming an extraction saves the statements; building a
  forecast saves the model (debounced — only the settled state is written);
  running DCF/DDM/Bank/Comps saves the valuations. A small "☁ saved to cloud"
  toast confirms each write.
- **Master Dashboard → Cloud library**: every saved company is listed with
  Load / Delete. *Load* restores the whole session (statements, forecast,
  valuations, market inputs) and every screen picks it up.
- **Fail-open**: if the tables don't exist yet or Supabase is unreachable, the
  tool works exactly as before (session-only) and the dashboard says the cloud
  is off — nothing breaks.

## Master-site integration

Link to the tool with the learner's profile id:

```
https://<tool-host>/dashboard.html?profile=<profiles.id uuid>
```

The tool remembers the profile (localStorage) and tags every save with it, so
each learner sees their own library. Without `?profile=` saves go under the
shared owner `anon`.

The master site can also point the tool at a different Supabase project at
runtime, without editing any file:

```js
localStorage.setItem("iv_supa", JSON.stringify({ url: "https://xxxx.supabase.co", key: "sb_publishable_..." }));
```

## Security note (deliberate trade-off)

The tool runs **without login** by your choice, so the publishable key has
read/write on the three `iv_*` tables for everyone who has the key. Your
master-site tables are untouched by these policies. If you later want per-user
privacy, the upgrade path is Supabase Auth + owner-scoped RLS policies —
the schema is already keyed by owner, so no data migration would be needed.
