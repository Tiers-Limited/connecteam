require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/connectteam',
  jwtSecret: process.env.JWT_SECRET || 'connectteam-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Same default as demo; set CONNECTEAMS_API_KEY in .env for production
  connecteamsApiKey: process.env.CONNECTEAMS_API_KEY || '3dd295c6-993d-461a-a91c-9aa96611fd77',
  connecteamsBase: process.env.CONNECTEAMS_BASE || 'https://api.connecteam.com',
};
