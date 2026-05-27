# BaxterOps — Deployment Runbook

Goal: deploy this Next.js app on **Vercel**, backed by **Supabase**, with **IONOS** managing only DNS for `bmsbets.com`.

**Before you do anything**: read `docs/PRODUCTION_SECURITY.md`. Current RLS is permissive. Only deploy to a private Vercel preview URL (or share it only with trusted SGD users) until RLS is locked down.

## Architecture decision

| Concern | Where it lives |
|---|---|
| App hosting | **Vercel** |
| Postgres + Storage + Auth | **Supabase** (already provisioned at `yxeechpebbuddonseldu.supabase.co`) |
| Domain registration + DNS | **IONOS** (`bmsbets.com`) |
| HTTPS / SSL termination | **Vercel** issues + renews automatically once DNS points correctly |

**Do not** try to host this app on IONOS shared hosting. It is a Next.js app with React Server Components, an API surface, and a custom layout. IONOS static hosting cannot serve it. The IONOS wildcard SSL certificate for `*.bmsbets.com` is fine to keep on file but **Vercel does not need it** — Vercel manages its own Let's Encrypt cert for any custom domain you attach.

---

## A. GitHub

The app must be in a GitHub repo Vercel can read.

1. From the project root (`/Users/shane/Desktop/Baxter/baxter-ops`), confirm a `.git/` exists. If not:
   ```bash
   git init
   git branch -m main
   git add -A
   git status   # SANITY CHECK: confirm .env.local is NOT listed
   git commit -m "Initial BaxterOps commit"
   ```
2. Create a new private GitHub repo (do not make it public — `lib/seed.ts` contains internal context).
3. Connect and push:
   ```bash
   git remote add origin git@github.com:<your-user>/baxter-ops.git
   git push -u origin main
   ```
4. Confirm in the GitHub web UI:
   - `.env.local` is **NOT** in the file tree
   - `.env.example` **IS** present
   - `node_modules/` is **NOT** present

## B. Vercel

1. Sign in at https://vercel.com (use GitHub auth).
2. **Add New → Project** → select the `baxter-ops` repo.
3. Framework preset: **Next.js** (auto-detected).
4. Root directory: leave default (`./`).
5. Build command: **default** (`next build`).
6. Output directory: **default**.
7. **Environment Variables** — add these to *Production*, *Preview*, and *Development*:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://yxeechpebbuddonseldu.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Copy from Supabase Dashboard → Project Settings → API → "publishable" or "anon" key |

   **Never** paste the service_role key here.

8. Click **Deploy**.
9. Watch build logs. Expect "✓ Compiled successfully" + "Generating static pages (27/27)".
10. When deploy finishes, click the preview URL (something like `baxter-ops-xxxxxxxx.vercel.app`).
11. Smoke test:
    - `/settings` → "Backend mode: supabase" + "Supabase env detected: yes"
    - `/competitors/zen-hollywood` → Photos tab → real Supabase Storage thumbnails render
    - `/data-quality-dashboard` → 143+ ledger entries
    - `/walkthrough-campaigns` → click Grade / Edit Tour → 19 covariate inputs

## C. IONOS DNS for bmsbets.com

You're going to make IONOS point `bmsbets.com` and `www.bmsbets.com` at Vercel.

1. In Vercel → Project → **Settings → Domains**.
2. Click **Add** and type `bmsbets.com`. Vercel will display the required DNS records. Typically:
   - Apex (`bmsbets.com`): an **A record** to `76.76.21.21` (Vercel's anycast IP)
     - or an **ALIAS / ANAME** if your DNS supports it
   - Subdomain (`www.bmsbets.com`): a **CNAME** to `cname.vercel-dns.com`

   Use the **exact** values Vercel shows you — they can change over time.

3. Open IONOS Control Panel → **Domains & SSL** → click `bmsbets.com` → **DNS** tab.

4. Edit / add:
   - **A** record · Host: `@` (or blank) · Points to: the IP Vercel shows (typically `76.76.21.21`)
   - **CNAME** record · Host: `www` · Points to: `cname.vercel-dns.com.` (trailing dot if IONOS requires)
   - **Remove** any old A or CNAME for the apex/www that point elsewhere.
5. Save. IONOS will warn about propagation time — usually 5-30 minutes, up to 48 hours worst case.
6. Back in Vercel → Domains tab — both domains should turn from "Invalid Configuration" to "Valid".
7. Visit `https://bmsbets.com` and `https://www.bmsbets.com`. Both should serve the app over HTTPS.

## D. SSL

You have an **IONOS Sectigo wildcard cert** for `*.bmsbets.com` issued via DNS validation. Status: Ready.

**Do not install it on Vercel.** Vercel auto-provisions and auto-renews a Let's Encrypt certificate for every custom domain you add, as soon as DNS validates. Manual cert upload is reserved for niche cases (corporate certs, EV certs, internal CAs) — Bailey's IONOS cert is none of those.

Keep the IONOS cert on file. It's free with your domain and could be useful if you later host other subdomains directly on IONOS infrastructure. It plays no role in the Vercel deployment.

Confirm SSL after DNS settles:
```bash
curl -I https://bmsbets.com
# Expect: HTTP/2 200, server header containing "Vercel"
```

## E. Post-deployment checklist

Run through this after Vercel reports "Production" and DNS resolves:

- [ ] `https://bmsbets.com` loads
- [ ] `https://www.bmsbets.com` loads (or 308-redirects to apex per Vercel default)
- [ ] `/settings` → Mode says `supabase`
- [ ] `/competitors/zen-hollywood` → Photos tab → 42 thumbnails render from Supabase Storage
- [ ] `/data-quality-dashboard` → counts populate (143+ ledger rows expected)
- [ ] Role switcher works in the top-right
- [ ] As Analyst Bailey: opening Yolanda Benning's record shows "🔒 Restricted compliance-sensitive note"
- [ ] As Admin Steve: opening Yolanda Benning's record shows the private notes
- [ ] Steve's view creates a row in `audit_logs` (verify in Supabase SQL editor)
- [ ] `/tasks` → click a status badge — change persists in Supabase
- [ ] `/walkthrough-campaigns` → Grade / Edit Tour → click a star — row appears in `manual_covariate_scores`
- [ ] `/reports` → owner-safe toggle hides Yolanda's name, replaces with "1 affordable-unit escalation"
- [ ] Mobile (iPhone Safari): sidebar collapses or scrolls cleanly; Quick Tour Grading panel taps are workable

## F. Rolling forward

- Future `git push origin main` deploys automatically to production.
- PRs and branches get their own Vercel preview URLs.
- Update env vars only in Vercel's settings — never commit them.

## G. If something fails

- Build fails on Vercel: check logs for TypeScript errors. The local `npm run build` already passes, so failures are almost always missing env vars or `node_modules` version drift.
- DNS won't validate: use `dig bmsbets.com` and `dig www.bmsbets.com` to verify the records actually exist as IONOS shows them.
- Photos don't load from Supabase: check `baxter-ops-photos` bucket is still `public = true` and 42 objects still exist (`select count(*) from storage.objects where bucket_id = 'baxter-ops-photos'`).
- Supabase rejects queries: confirm both env vars are set in Vercel for the right environment (Production vs Preview).
