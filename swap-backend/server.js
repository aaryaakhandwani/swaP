// server.js — swaP Backend API
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./utils/db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── TRUST PROXY (required for secure cookies on Render) ───
app.set('trust proxy', 1);

// ── SECURITY MIDDLEWARE ────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000', BASE_URL],
  credentials: true,
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

app.use('/api/', apiLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/signup', authLimiter);

// ── BODY PARSING ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── SESSIONS ───────────────────────────────────────────────
const pgSession = require('connect-pg-simple')(session);

app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'swap-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
  name: 'swap.sid',
}));

// ── PASSPORT GOOGLE OAUTH ──────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const name = profile.displayName;
      const googleId = profile.id;
      const avatarUrl = profile.photos?.[0]?.value;

      let result = await db.query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email]);

      if (result.rows.length) {
        const user = result.rows[0];
        await db.query(
          'UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), last_login = NOW() WHERE id = $3',
          [googleId, avatarUrl, user.id]
        );
        return done(null, user);
      } else {
        const newUser = await db.query(`
          INSERT INTO users (name, email, google_id, avatar_url, is_verified, last_login)
          VALUES ($1, $2, $3, $4, TRUE, NOW())
          RETURNING *
        `, [name, email, googleId, avatarUrl]);
        return done(null, newUser.rows[0]);
      }
    } catch (err) {
      return done(err, null);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, result.rows[0] || false);
    } catch (err) {
      done(err, null);
    }
  });

  console.log('✅ Google OAuth configured');
} else {
  console.log('⚠️  GOOGLE_CLIENT_ID/SECRET not set — Google login disabled');
}

