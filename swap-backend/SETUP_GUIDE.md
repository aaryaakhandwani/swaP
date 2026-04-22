# swaP — Neon PostgreSQL Setup Guide

## How to Connect Your Domain + Neon Database

---

## STEP 1: Set Up Neon Database (Free Tier)

1. Go to **https://console.neon.tech** and sign up (free)
2. Click **"New Project"**
3. Name it `swap-db`, select region `Asia Pacific (Singapore)` for low latency in India
4. Click **Create Project**
5. Copy the **Connection String** — it looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

---

## STEP 2: Run Database Migrations

```bash
# In your swap-backend/ folder:
cd swap-backend
cp .env.example .env
# Paste your DATABASE_URL in .env

npm install
node utils/migrate.js
```

You should see:
```
✅ All tables created successfully!
  • documents
  • medical_records
  • notifications
  • pets
  • qr_scans
  • society_pets
  • subscriptions
  • users
  • vaccines
  • vet_visits
```

---

## STEP 3: Set Up Google OAuth

1. Go to **https://console.cloud.google.com**
2. Create a new project (or select existing)
3. Go to **APIs & Services → OAuth consent screen**
   - User type: External
   - App name: `swaP`
   - Add your domain to authorized domains
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client IDs**
   - Application type: Web application
   - Name: `swaP Web`
   - **Authorized JavaScript Origins:**
     ```
     https://yourdomain.com
     http://localhost:3000
     ```
   - **Authorized Redirect URIs:**
     ```
     https://yourdomain.com/auth/google/callback
     http://localhost:3000/auth/google/callback
     ```
5. Copy `Client ID` and `Client Secret` to your `.env`

---

## STEP 4: Deploy to Vercel / Railway / Render

### Option A: Railway (Recommended for Node.js)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set environment variables in Railway dashboard:
# DATABASE_URL, SESSION_SECRET, GOOGLE_CLIENT_ID, etc.
```

### Option B: Render
1. Push code to GitHub
2. Go to **https://render.com** → New Web Service
3. Connect your GitHub repo
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Add all environment variables from `.env.example`

### Option C: Vercel (Serverless)
Vercel works best for the frontend. Use Railway/Render for the backend.

---

## STEP 5: Add Your Custom Domain

### In your hosting provider (Railway/Render):
1. Go to Settings → Custom Domain
2. Add `api.yourdomain.com` (for backend)
3. You'll get a CNAME record to add

### In your DNS provider:
```
Type: CNAME
Name: api
Value: yourapp.railway.app (or render.com URL)
TTL: 3600
```

### Frontend Domain:
If you're serving the frontend separately (e.g., on Vercel):
```
Type: A or CNAME
Name: @  (root domain)
Value: your frontend IP/CNAME
```

---

## STEP 6: Update .env for Production

```env
BASE_URL=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...@neon.tech/neondb?sslmode=require
SESSION_SECRET=<64-char random string>
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
```

Generate SESSION_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## STEP 7: Add Razorpay (When Ready)

1. Go to **https://dashboard.razorpay.com**
2. Complete KYC (required for live payments)
3. Go to **Settings → API Keys → Generate Live Key**
4. Add to `.env`:
   ```env
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=your_secret
   ```
5. Restart server — payments will activate automatically

---

## API Endpoints Reference

### Auth
| Method | URL | Description |
|--------|-----|-------------|
| POST | `/auth/signup` | Register new user |
| POST | `/auth/login` | Login with email+password |
| GET | `/auth/google` | Start Google OAuth |
| GET | `/auth/google/callback` | Google OAuth callback |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get current user |
| PUT | `/auth/profile` | Update profile |

### Pets
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/pets` | Get all user's pets |
| POST | `/api/pets` | Create new pet (auto-generates QR) |
| GET | `/api/pets/:id` | Get single pet |
| PUT | `/api/pets/:id` | Update pet |
| DELETE | `/api/pets/:id` | Delete pet |
| GET | `/api/pets/:id/qr` | Get QR code image |
| POST | `/api/pets/:id/qr/regenerate` | Regenerate QR code |
| GET | `/api/pets/:id/timeline` | Get full medical timeline |

### Medical
| Method | URL | Description |
|--------|-----|-------------|
| POST | `/api/medical/pets/:petId/vaccines` | Add vaccine |
| GET | `/api/medical/pets/:petId/vaccines` | Get vaccines |
| POST | `/api/medical/pets/:petId/visits` | Add vet visit |
| GET | `/api/medical/pets/:petId/visits` | Get vet visits |
| POST | `/api/medical/pets/:petId/records` | Add medical record |
| GET | `/api/medical/upcoming` | Get upcoming reminders |

### Dashboard
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/dashboard/summary` | Full dashboard data |
| GET | `/api/dashboard/notifications` | Get notifications |
| PUT | `/api/dashboard/notifications/read-all` | Mark all as read |

### Payments
| Method | URL | Description |
|--------|-----|-------------|
| POST | `/api/payments/create-order` | Create Razorpay order |
| POST | `/api/payments/verify` | Verify payment |
| GET | `/api/payments/status` | Get subscription status |

### Public (No Auth)
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/pet/:token` | Public pet profile via QR |
| GET | `/api/health` | Health check |

---

## How to View All Form Submissions (Admin Dashboard)

All user signups, pet registrations, and form data are stored in Neon.

**View in Neon Console:**
1. Go to https://console.neon.tech
2. Select your project → SQL Editor
3. Run queries like:
   ```sql
   -- All users who signed up
   SELECT id, name, email, role, plan, created_at FROM users ORDER BY created_at DESC;
   
   -- All pets registered
   SELECT p.name, p.species, p.breed, u.name AS owner, u.email, p.created_at 
   FROM pets p JOIN users u ON u.id = p.owner_id ORDER BY p.created_at DESC;
   
   -- Subscription revenue
   SELECT plan, billing_cycle, SUM(amount_inr) AS total_inr, COUNT(*) AS count
   FROM subscriptions WHERE status = 'active'
   GROUP BY plan, billing_cycle;
   
   -- QR scan activity
   SELECT p.name, COUNT(*) AS scans FROM qr_scans qs
   JOIN pets p ON p.id = qs.pet_id GROUP BY p.name ORDER BY scans DESC;
   ```

**Or call the admin API:**
```
GET /api/dashboard/admin/all-users
```
(Requires your user to have role = 'admin' in the database)

To make yourself admin:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```
