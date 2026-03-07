# Gmail Campaign Sender

Chrome extension + backend to send templated emails from a CSV, with optional scheduling (even when the browser is closed) and one attachment per campaign (e.g. resume). Includes a dashboard of sent campaigns.

## Architecture

- **Chrome extension**: Templates with `{{placeholders}}`, CSV upload and merge preview, optional file attachment, schedule time picker, link Gmail for scheduled sends, and dashboard.
- **Backend (Node)**: OAuth callback to store Gmail refresh token, schedule jobs, cron that sends due emails via Gmail API, and stores sent log.

## Backend setup

1. **Google Cloud Console**
   - Create a project and enable the Gmail API.
   - Create an **OAuth 2.0 Client ID** of type **Web application**.
   - Add authorized redirect URI: `http://localhost:3000/oauth/callback` (and your production URL if you deploy).
   - Note the Client ID and Client Secret.

2. **Install and configure**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   ```
   The backend uses `better-sqlite3` (native addon). If `npm install` fails to build it, ensure you have build tools (e.g. Xcode Command Line Tools on macOS, or `build-essential` on Linux).
   Edit `.env`:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from the step above.
   - `ENCRYPTION_KEY`: 32-byte hex (e.g. `openssl rand -hex 32`).
   - `OAUTH_REDIRECT_URI`: must match the redirect URI in Google (e.g. `http://localhost:3000/oauth/callback`).
   - Optional: `OAUTH_SUCCESS_REDIRECT` — only needed if you do not pass `success_redirect` from the extension (extension passes it by default).

3. **Run**
   ```bash
   npm start
   ```
   Server runs at `http://localhost:3000`. Scheduler runs every minute to send due campaigns.

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

## Usage

1. **Templates (Options page)**
   - Open the extension and click **Open Dashboard & Campaigns** (or right-click the icon → Options).
   - In **Templates**, set subject and body with placeholders like `{{first_name}}`, `{{company}}`. Save.

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
