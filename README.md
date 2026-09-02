# Std

A simple cloud-synced to-do app with three workload tabs (Simple / Medium / Heavy) plus a Home dashboard.

## Files
- `index.html` — structure + all styling (dark/light theme, sticky-note tab colors)
- `firebase-config.js` — your Firebase project credentials (**edit this before use**)
- `db.js` — Firestore read/write layer
- `app.js` — app logic (UI, PIN lock, rendering)
- `manifest.json` — PWA manifest
- `icon-192.png`, `icon-512.png`, `logo.svg` — app icon

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com and create a new project (free Spark plan is enough).
2. In the project, go to **Build → Firestore Database → Create database**. Start in **production mode** (rules below lock it down anyway).
3. Go to **Project settings → General → Your apps**, click the web icon (`</>`), register an app (no hosting needed).
4. Copy the `firebaseConfig` object it gives you into `firebase-config.js`, replacing the placeholder values.

## 2. Firestore security rules
Since there's no traditional login, this app uses **Firebase Anonymous Auth**: each device silently signs in as an anonymous user, and Firestore rules require `request.auth != null`. This means your data isn't wide open even though `firebase-config.js` (with your project's public API key) lives in your GitHub repo.

**Enable anonymous sign-in:**
1. Firebase console → **Build → Authentication → Sign-in method**.
2. Enable the **Anonymous** provider → Save.

**Set the rules:**
Firestore Database → **Rules** tab → replace the contents with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
Click **Publish**.

This still isn't per-person access control (any anonymous session can read/write everything), but it blocks the "anyone on the internet without even opening your app" case that Firebase's public-rules warning flags.

## 3. Push to GitHub
```bash
git init
git add .
git commit -m "Initial Std app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 4. Deploy (GitHub Pages)
1. In your GitHub repo: **Settings → Pages**.
2. Source: **Deploy from a branch** → branch `main`, folder `/ (root)`.
3. Save — your app will be live at `https://<your-username>.github.io/<your-repo>/` within a minute or two.

## 5. First run (after this update)
- The PIN is now **shared/global**: one PIN works on every device, stored in Firestore, editable any time from Settings → Change PIN.
- Since this replaces the old per-device PIN, whichever device opens the updated app first will be asked to **set the new shared PIN** (entered twice to confirm). Every other device will then be asked to enter that same PIN the next time it opens the app.
- After that, each device still only asks once per calendar day (that check stays local per device — only the PIN value itself is shared).
- Add tasks from each tab's **+ Add task** button. Tap any task to view it, then tap **Edit** to change its details, move it between groups, or delete it. Adding a progress note and marking complete/reopening stay directly on the task view.
- The **Calendar** and **Settings** icons are in the top-right corner. Theme (dark/light) and the three "created by" names are both set from Settings.

## Notes / known limits
- Single shared Firestore collection — every device with the PIN sees the same data (by design, per your single-user spec).
- No offline queue beyond Firestore's built-in local cache — should work fine on flaky connections, but isn't tested for fully offline use.
- PIN is a shared 4-digit value stored in Firestore (`meta/security`), not a proper encrypted vault — matches the "minimum security gate" you asked for, not meant to protect sensitive data. Anyone who knows the PIN can unlock any device running the app.
