// utils/reminders.js — Daily vaccine & follow-up reminder emails
// Requires: node-cron, nodemailer (both in package.json)
// Cron fires daily at 8 AM IST (2:30 AM UTC)

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const db = require('./db');

// ── SMTP TRANSPORTER ──────────────────────────────────────
function createTransporter() {
  // Supports Gmail (with App Password) or any SMTP provider (Resend, Mailgun, etc.)
  // Set SMTP_HOST=smtp.gmail.com + SMTP_USER + SMTP_PASS in .env for Gmail
  // For Resend: SMTP_HOST=smtp.resend.com, SMTP_USER=resend, SMTP_PASS=<api-key>
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── EMAIL TEMPLATE ────────────────────────────────────────
function buildReminderEmail(userName, reminders) {
  const itemsHtml = reminders.map(r => {
    const daysLeft = Math.ceil((new Date(r.due_date) - new Date()) / (1000 * 60 * 60 * 24));
    const urgency = daysLeft <= 1 ? '#E05555' : daysLeft <= 3 ? '#F0A500' : '#4DB8AA';
    const label = daysLeft === 0 ? 'Due TODAY' : daysLeft === 1 ? 'Due tomorrow' : `Due in ${daysLeft} days`;
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #F0F4F8">
          <strong style="color:#141C27">${r.pet_name}</strong>
          <span style="color:#5A6677"> — ${r.title}</span>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #F0F4F8;white-space:nowrap">
          <span style="background:${urgency}1A;color:${urgency};font-weight:700;font-size:12px;padding:3px 10px;border-radius:100px">${label}</span>
        </td>
      </tr>`;
  }).join('');

  return {
    subject: `🐾 ${reminders.length} pet health reminder${reminders.length > 1 ? 's' : ''} — swaP`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7FA;font-family:'DM Sans',Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#4DB8AA,#3A9E92);padding:32px 40px">
      <div style="font-size:32px;margin-bottom:8px">🐾</div>
      <h1 style="margin:0;color:white;font-size:22px;font-weight:800">Pet Health Reminders</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px">Hi ${userName}, your pets need attention soon</p>
    </div>
    <div style="padding:32px 40px">
      <p style="color:#5A6677;margin:0 0 20px;font-size:15px">Here's what's coming up in the next 7 days:</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E2E8EF;border-radius:12px;overflow:hidden">
        <thead>
          <tr style="background:#F5F7FA">
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#9AAAB8">Pet / Item</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#9AAAB8">Due</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="margin-top:28px;text-align:center">
        <a href="${process.env.BASE_URL || 'https://swap.pet'}/dashboard.html"
           style="display:inline-block;background:#4DB8AA;color:white;font-weight:700;font-size:14px;padding:13px 32px;border-radius:100px;text-decoration:none">
          Open Dashboard →
        </a>
      </div>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #F0F4F8;text-align:center">
      <p style="color:#9AAAB8;font-size:12px;margin:0">
        You're receiving this because you have pets registered on 
        <a href="${process.env.BASE_URL || 'https://swap.pet'}" style="color:#4DB8AA">swaP</a>.
      </p>
    </div>
  </div>
</body>
</html>`,
  };
}

// ── CORE REMINDER LOGIC ───────────────────────────────────
async function sendReminders() {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('⚠️  Reminders skipped — SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');
    return;
  }

  try {
    // Fetch all users who have upcoming vaccine due dates or follow-up visits within 7 days
    const result = await db.query(`
      SELECT
        u.id       AS user_id,
        u.name     AS user_name,
        u.email,
        JSON_AGG(JSON_BUILD_OBJECT(
          'title',    r.title,
          'pet_name', r.pet_name,
          'due_date', r.due_date,
          'type',     r.type
        ) ORDER BY r.due_date ASC) AS reminders
      FROM users u
      JOIN (
        -- Vaccine reminders (7-day window)
        SELECT
          p.owner_id AS user_id,
          v.vaccine_name AS title,
          p.name AS pet_name,
          v.next_due_date AS due_date,
          'vaccine' AS type
        FROM vaccines v
        JOIN pets p ON p.id = v.pet_id
        WHERE v.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'

        UNION ALL

        -- Vet follow-up reminders (7-day window)
        SELECT
          p.owner_id,
          'Follow-up: ' || COALESCE(vv.reason, 'Vet visit'),
          p.name,
          vv.follow_up_date,
          'visit'
        FROM vet_visits vv
        JOIN pets p ON p.id = vv.pet_id
        WHERE vv.follow_up_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'

        UNION ALL

        -- Medical record reminders (7-day window)
        SELECT
          p.owner_id,
          mr.title,
          p.name,
          mr.next_due_date,
          'record'
        FROM medical_records mr
        JOIN pets p ON p.id = mr.pet_id
        WHERE mr.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ) r ON r.user_id = u.id
      GROUP BY u.id, u.name, u.email
    `);

    if (!result.rows.length) {
      console.log('✅ Reminders: no upcoming events in next 7 days');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const row of result.rows) {
      try {
        const { subject, html } = buildReminderEmail(row.user_name, row.reminders);

        await transporter.sendMail({
          from: `"swaP Reminders" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: row.email,
          subject,
          html,
        });

        // Insert in-app notification too
        for (const reminder of row.reminders) {
          const daysLeft = Math.ceil((new Date(reminder.due_date) - new Date()) / (1000 * 60 * 60 * 24));
          await db.query(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [
            row.user_id,
            `Reminder: ${reminder.title} for ${reminder.pet_name}`,
            `Due ${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}`,
            daysLeft <= 2 ? 'warning' : 'info',
          ]).catch(() => {}); // non-fatal
        }

        sent++;
      } catch (emailErr) {
        console.error(`Failed to send reminder to ${row.email}:`, emailErr.message);
        failed++;
      }
    }

    console.log(`📧 Reminders sent: ${sent} success, ${failed} failed`);
  } catch (err) {
    console.error('Reminder job error:', err);
  }
}

// ── SCHEDULE ──────────────────────────────────────────────
// Runs every day at 08:00 AM IST (02:30 AM UTC)
function startReminderJob() {
  cron.schedule('30 2 * * *', () => {
    console.log('⏰ Running daily vaccine reminder job...');
    sendReminders();
  }, {
    timezone: 'UTC',
  });

  console.log('✅ Vaccine reminder cron job scheduled (daily 8 AM IST)');
}

module.exports = { startReminderJob, sendReminders };
