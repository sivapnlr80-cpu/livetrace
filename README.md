# LiveTrace — Real-Time Consent-Based Location Sharing

A fully working live location tracker that works cross-device.
Built for GitHub Pages + Firebase Realtime Database.

---

## 🚀 Deploy to GitHub Pages (Step by Step)

### Step 1 — Create GitHub Repository

1. Go to [github.com](https://github.com) and click **New Repository**
2. Name it: `livetrace` (or anything you want)
3. Set it to **Public**
4. Click **Create Repository**

### Step 2 — Upload Files

Upload all these files to the repository root:
```
index.html
consent.html
style.css
app.js
consent.js
firebase.js
README.md
```

You can drag and drop them directly on GitHub, or use Git:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/livetrace.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Under **Source**, select `main` branch, `/ (root)` folder
3. Click **Save**
4. Your site will be live at: `https://YOUR_USERNAME.github.io/livetrace/`

---

## 🔥 Set Up Firebase (Free)

### Step 1 — Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add Project** → name it `livetrace` → Continue
3. Disable Google Analytics (not needed) → **Create Project**

### Step 2 — Enable Realtime Database

1. In the Firebase console, click **Realtime Database** (left sidebar)
2. Click **Create Database**
3. Choose a region (pick nearest to you)
4. Select **Start in test mode** (allows read/write) → **Enable**

### Step 3 — Get Your Config

1. Go to **Project Settings** (gear icon) → **General**
2. Scroll to **Your apps** → click **Web** (`</>`)
3. Register the app (any nickname) → you'll see your config:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           ← copy this
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",  ← copy this
  projectId: "your-project-id"   ← copy this
};
```

### Step 4 — Enter Config in LiveTrace

1. Open your GitHub Pages URL: `https://YOUR_USERNAME.github.io/livetrace/`
2. Paste your **Database URL**, **API Key**, and **Project ID** in the Firebase Setup section
3. Click **Save Config** then **Test Connection**

---

## 📱 How to Use

1. **Open** `https://YOUR_USERNAME.github.io/livetrace/` on your device
2. **Enter** your name, recipient's name, duration, and purpose
3. **Click** Generate Consent Link
4. **Copy** the link and send via WhatsApp / Telegram / Email
5. **Recipient** opens the link on their device → taps **Allow & Share** → browser asks for GPS
6. **Your map** updates in real time with their live location
7. Either party can **revoke** at any time

---

## 🔒 Security Notes

- The free Firebase test mode allows open read/write — fine for personal use
- For production, add Firebase Auth and proper security rules:

```json
{
  "rules": {
    "sessions": {
      "$sid": {
        ".read": true,
        ".write": true
      }
    },
    "positions": {
      "$sid": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

---

## 🗂️ File Structure

```
livetrace/
├── index.html      ← Sender dashboard (you open this)
├── consent.html    ← Recipient consent page (they open this)
├── style.css       ← Shared styles
├── app.js          ← Sender logic (Firebase listeners, map)
├── consent.js      ← Recipient logic (GPS, Firebase writes)
├── firebase.js     ← Firebase REST API helper
└── README.md       ← This file
```

---

## ⚙️ Tech Stack

- **GitHub Pages** — free static hosting
- **Firebase Realtime Database** — free real-time GPS relay (no custom server)
- **Leaflet.js + OpenStreetMap** — live map (free, no API key)
- **Browser Geolocation API** — real device GPS
- **Vanilla JS ES Modules** — no build step needed
