# ALSKILL (GitHub Pages + GAS + Cloudflare Proxy)

This project runs a modern web dashboard UI and uses Google Apps Script (GAS) + Google Sheets as a backend.

Because browsers block cross-origin `fetch()` calls to GAS Web Apps (CORS / preflight), the recommended deployment is:

**GitHub Pages (Frontend) → Cloudflare Worker (CORS Proxy) → Google Apps Script Web App**

---

## 1) Deploy the Google Apps Script Web App (Backend)

1. Open your Apps Script project.
2. Deploy → **New deployment** → **Web app**
3. **Execute as**: Me
4. **Who has access**: Anyone (or Anyone with link)
5. Copy the `/exec` URL (Web App URL).

You can sanity-check:

- `GET ?action=initializeDatabase`
- `GET ?action=getAdminAnalytics`

---

## 2) Deploy the Cloudflare Worker (CORS Proxy)

### Option A: Cloudflare Dashboard (quick)

1. Go to Workers & Pages → **Create Worker**
2. Replace the worker code with `cloudflare-worker.js`
3. Add Worker **Environment Variable**:
   - **Name**: `GAS_WEBAPP_URL`
   - **Value**: your GAS `/exec` URL
4. Deploy.

Your Worker URL will look like:
`https://your-worker-name.your-subdomain.workers.dev`

---

## 3) Configure the Frontend to use the Worker

In `app.js`, set `GAS_WEBAPP_URL` to your Worker URL (not the GAS URL).

Example:

```js
const GAS_WEBAPP_URL = "https://your-worker-name.your-subdomain.workers.dev";
```

---

## 4) Deploy the Frontend on GitHub Pages

1. Push these files to a GitHub repo (at least `index.html`, `styles.css`, `app.js`, `img1.webp`)
2. Repo → Settings → Pages
3. Source: Deploy from branch → `main` → `/ (root)`
4. Wait for build → open your GitHub Pages site.

---

## Local development

You can still run locally:

- Open `index.html` directly, or
- Use a dev server (any static server).

The Worker proxy avoids CORS both locally and on GitHub Pages.

