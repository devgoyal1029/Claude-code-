# Deploying on shared hosting (Hostinger Premium / Business, cPanel, any plain web space)

Shared hosting runs PHP and serves files. It does not run Node, and this
site's live data depends on a Node backend — not by preference, but because a
browser cannot call Yahoo, CoinGecko or the RSS feeds directly. They send no
CORS headers, so the browser blocks the response before your code sees it. A
server has to make those calls and hand the result to the page.

So the site splits in two:

| Piece | Where | What it costs |
|---|---|---|
| The pages, CSS, fonts, JS | Hostinger `public_html/` | already paid for |
| The data backend (`server/`) | Render (or Railway, Fly, any Node host) | free tier works |

The pages are told the backend's address at build time. Everything else is
unchanged — same code, same tests.

---

## 1. Put the backend up

1. Push this repository to GitHub if it is not there already.
2. On [render.com](https://render.com): **New → Blueprint**, pick this repo.
   It reads `render.yaml` at the repository root and needs no other answers.
3. When the service is live, open **Environment** and add:

   | Key | Value |
   |---|---|
   | `IV_MARKETAUX` | your Marketaux token |

   Optional, and safe to skip — without it the site is still live on the free
   keyless providers, just without sentiment scores and entity tags.
4. Copy the service URL. It looks like `https://verdict-api.onrender.com`.
5. Confirm it works:

   ```
   https://verdict-api.onrender.com/api/health
   ```

   `"live": true` means upstream is answering.

### What the free plan actually costs you

Render's free tier stops the service after 15 minutes with no traffic, and the
next visitor waits roughly 50 seconds for it to start. During that wait the
page loads normally and shows **SIMULATED** — it does not hang or error — then
switches itself to live once the backend answers.

For a site people visit through the day that is mostly invisible. For a demo
you are about to show someone, open the health URL a minute beforehand. The
$7/month instance removes the sleep entirely; that is the only thing it buys
you here.

---

## 2. Build the pages against that backend

```bash
cd terminal
node tools/build-static.js https://verdict-api.onrender.com
```

That writes `dist/static/` — 37 files with the API base already pointed at
your backend, plus an `.htaccess` for compression, caching, correct font MIME
types and an HTTP→HTTPS redirect.

The backend must be `https://`. An `https://` page is not allowed to call an
`http://` API — the browser blocks it as mixed content — so the build refuses
a plain-http address rather than shipping something that silently fails.

---

## 3. Upload

**hPanel → File Manager → `public_html`**, then upload everything *inside*
`dist/static/` — not the folder itself.

Turn on **show hidden files** first, or `.htaccess` will be left behind and
you will lose the caching and the HTTPS redirect.

FTP works equally well:

```
Host: ftp.yourdomain.com     (hPanel → Files → FTP Accounts)
Upload dist/static/*  →  /public_html/
```

Then load your domain. The header badge tells you the truth: **LIVE** means
the backend answered, **SIMULATED** means it did not.

---

## Things that go wrong, and what they mean

**Badge stuck on SIMULATED.** Open `https://your-backend/api/health` directly.
If it does not load, the backend is asleep (wait a minute) or the deploy
failed — check Render's logs. If it loads fine, you probably uploaded a build
made against a different URL; rebuild with the right one and re-upload
`js/config.js`.

**Console says "blocked by CORS policy".** The backend sends
`Access-Control-Allow-Origin: *` on every API response, so this almost always
means the request never reached it — a typo in the URL, or the service is
down. Check the failing URL in the Network tab.

**Console says "Mixed Content".** The page is https and the API base is http.
Rebuild with an `https://` address.

**Prices load but never move.** The live ticker uses Server-Sent Events. Some
proxies buffer them into silence. Check that `/api/stream` stays open in the
Network tab instead of completing. On Render it works as-is; behind your own
nginx you need `proxy_buffering off;` on that route.

**Fonts fall back to something generic.** `.woff2` was not uploaded, or the
host is serving it as `text/plain`. The `.htaccess` fixes the MIME type — make
sure it actually made it up.

---

## Keeping it updated

Push to the branch and Render redeploys the backend on its own. The pages only
need re-uploading when you change something in `css/`, `js/` or a `.html` —
rebuild and upload those files again.

---

## A note on keys

The Marketaux key lives in Render's environment, never in the files you upload
to Hostinger. Anything in `public_html/` is readable by anyone who guesses the
URL, and `server/config.json` would be served as plain text — which is exactly
why `build-static.js` refuses to copy the `server/` tree at all.

If a key has ever been pasted into a chat, an email or a commit, regenerate it
in the vendor's dashboard. Treat it as public from that moment.
