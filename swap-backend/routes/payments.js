// routes/payments.js
// Razorpay integration — fill in RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');

// Initialize Razorpay (only if keys are available)
let razorpay = null;
try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('✅ Razorpay initialized');
  } else {
    console.log('⚠️  Razorpay keys not set — payments disabled');
  }
} catch (e) {
  console.log('⚠️  Razorpay not available:', e.message);
}

const PLANS = {
  essential_monthly: { name: 'Essential', amount: 4900,  currency: 'INR', cycle: 'monthly', duration_days: 30 },
  essential_yearly:  { name: 'Essential', amount: 34800, currency: 'INR', cycle: 'yearly',  duration_days: 365 },
  pro_monthly:       { name: 'Pro',       amount: 9900,  currency: 'INR', cycle: 'monthly', duration_days: 30 },
  pro_yearly:        { name: 'Pro',       amount: 94800, currency: 'INR', cycle: 'yearly',  duration_days: 365 },
};

// ── CREATE RAZORPAY ORDER ──────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  if (!razorpay) {
    return res.status(503).json({ error: 'Payment service not configured. Please try again later.' });
  }
  
  const userId = req.session.userId;
  const { plan_key } = req.body; // e.g., 'essential_monthly'
  const plan = PLANS[plan_key];
  
  if (!plan) return res.status(400).json({ error: 'Invalid plan selected' });
  
  try {
    const order = await razorpay.orders.create({
      amount: plan.amount, // in paise
      currency: plan.currency,
      receipt: `swap_${userId.substring(0, 8)}_${Date.now()}`,
      notes: {
        user_id: userId,
        plan: plan_key,
        plan_name: plan.name,
      }
    });
    
    // Save pending subscription
    await db.query(`
      INSERT INTO subscriptions (user_id, plan, billing_cycle, amount_inr, razorpay_order_id, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `, [userId, plan.name.toLowerCase(), plan.cycle, plan.amount / 100, order.id]);
    
    res.json({
      order_id: order.id,
      amount: plan.amount,
      currency: plan.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      plan_name: plan.name,
    });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ── VERIFY PAYMENT ─────────────────────────────────────────
router.post('/verify', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_key } = req.body;
  
  if (!razorpay) return res.status(503).json({ error: 'Payment service not configured' });
  
  // Verify signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  
  if (expectedSig !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }
  
  const plan = PLANS[plan_key];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);
    
    // Update subscription record
    await db.query(`
      UPDATE subscriptions 
      SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'active',
          started_at = NOW(), expires_at = $3
      WHERE razorpay_order_id = $4 AND user_id = $5
    `, [razorpay_payment_id, razorpay_signature, expiresAt, razorpay_order_id, userId]);
    
    // Upgrade user plan
    await db.query(`
      UPDATE users SET plan = $1, plan_expires_at = $2 WHERE id = $3
    `, [plan.name.toLowerCase(), expiresAt, userId]);
    
    // Create success notification
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, 'success')
    `, [userId, `Welcome to swaP ${plan.name}! 🎉`, `Your ${plan.name} plan is active until ${expiresAt.toLocaleDateString('en-IN')}`]);
    
    // Update session
    req.session.user = { ...req.session.user, plan: plan.name.toLowerCase() };
    
    res.json({
      success: true,
      message: `${plan.name} plan activated!`,
      plan: plan.name.toLowerCase(),
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: 'Payment recorded but plan activation failed. Contact support.' });
  }
});

// ── WEBHOOK (for auto-renewal, refunds) ──────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(200).send('OK');
  
  const sig = req.headers['x-razorpay-signature'];
  const body = req.body;
  
  const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
  if (expected !== sig) return res.status(400).send('Invalid signature');
  
  const event = JSON.parse(body);
  console.log('Razorpay webhook event:', event.event);
  
  // Handle events as needed
  res.status(200).send('OK');
});

// ── GET SUBSCRIPTION STATUS ────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const [userRes, subRes] = await Promise.all([
      db.query('SELECT plan, plan_expires_at FROM users WHERE id = $1', [userId]),
      db.query(`
        SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' 
        ORDER BY created_at DESC LIMIT 1
      `, [userId]),
    ]);
    
    const user = userRes.rows[0];
    const sub = subRes.rows[0];
    const isActive = user.plan_expires_at ? new Date(user.plan_expires_at) > new Date() : user.plan === 'free';
    
    res.json({
      plan: user.plan,
      expires_at: user.plan_expires_at,
      is_active: isActive,
      subscription: sub || null,
      razorpay_enabled: !!razorpay,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

module.exports = router;
