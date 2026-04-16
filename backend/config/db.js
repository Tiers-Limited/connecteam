const mongoose = require('mongoose');
const dns = require('dns');

const DEFAULT_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

function configureDnsServers() {
  const configuredServers = (process.env.DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  const serversToUse = configuredServers.length > 0 ? configuredServers : DEFAULT_DNS_SERVERS;

  try {
    dns.setServers(serversToUse);
  } catch (error) {
    console.warn('DNS server configuration warning:', error.message);
  }
}

const connectDB = async () => {
  try {
    configureDnsServers();
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/connectteam');
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    if (String(error.message || '').includes('ECONNREFUSED')) {
      console.error(
        'Hint: start MongoDB locally, or set MONGODB_URI in backend/.env (e.g. MongoDB Atlas connection string).',
      );
    }
    process.exit(1);
  }
};

module.exports = connectDB;
