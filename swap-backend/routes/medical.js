// routes/medical.js
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Helper to verify pet ownership
async function verifyPetOwner(petId, userId) {
  const r = await db.query('SELECT id FROM pets WHERE id = $1 AND owner_id = $2', [petId, userId]);
  return r.rows.length > 0;
}

// ══ VACCINES ═════════════════════════════════════════════

// Add vaccine
router.post('/pets/:petId/vaccines', async (req, res) => {
  const userId = req.session.userId;
  const { petId } = req.params;
  if (!await verifyPetOwner(petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  const { vaccine_name, administered_on, next_due_date, vet_name, clinic_name, batch_number, notes } = req.body;
  if (!vaccine_name || !administered_on) return res.status(400).json({ error: 'Vaccine name and date required' });
  
  try {
    const result = await db.query(`
      INSERT INTO vaccines (pet_id, added_by, vaccine_name, administered_on, next_due_date, vet_name, clinic_name, batch_number, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [petId, userId, vaccine_name, administered_on, next_due_date, vet_name, clinic_name, batch_number, notes]);
    
    // Create reminder notification if next_due_date is set
    if (next_due_date) {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type)
        VALUES ($1, $2, $3, 'info')
      `, [userId, `Vaccine recorded for ${vaccine_name}`, `Next dose due on ${new Date(next_due_date).toLocaleDateString('en-IN')}`]);
    }
    
    res.status(201).json({ success: true, vaccine: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add vaccine' });
  }
});

// Get vaccines for pet
router.get('/pets/:petId/vaccines', async (req, res) => {
  const userId = req.session.userId;
  if (!await verifyPetOwner(req.params.petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  try {
    const result = await db.query(
      'SELECT * FROM vaccines WHERE pet_id = $1 ORDER BY administered_on DESC', 
      [req.params.petId]
    );
    res.json({ vaccines: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vaccines' });
  }
});

// Delete vaccine
router.delete('/vaccines/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const v = await db.query('SELECT pet_id FROM vaccines WHERE id = $1', [req.params.id]);
    if (!v.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!await verifyPetOwner(v.rows[0].pet_id, userId)) return res.status(403).json({ error: 'Access denied' });
    await db.query('DELETE FROM vaccines WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vaccine' });
  }
});

// ══ VET VISITS ═══════════════════════════════════════════

router.post('/pets/:petId/visits', async (req, res) => {
  const userId = req.session.userId;
  const { petId } = req.params;
  if (!await verifyPetOwner(petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  const { visit_date, vet_name, clinic_name, reason, diagnosis, treatment, prescription, cost_inr, follow_up_date } = req.body;
  if (!visit_date) return res.status(400).json({ error: 'Visit date required' });
  
  try {
    const result = await db.query(`
      INSERT INTO vet_visits (pet_id, added_by, visit_date, vet_name, clinic_name, reason, diagnosis, treatment, prescription, cost_inr, follow_up_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [petId, userId, visit_date, vet_name, clinic_name, reason, diagnosis, treatment, prescription, cost_inr, follow_up_date]);
    
    res.status(201).json({ success: true, visit: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add vet visit' });
  }
});

router.get('/pets/:petId/visits', async (req, res) => {
  const userId = req.session.userId;
  if (!await verifyPetOwner(req.params.petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  try {
    const result = await db.query(
      'SELECT * FROM vet_visits WHERE pet_id = $1 ORDER BY visit_date DESC', 
      [req.params.petId]
    );
    res.json({ visits: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

router.delete('/visits/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const v = await db.query('SELECT pet_id FROM vet_visits WHERE id = $1', [req.params.id]);
    if (!v.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!await verifyPetOwner(v.rows[0].pet_id, userId)) return res.status(403).json({ error: 'Access denied' });
    await db.query('DELETE FROM vet_visits WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete visit' });
  }
});

// ══ MEDICAL RECORDS ═══════════════════════════════════════

router.post('/pets/:petId/records', async (req, res) => {
  const userId = req.session.userId;
  const { petId } = req.params;
  if (!await verifyPetOwner(petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  const { record_type, title, description, date_of, next_due_date } = req.body;
  if (!title || !date_of) return res.status(400).json({ error: 'Title and date required' });
  
  try {
    const result = await db.query(`
      INSERT INTO medical_records (pet_id, added_by, record_type, title, description, date_of, next_due_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [petId, userId, record_type || 'other', title, description, date_of, next_due_date]);
    
    res.status(201).json({ success: true, record: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add record' });
  }
});

router.get('/pets/:petId/records', async (req, res) => {
  const userId = req.session.userId;
  if (!await verifyPetOwner(req.params.petId, userId)) return res.status(403).json({ error: 'Access denied' });
  
  try {
    const result = await db.query(
      'SELECT * FROM medical_records WHERE pet_id = $1 ORDER BY date_of DESC', 
      [req.params.petId]
    );
    res.json({ records: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

router.delete('/records/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const r = await db.query('SELECT pet_id FROM medical_records WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!await verifyPetOwner(r.rows[0].pet_id, userId)) return res.status(403).json({ error: 'Access denied' });
    await db.query('DELETE FROM medical_records WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

// ══ UPCOMING / REMINDERS ══════════════════════════════════

router.get('/upcoming', async (req, res) => {
  const userId = req.session.userId;
  try {
    const result = await db.query(`
      SELECT 
        'vaccine' AS type,
        v.vaccine_name AS title,
        v.next_due_date AS due_date,
        p.name AS pet_name,
        p.id AS pet_id
      FROM vaccines v
      JOIN pets p ON p.id = v.pet_id
      WHERE p.owner_id = $1 AND v.next_due_date >= NOW() AND v.next_due_date <= NOW() + INTERVAL '30 days'
      
      UNION ALL
      
      SELECT 
        'visit' AS type,
        'Vet Follow-up: ' || vv.reason AS title,
        vv.follow_up_date AS due_date,
        p.name AS pet_name,
        p.id AS pet_id
      FROM vet_visits vv
      JOIN pets p ON p.id = vv.pet_id
      WHERE p.owner_id = $1 AND vv.follow_up_date >= NOW() AND vv.follow_up_date <= NOW() + INTERVAL '30 days'
      
      UNION ALL
      
      SELECT 
        'record' AS type,
        mr.title,
        mr.next_due_date AS due_date,
        p.name AS pet_name,
        p.id AS pet_id
      FROM medical_records mr
      JOIN pets p ON p.id = mr.pet_id
      WHERE p.owner_id = $1 AND mr.next_due_date >= NOW() AND mr.next_due_date <= NOW() + INTERVAL '30 days'
      
      ORDER BY due_date ASC
    `, [userId]);
    
    res.json({ upcoming: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

module.exports = router;
