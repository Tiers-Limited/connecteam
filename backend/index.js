require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { port } = require('./config/env');
const { seedLocations } = require('./scripts/seedLocations');

const app = express();
app.use(cors());
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(errorHandler);

async function start() {
  await connectDB();
  await seedLocations();
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
