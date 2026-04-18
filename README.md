# K31 Mobile Tire Shop & Roadside Assistance

Production-ready mobile-first app with **real Firebase auth** and **cloud data sync**.
Deploys automatically to GitHub Pages.

---

## 🔥 Part 1 — Set up Firebase (10 minutes, one-time)

### Step 1: Create a Firebase project
1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it `k31-tire-shop` (or anything)
4. Disable Google Analytics (you don't need it) → **Create project**

### Step 2: Enable Authentication
1. Left sidebar → **Authentication** → **Get started**
2. Go to **Sign-in method** tab
3. Click **Email/Password** → toggle **Enable** → Save
4. Click **Google** → toggle **Enable** → pick a support email → Save

### Step 3: Enable Firestore Database
1. Left sidebar → **Firestore Database** → **Create database**
2. Choose **Start in production mode** → Next
3. Pick a region close to you (e.g. `us-central` or `us-east4`) → **Enable**

### Step 4: Apply the security rules
1. Firestore → **Rules** tab
2. Delete what's there, paste in the contents of **`firestore.rules`** from this project
3. Click **Publish**

### Step 5: Get your Firebase config
1. Click the ⚙️ gear icon (top left) → **Project settings**
2. Scroll to **"Your apps"** → click the **`</>`** web icon
3. Nickname it `k31-web` → **Register app** (skip hosting)
4. You'll see a `firebaseConfig` block that looks like this:
```js
const firebaseConfig = {
  apiKey: "AIzaSyABC...",
  authDomain: "k31-tire-shop.firebaseapp.com",
  projectId: "k31-tire-shop",
  storageBucket: "k31-tire-shop.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```
**Keep this tab open — you'll need these 6 values in Part 3.**

---

## 🐙 Part 2 — Push to GitHub (5 minutes)

### Step 1: Create a GitHub repo
- Go to **https://github.com/new**
- Name it whatever you want, e.g. `k31-app`
- Public (free GitHub Pages requires this)
- Don't add README/gitignore — you already have them
- **Create repository**

### Step 2: Update `vite.config.js` for your repo name
Open `vite.config.js`. Change `"/k31-app/"` to match your repo name exactly:
```js
base: "/YOUR-REPO-NAME/",
```
**The slashes matter.** If your repo is `my-tire-app`, use `"/my-tire-app/"`.

### Step 3: Push the code
Open a terminal inside this folder:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

---

## 🔐 Part 3 — Connect Firebase to GitHub (5 minutes)

Your Firebase API keys need to live in GitHub as **Secrets** (not in your code).

### Step 1: Add Firebase secrets to your repo
On GitHub, go to your repo:
1. **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add each of these one at a time (paste the matching value from your Firebase config):

| Secret Name | Value from `firebaseConfig` |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

### Step 2: Enable GitHub Pages
Still on GitHub in your repo:
1. **Settings** → **Pages** (left sidebar)
2. Under **Build and deployment** → **Source** → pick **GitHub Actions**
3. Done — no other setting needed

### Step 3: Trigger the deploy
Any push triggers deploy. If you already pushed in Part 2, go to the **Actions** tab — you'll see it running. Otherwise:
```bash
git commit --allow-empty -m "trigger deploy"
git push
```

### Step 4: Authorize your domain in Firebase
(This is needed so Google Sign-in works on your live site.)
1. Back in Firebase Console → **Authentication** → **Settings** tab → **Authorized domains**
2. Click **Add domain**
3. Add: `YOUR-USERNAME.github.io` (just the domain, no path)
4. Save

### Step 5: Wait ~90 seconds
Check the **Actions** tab on GitHub. When the green checkmark appears, your site is live at:
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

**Every push to `main` auto-deploys from now on.**

---

## 🖥️ Run Locally (optional)
```bash
# 1. Copy .env.example to .env.local
cp .env.example .env.local

# 2. Edit .env.local and paste your real Firebase values

# 3. Install & run
npm install
npm run dev
```
Opens at http://localhost:5173

---

## 📁 Project Structure
```
├── public/
│   └── k31-logo.png              # Your logo
├── src/
│   ├── App.jsx                   # Full app (~1600 lines)
│   ├── firebase.js               # Firebase initialization
│   └── main.jsx                  # React entry
├── .github/workflows/
│   └── deploy.yml                # Auto-deploy
├── firestore.rules               # Copy into Firebase Console
├── .env.example                  # Template for local .env.local
├── index.html
├── package.json
└── vite.config.js                # ← Edit `base` for your repo name
```

---

## 🗃️ Data Model (Firestore)

```
users/{uid}
  ├── profile: { businessName, serviceArea, services[], pricingPreference, onboarded }
  ├── settings: { perMileRate, freeMiles, heavyDutyMultiplier, phone }
  ├── email, createdAt
  │
  ├── jobs/{jobId}
  │     { serviceId, heavyDuty, location, miles, basePrice, finalPrice,
  │       profit, status, customerName, customerPhone, source, notes, ... }
  │
  └── locations/{locId}
        { name, count, lastUsed }
```

Each user sees **only their own data** — enforced by the rules in `firestore.rules`.

---

## 🛠️ Troubleshooting

**"Firebase env vars not set" warning in console**
→ Locally: create `.env.local` from `.env.example`.
→ In production: check GitHub → Settings → Secrets all six are set with exact names above.

**Blank page after deploy**
→ 99% of the time it's the `base` in `vite.config.js`. Must exactly match `/YOUR-REPO-NAME/` with both slashes.

**Google sign-in fails with "unauthorized domain"**
→ Part 3 Step 4 — add `YOUR-USERNAME.github.io` to Firebase Authorized domains.

**"Missing or insufficient permissions" in console**
→ Firestore rules weren't published. Go to Firestore → Rules tab, paste `firestore.rules` contents, click **Publish**.

**Workflow failed in Actions tab**
→ Click the failed run → read the red step. Most common: a typo in a secret name, or Pages source wasn't set to "GitHub Actions".

**Want to reset a user's data while testing**
→ Firebase Console → Firestore → `users` → click the doc → Delete. Firebase Console → Authentication → Users → delete the user.

---

## 💰 Cost

Firebase **Spark (free) tier** gives you:
- 50K document reads/day
- 20K writes/day
- 10GB storage

For a single tire shop doing ~30 jobs a day, you'll use about 1% of the free tier. You won't pay anything.
