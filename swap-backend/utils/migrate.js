// utils/migrate.js
// Run with: node utils/migrate.js
// Sets up all tables in Neon PostgreSQL

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const migrations = `
-- ═══════════════════════════════════════
-- swaP Database Schema — Neon PostgreSQL
-- ═══════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255),                          -- NULL for Google OAuth users
  name            VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  role            VARCHAR(30) NOT NULL DEFAULT 'parent', -- parent | breeder | vet | rwa
  avatar_url      TEXT,
  google_id       VARCHAR(255) UNIQUE,
  plan            VARCHAR(20) DEFAULT 'free',            -- free | essential | pro
  plan_expires_at TIMESTAMPTZ,
  is_verified     BOOLEAN DEFAULT FALSE,
  verify_token    VARCHAR(255),
  reset_token     VARCHAR(255),
  reset_expires   TIMESTAMPTZ,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── PETS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  species         VARCHAR(50) NOT NULL DEFAULT 'dog',    -- dog | cat | bird | rabbit | other
  breed           VARCHAR(100),
  date_of_birth   DATE,
  gender          VARCHAR(10),                           -- male | female | unknown
  color           VARCHAR(100),
  weight_kg       DECIMAL(5,2),
  microchip_id    VARCHAR(100),
  kci_number      VARCHAR(100),
  photo_url       TEXT,
  bio             TEXT,
  is_lost         BOOLEAN DEFAULT FALSE,
  is_public       BOOLEAN DEFAULT TRUE,
  qr_code_url     TEXT,
  qr_token        VARCHAR(100) UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── VACCINES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vaccines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  added_by        UUID REFERENCES users(id),
  vaccine_name    VARCHAR(200) NOT NULL,
  administered_on DATE NOT NULL,
  next_due_date   DATE,
  vet_name        VARCHAR(200),
  clinic_name     VARCHAR(200),
  batch_number    VARCHAR(100),
  notes           TEXT,
  doc_url         TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── VET VISITS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vet_visits (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  added_by        UUID REFERENCES users(id),
  visit_date      DATE NOT NULL,
  vet_name        VARCHAR(200),
  clinic_name     VARCHAR(200),
  reason          VARCHAR(500),
  diagnosis       TEXT,
  treatment       TEXT,
  prescription    TEXT,
  cost_inr        DECIMAL(10,2),
  follow_up_date  DATE,
  doc_url         TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── MEDICAL RECORDS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  added_by        UUID REFERENCES users(id),
  record_type     VARCHAR(100) NOT NULL,                -- deworming | grooming | surgery | allergy | prescription | lab | other
  title           VARCHAR(300) NOT NULL,
  description     TEXT,
  date_of         DATE NOT NULL,
  next_due_date   DATE,
  doc_url         TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── DOCUMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  uploaded_by     UUID REFERENCES users(id),
  title           VARCHAR(300) NOT NULL,
  doc_type        VARCHAR(100),                         -- vaccination | medical | id | kci | insurance | other
  file_url        TEXT NOT NULL,
  file_size_bytes BIGINT,
  is_verified     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS / PAYMENTS ─────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                VARCHAR(20) NOT NULL,             -- essential | pro
  billing_cycle       VARCHAR(10) DEFAULT 'monthly',   -- monthly | yearly
  amount_inr          DECIMAL(10,2) NOT NULL,
  currency            VARCHAR(5) DEFAULT 'INR',
  razorpay_order_id   VARCHAR(200),
  razorpay_payment_id VARCHAR(200),
  razorpay_signature  VARCHAR(500),
  status              VARCHAR(30) DEFAULT 'pending',   -- pending | active | failed | cancelled
  started_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── QR SCANS LOG ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_scans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  scanned_by      UUID REFERENCES users(id),           -- NULL if anonymous
  ip_address      VARCHAR(50),
  user_agent      TEXT,
  latitude        DECIMAL(9,6),
  longitude       DECIMAL(9,6),
  scanned_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── SOCIETY PETS (RWA Registry) ───────────────────────────
CREATE TABLE IF NOT EXISTS society_pets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rwa_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id          UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  apartment_no    VARCHAR(50),
  block           VARCHAR(50),
  approved        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rwa_user_id, pet_id)
);

-- ── NOTIFICATIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(300) NOT NULL,
  message         TEXT,
  type            VARCHAR(50) DEFAULT 'info',          -- info | warning | success | alert
  is_read         BOOLEAN DEFAULT FALSE,
  link            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pets_owner ON pets(owner_id);
CREATE INDEX IF NOT EXISTS idx_pets_qr_token ON pets(qr_token);
CREATE INDEX IF NOT EXISTS idx_vaccines_pet ON vaccines(pet_id);
CREATE INDEX IF NOT EXISTS idx_vet_visits_pet ON vet_visits(pet_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_pet ON medical_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_documents_pet ON documents(pet_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_pet ON qr_scans(pet_id);

-- ── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pets_updated_at ON pets;
CREATE TRIGGER pets_updated_at
  BEFORE UPDATE ON pets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations on Neon...');
    await client.query(migrations);
    console.log('✅ All tables created successfully!');
    console.log('\n📊 Tables created:');
    const res = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    res.rows.forEach(r => console.log(`  • ${r.table_name}`));
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch(console.error);
