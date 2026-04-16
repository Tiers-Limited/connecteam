// scripts/testClockInTimes.js

const BASE_URL = "http://localhost:3000";
const USER_ID = "12023102";
const START_DATE = "2026-04-10";
const END_DATE = "2026-04-10";
const LOCATION_NAME = "Casa del Mar"; 

async function main() {
  const params = new URLSearchParams({
    userId: USER_ID,
    startDate: START_DATE,
    endDate: END_DATE,
  });

  if (LOCATION_NAME) {
    params.set("locationName", LOCATION_NAME);
  }

  const url = `${BASE_URL}/api/connecteams/clock-in-times?${params.toString()}`;

  console.log("Request URL:", url);

  try {
    const res = await fetch(url, { method: "GET" });
    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Error:", res.status, data.message);
      return;
    }

    console.log("✅ Response:");
    console.log(JSON.stringify(data, null, 2));

    console.log("\n--- Clock-in entries ---");
    data.data.entries?.forEach((e, i) => {
      console.log(
        `${i + 1}. ${e.date} | ${e.clockIn} – ${e.clockOut} | ${e.employeeName || ""}`
      );
    });
  } catch (err) {
    console.error("❌ Request failed:", err.message);
  }
}

main();