// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── DASHBOARD SUMMARY ─────────────────────────────────────
router.get('/summary', async (req, res) => {
  const userId = req.session.userId;
  try {
    const [userRes, petsRes, upcomingRes, scansRes, notifsRes] = await Promise.all([
      // User info
      db.query('SELECT id, name, email, role, plan, plan_expires_at, avatar_url FROM users WHERE id = $1', [userId]),
      
      // All pets with stats
      db.query(`
        SELECT p.id, p.name, p.species, p.breed, p.photo_url, p.qr_token, p.is_lost,
          (SELECT COUNT(*) FROM vaccines v WHERE v.pet_id = p.id) AS vaccines,
          (SELECT COUNT(*) FROM vet_visits vv WHERE vv.pet_id = p.id) AS visits,
          (SELECT COUNT(*) FROM documents d WHERE d.pet_id = p.id) AS documents,
          (SELECT COUNT(*) FROM qr_scans qs WHERE qs.pet_id = p.id) AS scans,
          (SELECT MIN(next_due_date) FROM vaccines v2 WHERE v2.pet_id = p.id AND v2.next_due_date > NOW()) AS next_vaccine_due,
          (SELECT MIN(follow_up_date) FROM vet_visits vv2 WHERE vv2.pet_id = p.id AND vv2.follow_up_date > NOW()) AS next_visit_due
        FROM pets p
        WHERE p.owner_id = $1
        ORDER BY p.created_at DESC
      `, [userId]),
      
      // Upcoming events (next 30 days)
      db.query(`
        SELECT 'vaccine' AS type, v.vaccine_name AS title, v.next_due_date AS due_date, p.name AS pet_name, p.id AS pet_id
        FROM vaccines v JOIN pets p ON p.id = v.pet_id
        WHERE p.owner_id = $1 AND v.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        UNION ALL
        SELECT 'visit', 'Follow-up: ' || COALESCE(vv.reason,'Checkup'), vv.follow_up_date, p.name, p.id
        FROM vet_visits vv JOIN pets p ON p.id = vv.pet_id
        WHERE p.owner_id = $1 AND vv.follow_up_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        UNION ALL
        SELECT 'record', mr.title, mr.next_due_date, p.name, p.id
        FROM medical_records mr JOIN pets p ON p.id = mr.pet_id
        WHERE p.owner_id = $1 AND mr.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        ORDER BY due_date ASC
        LIMIT 10
      `, [userId]),
      
      // QR scan activity (last 7 days)
      db.query(`
        SELECT DATE(qs.scanned_at) AS date, COUNT(*) AS scans
        FROM qr_scans qs
        JOIN pets p ON p.id = qs.pet_id
        WHERE p.owner_id = $1 AND qs.scanned_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(qs.scanned_at)
        ORDER BY date ASC
      `, [userId]),
      
      // Unread notifications
      db.query(`
        SELECT * FROM notifications 
        WHERE user_id = $1 AND is_read = FALSE 
        ORDER BY created_at DESC LIMIT 10
      `, [userId]),
    ]);
    
    const user = userRes.rows[0];
    const pets = petsRes.rows;
    
    // Aggregate stats
    const totalVaccines = pets.reduce((s, p) => s + parseInt(p.vaccines || 0), 0);
    const totalVisits = pets.reduce((s, p) => s + parseInt(p.visits || 0), 0);
    const totalScans = pets.reduce((s, p) => s + parseInt(p.scans || 0), 0);
    const lostPets = pets.filter(p => p.is_lost).length;
    
    res.json({
      user,
      stats: {
        total_pets: pets.length,
        total_vaccines: totalVaccines,
        total_visits: totalVisits,
        total_scans: totalScans,
        lost_pets: lostPets,
        upcoming_count: upcomingRes.rows.length,
        unread_notifications: notifsRes.rows.length,
      },
      pets,
      upcoming: upcomingRes.rows,
      scan_activity: scansRes.rows,
      notifications: notifsRes.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ── NOTIFICATIONS ─────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
      [userId]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  const userId = req.session.userId;
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.put('/notifications/read-all', async (req, res) => {
  const userId = req.session.userId;
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ── ADMIN: Get all form submissions (for swaP admin) ─────
router.get('/admin/all-users', async (req, res) => {
  const userId = req.session.userId;
  try {
    // Only admins can access this
    const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0]?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const result = await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.plan, u.is_verified, u.created_at,
        (SELECT COUNT(*) FROM pets p WHERE p.owner_id = u.id) AS pet_count,
        (SELECT plan FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) AS active_plan
      FROM users u
      ORDER BY u.created_at DESC
    `);
    
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

module.exports = router;
