/**
 * Run this script once to create the admin user.
 * Usage: node scripts/createAdmin.js
 *
 * Admin credentials:
 *   Email: admin@connecteam.com (see ADMIN_EMAIL below)
 *   Password: admin@123
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const connectDB = require('../config/db');

const ADMIN_EMAIL = 'admin@connecteam.com';
const ADMIN_PASSWORD = 'admin.123';

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
