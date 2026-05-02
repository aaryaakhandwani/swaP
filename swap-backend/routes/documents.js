// routes/documents.js — Document Vault (upload, list, delete)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

// ── CLOUDINARY CONFIG ─────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── MULTER (memory storage — we stream to Cloudinary) ─────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, and PNG files are allowed'), false);
    }
  },
});

router.use(requireAuth);

// Helper to verify pet ownership
async function verifyPetOwner(petId, userId) {
  const r = await db.query('SELECT id FROM pets WHERE id = $1 AND owner_id = $2', [petId, userId]);
  return r.rows.length > 0;
}

// ── UPLOAD DOCUMENT ───────────────────────────────────────
// POST /api/documents/pets/:petId/upload
router.post('/pets/:petId/upload', upload.single('document'), async (req, res) => {
  const userId = req.session.userId;
  const { petId } = req.params;

  if (!await verifyPetOwner(petId, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided. Attach a PDF, JPG, or PNG.' });
  }

  const { doc_type = 'other', title, linked_vaccine_id, linked_visit_id } = req.body;

  try {
    // Stream buffer to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `swap/pets/${petId}/documents`,
          resource_type: 'auto',          // handles both images and PDFs
          allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
          transformation: req.file.mimetype.startsWith('image/')
            ? [{ quality: 'auto', fetch_format: 'auto' }]
            : undefined,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Save metadata to DB
    const docTitle = title || req.file.originalname;
    const result = await db.query(`
      INSERT INTO documents (pet_id, uploaded_by, doc_type, title, file_url, file_size, mime_type, cloudinary_public_id, linked_vaccine_id, linked_visit_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      petId,
      userId,
      doc_type,
      docTitle,
      uploadResult.secure_url,
      req.file.size,
      req.file.mimetype,
      uploadResult.public_id,
      linked_vaccine_id || null,
      linked_visit_id || null,
    ]);

    // If linked to a vaccine, mark it as verified
    if (linked_vaccine_id) {
      await db.query(
        'UPDATE vaccines SET is_verified = TRUE, doc_url = $1 WHERE id = $2 AND pet_id = $3',
        [uploadResult.secure_url, linked_vaccine_id, petId]
      );
    }

    // If linked to a vet visit, mark it as verified
    if (linked_visit_id) {
      await db.query(
        'UPDATE vet_visits SET is_verified = TRUE WHERE id = $1 AND pet_id = $2',
        [linked_visit_id, petId]
      );
    }

    res.status(201).json({
      success: true,
      document: result.rows[0],
      message: `${docTitle} uploaded successfully`,
    });
  } catch (err) {
    console.error('Document upload error:', err);
    if (err.message.includes('Only PDF')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// ── LIST DOCUMENTS FOR A PET ──────────────────────────────
// GET /api/documents/pets/:petId
router.get('/pets/:petId', async (req, res) => {
  const userId = req.session.userId;
  if (!await verifyPetOwner(req.params.petId, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM documents WHERE pet_id = $1 ORDER BY created_at DESC',
      [req.params.petId]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ── DELETE DOCUMENT ───────────────────────────────────────
// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
  const userId = req.session.userId;
  try {
    const doc = await db.query(
      'SELECT d.*, p.owner_id FROM documents d JOIN pets p ON p.id = d.pet_id WHERE d.id = $1',
      [req.params.id]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'Document not found' });
    if (doc.rows[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    // Delete from Cloudinary
    if (doc.rows[0].cloudinary_public_id) {
      await cloudinary.uploader.destroy(doc.rows[0].cloudinary_public_id, {
        resource_type: doc.rows[0].mime_type === 'application/pdf' ? 'raw' : 'image',
      }).catch(console.error); // non-fatal if Cloudinary delete fails
    }

    await db.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Document deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ── MULTER ERROR HANDLER ──────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 10 MB.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
