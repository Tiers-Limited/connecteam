const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../env'), quiet: true });

function parseCsvEnv(name) {
  const raw = process.env[name];
  if (raw == null || !String(raw).trim()) return null;
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/connectteam',
  jwtSecret: process.env.JWT_SECRET || 'connectteam-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  connecteamsApiKey: process.env.CONNECTEAMS_API_KEY || '3dd295c6-993d-461a-a91c-9aa96611fd77',
  connecteamsBase: process.env.CONNECTEAMS_BASE || 'https://api.connecteam.com',
  /** Comma-separated time clock IDs, e.g. 13138505 */
  connecteamTimeClockIds: parseCsvEnv('CONNECTEAM_TIME_CLOCK_IDS'),
  /** Comma-separated name substrings; default SANTOS (restaurant ops clock) */
  connecteamTimeClockNames: parseCsvEnv('CONNECTEAM_TIME_CLOCK_NAMES') || ['SANTOS'],
  emailUser: process.env.EMAIL_USER,
  emailPass: process.env.EMAIL_PASS,
  emailFrom: process.env.EMAIL_FROM,
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
};
