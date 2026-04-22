// routes/pets.js
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');
const { generateQRToken, generateQRCode, generateQRCodeSVG } = require('../utils/qr');

// All pet routes require auth
router.use(requireAuth);

// ── GET ALL PETS FOR USER ──────────────────────────────────
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM vaccines v WHERE v.pet_id = p.id) AS vaccine_count,
        (SELECT COUNT(*) FROM vet_visits vv WHERE vv.pet_id = p.id) AS visit_count,
        (SELECT COUNT(*) FROM medical_records mr WHERE mr.pet_id = p.id) AS record_count,
        (SELECT COUNT(*) FROM qr_scans qs WHERE qs.pet_id = p.id) AS scan_count,
        (SELECT MAX(next_due_date) FROM vaccines v2 WHERE v2.pet_id = p.id AND v2.next_due_date > NOW()) AS next_vaccine
      FROM pets p
      WHERE p.owner_id = $1
      ORDER BY p.created_at DESC
    `, [userId]);
    res.json({ pets: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pets' });
  }
});

// ── GET SINGLE PET ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(
      'SELECT * FROM pets WHERE id = $1 AND owner_id = $2', 
      [req.params.id, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pet not found' });
    res.json({ pet: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pet' });
  }
});

// ── CREATE PET ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  const userId = req.session.userId;
  const { name, species, breed, date_of_birth, gender, color, weight_kg, microchip_id, kci_number, bio } = req.body;
  
  if (!name) return res.status(400).json({ error: 'Pet name is required' });
  
  try {
    // Check pet limit for free plan
    const user = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    const plan = user.rows[0]?.plan || 'free';
    const petCount = await db.query('SELECT COUNT(*) FROM pets WHERE owner_id = $1', [userId]);
    
    if (plan === 'free' && parseInt(petCount.rows[0].count) >= 2) {
      return res.status(403).json({ 
        error: 'Free plan supports up to 2 pets. Upgrade to Essential or Pro for unlimited pets.',
        upgrade: true
      });
    }
    
    // Generate unique QR token
    const qrToken = generateQRToken();
    const baseUrl = process.env.BASE_URL || 'https://swap.pet';
    const { qrDataUrl } = await generateQRCode(null, qrToken, baseUrl);
    
    const result = await db.query(`
      INSERT INTO pets (owner_id, name, species, breed, date_of_birth, gender, color, weight_kg, microchip_id, kci_number, bio, qr_token, qr_code_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [userId, name, species || 'dog', breed, date_of_birth, gender, color, weight_kg, microchip_id, kci_number, bio, qrToken, qrDataUrl]);
    
    const pet = result.rows[0];
    
    // Auto-create notification
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, 'success')
    `, [userId, `${name}'s profile created! 🐾`, `Your pet ${name} has been registered with QR code. Attach it to their collar!`]);
    
    res.status(201).json({ success: true, pet, message: `${name} added successfully!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pet' });
  }
});

// ── UPDATE PET ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const userId = req.session.userId;
  const { name, species, breed, date_of_birth, gender, color, weight_kg, microchip_id, kci_number, bio, is_lost, is_public } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE pets SET
        name = COALESCE($1, name),
        species = COALESCE($2, species),
        breed = COALESCE($3, breed),
        date_of_birth = COALESCE($4, date_of_birth),
        gender = COALESCE($5, gender),
        color = COALESCE($6, color),
        weight_kg = COALESCE($7, weight_kg),
        microchip_id = COALESCE($8, microchip_id),
        kci_number = COALESCE($9, kci_number),
        bio = COALESCE($10, bio),
        is_lost = COALESCE($11, is_lost),
        is_public = COALESCE($12, is_public),
        updated_at = NOW()
      WHERE id = $13 AND owner_id = $14
      RETURNING *
    `, [name, species, breed, date_of_birth, gender, color, weight_kg, microchip_id, kci_number, bio, is_lost, is_public, req.params.id, userId]);
    
    if (!result.rows.length) return res.status(404).json({ error: 'Pet not found' });
    res.json({ success: true, pet: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pet' });
  }
});

// ── DELETE PET ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(
      'DELETE FROM pets WHERE id = $1 AND owner_id = $2 RETURNING name', 
      [req.params.id, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pet not found' });
    res.json({ success: true, message: `${result.rows[0].name} removed` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete pet' });
  }
});

// ── GET QR CODE ────────────────────────────────────────────
router.get('/:id/qr', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(
      'SELECT qr_token, qr_code_url, name FROM pets WHERE id = $1 AND owner_id = $2',
      [req.params.id, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pet not found' });
    const pet = result.rows[0];
    const baseUrl = process.env.BASE_URL || 'https://swap.pet';
    const publicUrl = `${baseUrl}/pet/${pet.qr_token}`;
    res.json({ qr_code: pet.qr_code_url, public_url: publicUrl, pet_name: pet.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get QR code' });
  }
});

// ── REGENERATE QR ──────────────────────────────────────────
router.post('/:id/qr/regenerate', async (req, res) => {
  const userId = req.session.userId;
  try {
    const qrToken = generateQRToken();
    const baseUrl = process.env.BASE_URL || 'https://swap.pet';
    const { qrDataUrl } = await generateQRCode(null, qrToken, baseUrl);
    
    await db.query(
      'UPDATE pets SET qr_token = $1, qr_code_url = $2 WHERE id = $3 AND owner_id = $4',
      [qrToken, qrDataUrl, req.params.id, userId]
    );
    
    res.json({ success: true, qr_code: qrDataUrl, public_url: `${baseUrl}/pet/${qrToken}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate QR' });
  }
});

// ── GET PET FULL TIMELINE ──────────────────────────────────
router.get('/:id/timeline', async (req, res) => {
  const userId = req.session.userId;
  try {
    // Verify ownership
    const petCheck = await db.query('SELECT id FROM pets WHERE id = $1 AND owner_id = $2', [req.params.id, userId]);
    if (!petCheck.rows.length) return res.status(404).json({ error: 'Pet not found' });
    
    const [vaccines, visits, records, documents] = await Promise.all([
      db.query('SELECT *, \'vaccine\' AS entry_type FROM vaccines WHERE pet_id = $1 ORDER BY administered_on DESC', [req.params.id]),
      db.query('SELECT *, \'visit\' AS entry_type FROM vet_visits WHERE pet_id = $1 ORDER BY visit_date DESC', [req.params.id]),
      db.query('SELECT *, \'record\' AS entry_type FROM medical_records WHERE pet_id = $1 ORDER BY date_of DESC', [req.params.id]),
      db.query('SELECT *, \'document\' AS entry_type FROM documents WHERE pet_id = $1 ORDER BY created_at DESC', [req.params.id]),
    ]);
    
    res.json({
      vaccines: vaccines.rows,
      vet_visits: visits.rows,
      medical_records: records.rows,
      documents: documents.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

module.exports = router;
