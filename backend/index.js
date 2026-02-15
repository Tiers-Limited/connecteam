require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { port } = require('./config/env');
const { seedLocations } = require('./scripts/seedLocations');
const { seedProductionStaff } = require('./scripts/seedProductionStaff');

const app = express();
app.use(cors());
// strict: false allows body "null" (e.g. axios post(url, null)) without throwing
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(errorHandler);

async function start() {
  await connectDB();
  await seedLocations();
  await seedProductionStaff();
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
