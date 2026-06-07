# ChordScribe — Complete Deployment Guide
## From zero to live, selling app in ~1 hour

---

## WHAT YOU'LL END UP WITH

- Live web app at `https://chordscribe.app` (or any domain)
- Installable on Android as a PWA (home screen icon, works like a native app)
- Real audio transcription: lyrics via Whisper AI, chords via music analysis
- Stripe payments taking £4.99 one-time purchases
- Running on Railway for ~£10/month

---

## STEP 1 — GET THE CODE READY (5 mins)

### 1a. Install Git (if you don't have it)
Download from: https://git-scm.com/downloads

### 1b. Create a GitHub account
Go to: https://github.com and sign up (free)

### 1c. Create a new repository
1. Click the green "New" button on GitHub
2. Name it: `chordscribe`
3. Set to Private
4. Click "Create repository"

### 1d. Upload your files
Drag and drop the entire `chordscribe` folder into the GitHub repository page.
Or if you're comfortable with the terminal:

```bash
cd chordscribe
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOURUSERNAME/chordscribe.git
git push -u origin main
```

---

## STEP 2 — SET UP STRIPE PAYMENTS (10 mins)

### 2a. Create a Stripe account
Go to: https://stripe.com → click "Start now"
Fill in your details (you need a UK bank account)

### 2b. Create your product
1. In Stripe dashboard → go to "Products"
2. Click "Add product"
3. Name: `ChordScribe Lifetime Access`
4. Price: `£4.99`
5. Type: `One time`
6. Click Save
7. **Copy the Price ID** — looks like `price_1ABC123...`

### 2c. Get your API keys
1. In Stripe → "Developers" → "API keys"
2. Copy your **Publishable key** (starts with `pk_live_`)
3. Copy your **Secret key** (starts with `sk_live_`)

⚠️ Keep your secret key private — never put it in frontend code

### 2d. Update your frontend file
Open `frontend/app.js` and replace these two lines near the top:

```javascript
const STRIPE_KEY = 'pk_live_XXXX'; // ← paste your publishable key here
const PRICE_ID   = 'price_XXXX';   // ← paste your price ID here
```

---

## STEP 3 — DEPLOY TO RAILWAY (15 mins)

### 3a. Create Railway account
Go to: https://railway.app → "Login with GitHub"
Authorise Railway to access your GitHub

### 3b. Create new project
1. Click "New Project"
2. Choose "Deploy from GitHub repo"
3. Select your `chordscribe` repo
4. Railway will auto-detect the config and start building

### 3c. Add environment variables
In Railway → your project → "Variables" tab, add these:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_XXXX` (your Stripe secret key) |
| `STRIPE_WEBHOOK_SECRET` | (get this in step 3e below) |
| `FRONTEND_URL` | `https://your-app.railway.app` (Railway gives you this URL) |
| `ALLOWED_ORIGINS` | `https://your-app.railway.app` |

### 3d. Wait for deploy
Railway will install all Python packages and start the server.
This first deploy takes 5–10 minutes (downloading Whisper model).
You'll see a green "Active" status when it's done.

### 3e. Set up Stripe webhook
1. In Stripe → "Developers" → "Webhooks"
2. Click "Add endpoint"
3. URL: `https://your-app.railway.app/stripe-webhook`
4. Events to listen for: `checkout.session.completed`
5. Copy the **Signing secret** (starts with `whsec_`)
6. Paste it into Railway env variable `STRIPE_WEBHOOK_SECRET`

---

## STEP 4 — CONNECT YOUR DOMAIN (10 mins)

### 4a. Buy a domain
Recommended: https://porkbun.com (cheapest)
Search for `chordscribe.app` or similar — ~£10/year

### 4b. Add domain in Railway
1. Railway project → "Settings" → "Domains"
2. Click "Add custom domain"
3. Type your domain e.g. `chordscribe.app`
4. Railway shows you a CNAME record to add

### 4c. Add DNS record
In Porkbun (or wherever you bought the domain):
1. Go to "DNS" for your domain
2. Add a CNAME record:
   - Type: `CNAME`
   - Host: `@` (or `www`)
   - Value: (what Railway gave you)
