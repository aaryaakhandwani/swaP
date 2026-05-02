// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const passport = require('passport');
const db = require('../utils/db');

// ── SIGNUP ────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  try {
    // Check if email exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already registered. Please log in.' });
    }
    
    const passwordHash = await bcrypt.hash(password, 12);
    const validRoles = ['parent', 'breeder', 'vet', 'rwa'];
    const userRole = validRoles.includes(role) ? role : 'parent';
    
    const result = await db.query(`
      INSERT INTO users (name, email, password_hash, phone, role, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, plan, created_at
    `, [name, email.toLowerCase(), passwordHash, phone || null, userRole, false]);
    
    const user = result.rows[0];
    
    // Auto-login after signup
    req.session.userId = user.id;
    req.session.user = user;
    
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan },
      redirect: '/dashboard.html'
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    
    if (!user.password_hash) {
      return res.status(401).json({ 
        error: 'This account uses Google login. Please sign in with Google.' 
      });
    }
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    
    req.session.userId = user.id;
    req.session.user = {
      id: user.id, name: user.name, email: user.email,
      role: user.role, plan: user.plan, avatar_url: user.avatar_url
    };
    
    res.json({
      success: true,
      user: req.session.user,
      redirect: '/dashboard.html'
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GOOGLE OAUTH ──────────────────────────────────────────
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=google_failed' }),
  (req, res) => {
    req.session.userId = req.user.id;
    req.session.user = {
      id: req.user.id, name: req.user.name, email: req.user.email,
      role: req.user.role, plan: req.user.plan, avatar_url: req.user.avatar_url
    };
    res.redirect('/dashboard.html');
  }
);

// ── LOGOUT ────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('connect.sid');
    res.json({ success: true, redirect: '/login.html' });
  });
});

// ── GET CURRENT USER ──────────────────────────────────────
router.get('/me', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const result = await db.query(
      'SELECT id, name, email, phone, role, plan, avatar_url, is_verified, created_at, last_login FROM users WHERE id = $1',
      [userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── UPDATE PROFILE ────────────────────────────────────────
router.put('/profile', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  
  const { name, phone } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE users SET name = $1, phone = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, name, email, phone, role, plan
    `, [name, phone, userId]);
    
    req.session.user = { ...req.session.user, name, phone };
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── CHANGE PASSWORD ───────────────────────────────────────
router.post('/change-password', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  
  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    
    if (user.password_hash) {
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
