/**
 * Run: node scripts/testClockInTimes.js
 * (from backend folder: node scripts/testClockInTimes.js)
 *
 * Calls GET /connecteams/clock-in-times and prints the response in the terminal.
 * Edit the constants below to change userId, date range, or location.
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const USER_ID = process.env.USER_ID || '13925974';
const START_DATE = process.env.START_DATE || '2026-02-02';
const END_DATE = process.env.END_DATE || '2026-02-08';
const LOCATION_NAME = process.env.LOCATION_NAME || 'Casa del Mar';

async function main() {
  const params = new URLSearchParams({
    userId: USER_ID,
    startDate: START_DATE,
    endDate: END_DATE,
  });
  if (LOCATION_NAME) params.set('locationName', LOCATION_NAME);

  const url = `${BASE_URL}/api/connecteams/clock-in-times?${params.toString()}`;
  console.log('Request URL:', url);
  console.log('');

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error('Error:', res.status, data.error || data.message || res.statusText);
      process.exit(1);
    }

    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    if (data.success && data.data?.entries?.length) {
      console.log('--- Clock-in entries ---');
      data.data.entries.forEach((e, i) => {
        console.log(
          `${i + 1}. ${e.date} | ${e.clockIn} – ${e.clockOut}${e.scheduledTime ? ` (scheduled: ${e.scheduledTime})` : ''} | ${e.employeeName || ''}`
        );
      });
    } else if (data.success && data.data) {
      console.log('Entries count:', data.data.entries?.length ?? 0);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
    process.exit(1);
  }
}

main();