3. Wait 10–30 mins for DNS to propagate

### 4d. Update your config
Back in Railway environment variables, update:
- `FRONTEND_URL` → `https://chordscribe.app`
- `ALLOWED_ORIGINS` → `https://chordscribe.app`

Also update in `frontend/app.js`:
```javascript
const API_BASE = 'https://chordscribe.app';
```
Push this change to GitHub → Railway auto-redeploys.

---

## STEP 5 — APP ICONS (5 mins)

You need two PNG icon files for the PWA:
- `frontend/icons/icon-192.png` (192×192 pixels)
- `frontend/icons/icon-512.png` (512×512 pixels)

### Quick way — free icon generator:
1. Go to: https://favicon.io/favicon-generator/
2. Type "CS" (for ChordScribe), pick a dark background
3. Download and resize to 192×192 and 512×512
4. Save both files into `frontend/icons/`
5. Push to GitHub

---

## STEP 6 — TEST EVERYTHING (10 mins)

### Test the app
1. Open your domain in Chrome on your phone
2. Try recording 30 seconds of a song
3. Hit Analyse — you should see the processing screen
4. Results should come back in 30–60 seconds

### Test payments
1. Click "Get Lifetime Access"
2. Use Stripe test card: `4242 4242 4242 4242` (any future expiry, any CVV)
3. Should redirect back to app with "Payment successful" message

### Install as PWA on Android
1. Open the site in Chrome on your Samsung S24
2. Chrome shows a banner: "Add to Home Screen" — tap it
3. Or: Chrome menu (⋮) → "Add to Home Screen"
4. App icon appears on your home screen
5. Opens fullscreen, no browser bar — feels like a native app

---

## STEP 7 — GO LIVE WITH REAL PAYMENTS

When you're happy everything works:
1. In Stripe → toggle from "Test mode" to "Live mode"
2. Get your live API keys (they start with `pk_live_` and `sk_live_`)
3. Update in Railway environment variables
4. Update publishable key in `app.js`

---

## MONTHLY COSTS BREAKDOWN

| Service | Cost |
|---|---|
| Railway (Hobby plan) | £5/month |
| Domain | ~£0.83/month (£10/year) |
| Stripe | Free + 1.4% + 20p per transaction |
| **Total fixed** | **~£6/month** |

Break even at just **2 sales per month**.

---

## MARKETING IDEAS

### Free channels
- **Reddit**: r/guitarlessons, r/learnguitar, r/musictheory — share your tool genuinely
- **TikTok/YouTube Shorts**: Screen record yourself analysing a famous song
- **Facebook Groups**: "Learn Guitar" groups — offer it as a helpful tool
- **Product Hunt**: Launch on producthunt.com (free, gets eyes on new tools)

### Simple pitch
> *"I built an app that listens to any song and gives you the lyrics, chords, and guitar tab in seconds. First analysis is free."*

---

## TROUBLESHOOTING

**"Analysis failed" error**
- Check Railway logs (project → "Deployments" → click latest → "View logs")
- Usually means ffmpeg isn't installed or Whisper model is still downloading

**Whisper is slow**
- First run downloads the model (~1.4GB) — subsequent runs are fast
- On Railway's free tier it can timeout. Upgrade to the £5/month Hobby plan.

**Payments not working**
- Make sure you're using live keys (not test keys) in production
- Check Stripe dashboard for failed payment attempts

**PWA not installing**
- Must be on HTTPS (Railway gives you this automatically)
- Must have a valid manifest.json with icons
- Open Chrome DevTools → Application → Manifest to debug

---

## UPGRADING IN FUTURE

Things you can add later:
- **User accounts** (Supabase — free tier is generous)
- **Song history** (store past analyses per user)
- **YouTube URL input** (fetch captions via YouTube Data API)
- **Better chord detection** (use Demucs to isolate guitar track first)
- **iOS App Store** (wrap PWA with Capacitor — £99/year Apple dev account)
- **Android Play Store** (wrap PWA with TWA or Capacitor — £25 one-time fee)

---

*Built with FastAPI · OpenAI Whisper · Basic Pitch · Stripe · Railway*
