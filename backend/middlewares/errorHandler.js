function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  // Never send raw JSON parse errors to the client
  if (message.includes('Unexpected token') || message.includes('not valid JSON')) {
    message = 'Connecteams API returned an invalid response. Check CONNECTEAMS_API_KEY in .env and try again.';
    res.status(502).json({ success: false, error: message });
    return;
  }
  res.status(status).json({ success: false, error: message });
}

module.exports = errorHandler;
