# Gmail Campaign Sender

Web app (or Chrome extension) + backend to send templated emails from a CSV, with optional scheduling and one attachment per campaign (e.g. resume). Includes a dashboard of sent campaigns.

## Architecture

- **Web app (Vercel)** or **Chrome extension**: Templates with `{{placeholders}}`, CSV upload and merge preview, optional file attachment, schedule time picker, link Gmail for scheduled sends, dashboard, and send-now.
- **Backend (Node, e.g. Render)**: OAuth callback to store Gmail refresh token, schedule jobs, cron that sends due emails via Gmail API, and stores sent log.

## Backend setup

1. **Supabase (database and file storage)**
   - Create a project at [supabase.com](https://supabase.com).
   - In **SQL Editor**, run the script in `backend/supabase-schema.sql` to create tables (`users`, `oauth_states`, `scheduled_jobs`, `sent_log`, `templates`).
   - In **Project Settings → Database**, copy the connection string (URI) and set it as `DATABASE_URL` in `.env`.
   - For attachments (so scheduled campaigns work after restart or when the backend runs on Render): in **Storage**, create a bucket named `attachments` (public or private; the backend uses the service role). In **Project Settings → API**, copy **Project URL** and **service_role** key and set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. If these are not set, uploads use local disk (not suitable for production).

2. **Google Cloud Console**
   - Create a project and enable the Gmail API.
   - Create an **OAuth 2.0 Client ID** of type **Web application**.
   - Add authorized redirect URI: `http://localhost:3000/oauth/callback` and your production backend URL (e.g. `https://your-backend.onrender.com/oauth/callback`) if you deploy.
   - Note the Client ID and Client Secret.

3. **Install and configure**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   ```
   Edit `.env`:
   - `DATABASE_URL`: Supabase Postgres connection string (required).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from the step above.
   - `ENCRYPTION_KEY`: 32-byte hex (e.g. `openssl rand -hex 32`).
   - `OAUTH_REDIRECT_URI`: must match the redirect URI in Google (e.g. `http://localhost:3000/oauth/callback`).
   - Optional: `OAUTH_SUCCESS_REDIRECT` — only needed if you do not pass `success_redirect` from the extension (extension passes it by default).
   - Optional: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for attachment storage (recommended for production).
   - Optional: `SESSION_SECRET` — used for per-user sessions (recommended: `openssl rand -hex 32`). If unset, falls back to `ENCRYPTION_KEY`.
   - For **web app** deployment: set `ALLOWED_ORIGINS` to your web app URL (e.g. `https://your-app.vercel.app`). Use a **specific origin**, not `*`, so session cookies work and each user gets their own linked Gmail on their device. On Render (or any host where the frontend is on a different domain), set **NODE_ENV=production** so the session cookie uses `SameSite=None; Secure` and is sent on cross-origin requests.
   - **Per-user templates:** If you created the DB before templates were user-scoped, run in Supabase: `ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);`

4. **Run**
   ```bash
   npm start
   ```
   Server runs at `http://localhost:3000`. Scheduler runs every minute to send due campaigns.

5. **Keep backend awake (Render free tier)**  
   A GitHub Actions workflow (`.github/workflows/keepalive.yml`) pings `GET /health` every 10 minutes so the service doesn’t spin down. Add a repository secret: **Settings → Secrets and variables → Actions → New repository secret**. Name: `BACKEND_URL`, Value: your backend base URL with no trailing slash (e.g. `https://your-app.onrender.com`).

## Extension setup

1. **Same Google OAuth client (Chrome)**
   - In Google Cloud Console, create another **OAuth 2.0 Client ID** of type **Chrome extension** (or use the same Web client and add the extension’s origin if supported).
   - For **Chrome app/extension** type, set the extension ID (from `chrome://extensions` after loading unpacked).

2. **Configure manifest**
   - Open `extension/manifest.json` and set `oauth2.client_id` to your **Chrome extension** OAuth client ID (the one that matches your extension ID in the console).

3. **Load in Chrome**
   - Go to `chrome://extensions`, enable Developer mode, **Load unpacked**, and select the `extension` folder.

4. **Backend URL**
   - Default is `http://localhost:3000`. Stored in `chrome.storage.local`; you can change it in the extension code (`shared.js` / `popup.js`) or add a settings page.

## Web app (Vercel) setup

Use the web app instead of the extension so you can use the same UI in any browser.

1. **Backend**
   - Deploy the backend (e.g. on Render) and set `ALLOWED_ORIGINS` to your Vercel URL, e.g. `https://your-app.vercel.app`.
   - In Google Cloud Console, add the backend OAuth redirect URI (e.g. `https://your-backend.onrender.com/oauth/callback`).

2. **Deploy the web app to Vercel**
   ```bash
   cd web
   npm install
   ```
   - Create a `.env` (or set in Vercel Dashboard → Settings → Environment Variables):
     - `VITE_BACKEND_URL` = your backend URL (e.g. `https://your-backend.onrender.com`), no trailing slash.
   - Deploy: connect the repo to Vercel, set **Root Directory** to `web`, **Build Command** to `npm run build`, **Output Directory** to `dist`.

3. **Usage**
   - Open the Vercel URL. Link Gmail (you’ll be redirected to Google and back to `/linked.html`). Create templates, upload CSV, and send now or schedule. “Send test” uses the linked account (no Chrome identity needed).

## Usage

1. **Templates (Options page)**
   - Open the extension and click **Open Dashboard & Campaigns** (or right-click the icon → Options).
   - In **Templates**, set subject and body with placeholders like `{{first_name}}`, `{{company}}`. Click **Save template** (stored in Supabase so they persist across devices and restarts).

2. **Link Gmail for scheduled sends**
   - In **Campaign**, click **Link Gmail for scheduled sends**. Sign in with Google in the new tab and allow access. After redirect, Gmail is linked for the backend so it can send at scheduled times.

3. **Campaign**
   - Upload a CSV with an `email` column and columns matching your placeholders (e.g. `first_name`, `company`).
   - Optionally attach one file (e.g. resume) for all recipients.
   - Choose **Send at** (date/time) and click **Schedule campaign**.

4. **Dashboard**
   - View sent campaigns and recipient counts.

5. **Test email (popup)**
   - Use **Send test email** to send one email immediately using the extension’s Gmail token (no backend needed for that).

## CSV format

- Header row with column names. One column must be `email` (or `Email`).
- Other columns are used as merge fields: `{{column_name}}` in the template is replaced by the value in that column for each row.

Example:

```csv
email,first_name,company
john@example.com,John,Acme
jane@example.com,Jane,Beta
```

## Security notes

- Refresh tokens are stored encrypted (AES-256-GCM) in the backend DB.
- Run the backend over HTTPS in production and set `OAUTH_REDIRECT_URI` and CORS (`EXTENSION_ORIGIN`) accordingly.
- Keep `.env` and `ENCRYPTION_KEY` secret.