// ── STATIC FILES (serve frontend) ─────────────────────────
app.use(express.static(path.join(__dirname, '../project')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API ROUTES ─────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/api/pets', require('./routes/pets'));
app.use('/api/medical', require('./routes/medical'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/payments', require('./routes/payments'));

// ── PUBLIC PET PROFILE (QR scan destination) ──────────────
app.get('/pet/:token', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.name AS owner_name
      FROM pets p
      JOIN users u ON u.id = p.owner_id
      WHERE p.qr_token = $1 AND p.is_public = TRUE
    `, [req.params.token]);

    if (!result.rows.length) {
      return res.status(404).send(`
        <!DOCTYPE html><html><head><title>Pet Not Found — swaP</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F5F7FA;}
        .box{text-align:center;padding:40px;background:white;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.1);}
        h1{font-size:28px;color:#141C27;}p{color:#5A6677;margin-top:8px;}</style>
        </head><body><div class="box"><div style="font-size:64px">🐾</div>
        <h1>Pet profile not found</h1>
        <p>This QR code may be inactive or the pet's profile is private.</p>
        <a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4DB8AA;color:white;border-radius:100px;text-decoration:none;font-weight:600">Visit swaP →</a>
        </div></body></html>
      `);
    }

    const pet = result.rows[0];

    await db.query(
      'INSERT INTO qr_scans (pet_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [pet.id, req.ip, req.headers['user-agent']]
    ).catch(console.error);

    const [vaccines, visits] = await Promise.all([
      db.query('SELECT * FROM vaccines WHERE pet_id = $1 ORDER BY administered_on DESC LIMIT 5', [pet.id]),
      db.query('SELECT * FROM vet_visits WHERE pet_id = $1 ORDER BY visit_date DESC LIMIT 3', [pet.id]),
    ]);

    res.send(renderPublicPetProfile(pet, vaccines.rows, visits.rows));
  } catch (err) {
    console.error('QR scan error:', err);
    res.status(500).send('Error loading pet profile');
  }
});

function renderPublicPetProfile(pet, vaccines, visits) {
  const age = pet.date_of_birth
    ? Math.floor((Date.now() - new Date(pet.date_of_birth)) / (365.25 * 24 * 3600 * 1000))
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pet.name} — swaP Pet Profile</title>
  <meta property="og:title" content="${pet.name} — swaP Pet Profile">
  <meta property="og:description" content="${pet.breed || pet.species} • Registered on swaP Platform">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#F5F7FA;min-height:100vh;color:#141C27}
    .hero{background:linear-gradient(135deg,#4DB8AA 0%,#3A9E92 100%);padding:48px 24px 80px;text-align:center;position:relative}
    .pet-avatar{width:100px;height:100px;border-radius:50%;background:white;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:48px;border:4px solid rgba(255,255,255,.5);box-shadow:0 8px 32px rgba(0,0,0,.15)}
    .pet-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
    .pet-name{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;color:white;margin-bottom:6px}
    .pet-breed{font-size:15px;color:rgba(255,255,255,.85)}
    .lost-badge{display:inline-block;background:#E05555;color:white;font-weight:700;font-size:13px;padding:5px 16px;border-radius:100px;margin-top:12px;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
    .verified-badge{display:inline-block;background:rgba(255,255,255,.2);color:white;font-size:12px;font-weight:600;padding:4px 12px;border-radius:100px;margin-top:10px}
    .card{background:white;border-radius:20px;padding:24px;margin:0 16px;box-shadow:0 4px 20px rgba(0,0,0,.07);margin-top:-40px;position:relative}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
    .info-item label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#9AAAB8;display:block;margin-bottom:3px}
    .info-item span{font-size:14px;font-weight:600;color:#141C27}
    .section-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#141C27;margin-bottom:12px}
    .vaccine-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#F5F7FA;border-radius:10px;margin-bottom:8px}
    .vaccine-icon{width:32px;height:32px;background:#E8F6F4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
    .vaccine-name{font-size:13px;font-weight:600;color:#141C27}
    .vaccine-date{font-size:11.5px;color:#9AAAB8}
    .section{margin-top:20px}
    .footer{text-align:center;padding:32px 24px;color:#9AAAB8;font-size:13px}
    .footer a{color:#4DB8AA;font-weight:600;text-decoration:none}
    .cta{display:inline-block;background:#4DB8AA;color:white;font-weight:700;font-size:14px;padding:12px 28px;border-radius:100px;text-decoration:none;margin-top:16px;box-shadow:0 6px 24px rgba(77,184,170,.3)}
    .no-data{color:#9AAAB8;font-size:13px;text-align:center;padding:16px}
  </style>
</head>
<body>
  <div class="hero">
    <div class="pet-avatar">
      ${pet.photo_url ? `<img src="${pet.photo_url}" alt="${pet.name}">` : pet.species === 'dog' ? '🐕' : pet.species === 'cat' ? '🐈' : '🐾'}
    </div>
    <div class="pet-name">${pet.name}</div>
    <div class="pet-breed">${pet.breed || pet.species}${age ? ` • ${age} year${age !== 1 ? 's' : ''} old` : ''}</div>
    <div class="verified-badge">✓ swaP Verified</div>
    ${pet.is_lost ? '<div class="lost-badge">🚨 LOST PET — Please contact owner</div>' : ''}
  </div>

  <div class="card">
    <div class="info-grid">
      <div class="info-item"><label>Species</label><span>${pet.species?.charAt(0).toUpperCase() + pet.species?.slice(1) || '—'}</span></div>
      <div class="info-item"><label>Gender</label><span>${pet.gender || '—'}</span></div>
      <div class="info-item"><label>Color</label><span>${pet.color || '—'}</span></div>
      <div class="info-item"><label>Weight</label><span>${pet.weight_kg ? pet.weight_kg + ' kg' : '—'}</span></div>
      ${pet.microchip_id ? `<div class="info-item"><label>Microchip</label><span>${pet.microchip_id}</span></div>` : ''}
      ${pet.kci_number ? `<div class="info-item"><label>KCI No.</label><span>${pet.kci_number}</span></div>` : ''}
    </div>
    ${pet.bio ? `<p style="font-size:14px;color:#5A6677;line-height:1.7;border-top:1px solid #E2E8EF;padding-top:16px">${pet.bio}</p>` : ''}
  </div>

  <div style="margin:16px">
    ${vaccines.length ? `
    <div class="section">
      <div class="section-title">💉 Recent Vaccinations</div>
      ${vaccines.map(v => `
        <div class="vaccine-item">
          <div class="vaccine-icon">💉</div>
          <div>
            <div class="vaccine-name">${v.vaccine_name}</div>
            <div class="vaccine-date">${new Date(v.administered_on).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}${v.next_due_date ? ` · Next: ${new Date(v.next_due_date).toLocaleDateString('en-IN', {day:'numeric',month:'short'})}` : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    ${visits.length ? `
    <div class="section">
      <div class="section-title">🏥 Recent Vet Visits</div>
      ${visits.map(v => `
        <div class="vaccine-item">
          <div class="vaccine-icon">🏥</div>
          <div>
            <div class="vaccine-name">${v.reason || 'Checkup'}</div>
            <div class="vaccine-date">${new Date(v.visit_date).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}${v.vet_name ? ` · Dr. ${v.vet_name}` : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}
  </div>

  <div class="footer">
    <p>This pet is registered on</p>
    <a href="/">swaP — India's First Pet Intelligence Platform</a>
    <br>
    <a href="/signup.html" class="cta">Register your pet for free →</a>
  </div>
</body>
</html>`;
}

// ── HEALTH CHECK ───────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'ok',
      db: 'connected',
      google_auth: !!process.env.GOOGLE_CLIENT_ID,
      razorpay: !!process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ── CATCH ALL (SPA) ────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) {
    res.sendFile(path.join(__dirname, '../project/index.html'));
  } else {
    res.status(404).json({ error: 'Route not found' });
  }
});

// ── START SERVER ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐾 swaP Backend running on port ${PORT}`);
  console.log(`   • Local:   http://localhost:${PORT}`);
  console.log(`   • API:     http://localhost:${PORT}/api/health`);
  console.log(`   • DB:      ${process.env.DATABASE_URL ? '✅ Neon configured' : '❌ DATABASE_URL not set'}`);
  console.log(`   • Google:  ${process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   • Razorpay:${process.env.RAZORPAY_KEY_ID ? '✅ Configured' : '⚠️  Not configured (add later)'}\n`);
});

module.exports = app;
app.get('/debug-session', (req, res) => {
  res.json({
    sessionID: req.sessionID,
    session: req.session,
    user: req.user,
    cookies: req.headers.cookie
  });
});