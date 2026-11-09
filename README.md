# Std

A simple cloud-synced to-do app with three workload tabs (Simple / Medium / Heavy) plus a Home dashboard.

**Live app:** https://cyresh.github.io/std/

## Features
- Three workload groups (Simple / Medium / Heavy, renameable) with a Home dashboard, Calendar (with Tamil panchangam), Search and Reminders
- Tasks with activity numbers, due date/time, location, created-by, and a timestamped notes/progress log
- **Archive** — park tasks that can't be done yet without closing them. Archive icon on each open task and on the task screen; archived tasks sit in a collapsed *Archived* group at the bottom of each tab, are excluded from overdue/reminders/progress, and can be restored any time (also searchable via the *Archived* filter)
- **Repeating tasks** — Daily, Weekly, Every 2 weeks, Monthly, Every 3 months, Every 6 months, Yearly or Custom. Choose *fixed schedule* (from due date) or *after I complete it* (from completion date). Completing a repeating task creates the next copy automatically; archiving pauses the series
- Google sign-in, shared 6-digit PIN (asked once per day per device), dark/light theme
- Installable PWA with offline caching

## Files
- `index.html` — structure + all styling
- `app.js` — app logic (UI, sign-in, PIN lock, rendering)
- `db.js` — Firestore data layer (tasks, archive, recurrence, PIN, settings)
- `firebase-config.js` — Firebase project config (public web config; access is controlled by the rules below)
- `sw.js` — service worker (app-shell + Firebase SDK caching)
- `astronomy.min.js` — Tamil calendar data, loaded only when the Calendar tab is opened
- `manifest.json`, `icon-192.png`, `icon-512.png`, `logo.svg` — PWA manifest and icons

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com and create a project (free Spark plan is enough).
2. **Build → Firestore Database → Create database** (production mode).
3. **Project settings → General → Your apps** → add a web app, then copy the `firebaseConfig` into `firebase-config.js`.

## 2. Sign-in (Google only)
1. **Build → Authentication → Sign-in method** → enable **Google**.
2. Leave **Anonymous** **disabled**.
3. **Authentication → Settings → Authorized domains** → make sure `cyresh.github.io` is listed.
4. Open the live app and sign in once with the Google account that should own the data, then copy that account's **User UID** from **Authentication → Users**.

Every device must sign in once with the same Google account.

## 3. Firestore security rules
Only your own Google account can read or write. In **Firestore Database → Rules**, replace the UID placeholder and publish:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == 'YOUR_GOOGLE_ACCOUNT_UID'
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }
  }
}
```
Test it in the **Rules Playground** (provider `google.com`, your UID → allowed; any other UID → denied) before publishing.

## 4. Restrict the API key
In Google Cloud Console → **APIs & Services → Credentials**, open the browser key for the project:
- **Application restrictions → Websites:** `https://cyresh.github.io/*` and `https://<project-id>.firebaseapp.com/*`
- **API restrictions → Restrict key:** Identity Toolkit API, Token Service API, Cloud Firestore API (add Firebase Installations API only if the console shows it is blocked)

## 5. Deploy (GitHub Pages)
1. Push the files to the `main` branch of the repo (`cyresh/std`).
2. **Settings → Pages** → Source: **Deploy from a branch** → `main`, folder `/ (root)`.
3. The app is served at https://cyresh.github.io/std/ within a minute or two.

**Every time you deploy changes:** bump `CACHE_VERSION` in `sw.js` (e.g. `std-v4` → `std-v5`) so installed devices pick up the new files. Reload the app twice after deploying.

## How loading stays fast
- `sw.js` caches the app files and the pinned Firebase SDK, so repeat launches don't wait on the network.
- The PIN lock decision is made locally at startup (cached PIN hash + "unlocked today" flag). The server copy is re-checked in the background; if the shared PIN was changed on another device, this device locks again immediately.
- Firestore offline persistence serves tasks from the local cache while syncing in the background.
- Only the very first run on a new device needs the network for the PIN check.

## PIN notes
- The PIN is shared across devices and stored as a hash in Firestore (`meta/security`). Change it from Settings → Change PIN.
- It is a convenience screen lock, not an encrypted vault. The real protection is your Google account (turn on 2-step verification) plus the Firestore rules above.

## Data layout
- `tasks` — `{ tab, activityNo, title, dueDate, dueTime, location, createdBy, status: open|completed|archived, createdAt, completedAt, archivedAt, repeat: { every, unit, from, anchor } | null, nextSpawned, notes[] }`
- `meta/security` — `{ pinHash }`
- `meta/appSettings` — `{ createdByNames[], tabLabels{} }`

## Known limits
- Single shared data set — whoever signs in with the authorised Google account sees the same tasks (by design, single user).
- Fully offline use relies on Firestore's local cache and the service worker; changes sync when the connection returns.
- Installed to a phone home screen, the Google sign-in popup can be blocked on some browsers (notably iOS standalone mode); sign in once in the normal browser first.
