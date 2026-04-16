const path = require('path');
// Load env from backend/.env first, then repo-root .env (cwd may be repo root).
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const Admin = require('../models/Admin');
const connectDB = require('../config/db');

const ADMIN_EMAIL = 'admin@connectteam.com';
const ADMIN_PASSWORD = 'admin123';

async function createAdmin() {
  await connectDB();

  const existing = await Admin.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    console.log('Admin already exists with email:', ADMIN_EMAIL);
    process.exit(0);
    return;
  }

  const admin = new Admin({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: 'admin',
  });
  await admin.save();
  console.log('Admin created successfully.');
  console.log('  Email:', ADMIN_EMAIL);
  console.log('  Password:', ADMIN_PASSWORD);
  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('Error creating admin:', err);
  process.exit(1);
});
