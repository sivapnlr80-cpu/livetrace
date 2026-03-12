# LiveTrace

Real-time consent-based location tracking. Works cross-device via Firebase + GitHub Pages.

## Deploy (5 minutes)

### 1. GitHub Pages

1. Create a **public** GitHub repo named `livetrace`
2. Upload all files: `index.html`, `track.html`, `dashboard.js`, `track.js`, `fb.js`
3. Go to **Settings → Pages → Source: main branch** → Save
4. Your URL: `https://YOUR_USERNAME.github.io/livetrace/`

### 2. Firebase Realtime Database (free)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → any name → Continue
3. Left sidebar → **Realtime Database** → **Create Database**
4. Select a region → choose **Start in test mode** → Enable
5. Copy the database URL shown (e.g. `https://myapp-default-rtdb.firebaseio.com`)

### 3. Configure LiveTrace

1. Open `https://YOUR_USERNAME.github.io/livetrace/`
2. Paste your Firebase URL → click **Save & Test**
3. You should see "Connected ✅"

## How to Use

1. Type a label (e.g. "Delivery Guy" or "Ravi")
2. Click **Generate Link**
3. Copy and send via WhatsApp/Telegram/Email
4. Recipient opens link → reads terms → taps **Share My Location**
5. Their GPS pin appears on your map live
6. Click **⛔ Stop** anytime to end the session

## Files

```
index.html    ← Author dashboard (you)
track.html    ← Recipient consent + sharing page (them)
dashboard.js  ← Dashboard logic
track.js      ← GPS sharing logic  
fb.js         ← Firebase REST helper
```

## Firebase Rules (test mode)

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
