# ConnectTeam — Staff Tips & Tardiness

MERN app for staff tips distribution (Phase 1) and weekly payouts with tardiness/redistribution (Phase 2). Employee time data is synced from the **Connecteam API**; manager enters AM/PM gross tips per location per day. Calculations follow *Front Staff - Tips Calculation Logic.pdf*.

## Features

- **Time Entries**: Load by date range or sync from Connecteam (deduplicated, AM/PM split 06:00–15:00 / 15:00–23:00).
- **Daily Tips**: Per location, per day — enter AM/PM gross tips; 4% production deduction; allocation by worked hours; audit snapshot stored.
- **Weekly Payout**: Mon–Sun sum of daily tips; tardiness tiers (0–5 min 0%, >5–10 min 15%, >10 min 20%); manual deductions; redistribution to eligible staff.

## Locations (fixed)

Four locations are seeded on backend startup (no manual add):

- Oranjestad  
- Casa del Mar  
- The Cove  
- Drive Thru  

## Project flow (up to Daily Tips)

End-to-end flow from app start through Daily Tips:

```
1. Backend starts
   → Connects to MongoDB
   → Seeds 4 locations (if missing)

2. User opens app
   → Frontend loads locations from API
   → User picks a location on each page (Dashboard, Time Entries, Daily Tips, Weekly Payout)

3. Time Entries (raw data)
   → User selects location + start/end date
   → Load range: fetches time entries from DB for that location and date range
   → Load from Connecteam: syncs clock-in/clock-out from Connecteam API, deduplicates
     (same employee + date + clockIn + clockOut → one), stores in DB
   → Table shows: Date, Employee, Clock In, Clock Out (data persists when navigating away)

4. Daily Tips (manager input + calculation)
   → User selects location + date (single row: Location, Date, AM Gross Tips, PM Gross Tips, Save)
   → Save: stores tip input in DB (UTC date) for that location and date
   → Backend loads:
     a) Tip input (AM/PM gross) for that date
     b) Time entries for that location and date from DB
   → Normalize: deduplicate entries (same employee, clockIn, clockOut → one)
   → Split: each entry split into AM (06:00–15:00) and PM (15:00–23:00) hours; same clock-in/out → 0 hrs
   → Sum: per employee, total AM hours and total PM hours; then location total AM/PM hours
   → Production: 4% deducted from gross AM and PM → distributable AM/PM
   → Tip rate: AM rate = distributable AM ÷ total AM hours (0 if no hours); same for PM
   → Allocate: per employee, AM tips = AM hours × AM rate, PM tips = PM hours × PM rate; round at display
   → Audit: save snapshot (raw entries, derived hours, financial) to DB for that location+date
   → UI shows: inputs & deduction, tip rates, staff table (AM/PM hrs, AM/PM tips, total) + evidence (entries used, hours per employee)
```

So: **Time Entries** supply the hours (who worked when); **Daily Tips** supply the money (manager enters gross) and the app computes per-person allocation and stores an audit snapshot.

## Prerequisites

- **Node.js** (v18+)
- **MongoDB** (local or Atlas)
- **Connecteam API key** (for syncing time entries; optional if you only test with manual data)

## Setup

### 1. Clone and install

```bash
cd ConnectTeam
cd backend  && npm install  && cd ..
cd frontend && npm install  && cd ..
```

### 2. Backend environment

Create `backend/.env`:

```env
MONGODB_URI=mongodb://localhost:27017/connectteam
PORT=3000
CONNECTEAMS_API_KEY=your-api-key
CONNECTEAMS_BASE=https://api.connecteam.com
```

- `MONGODB_URI` — required.
- `CONNECTEAMS_API_KEY` — required for **Load from Connecteam**; you can leave the default for a quick run (demo key), but sync may be rate-limited or invalid.
- `CONNECTEAMS_BASE` — optional; default is `https://api.connecteam.com`.

## Run

**Terminal 1 — Backend**

```bash
cd backend
npm run dev
```

Runs on `http://localhost:3000` (or `PORT` from `.env`). On startup, DB is connected and the 4 locations are seeded.

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev
```

Vite runs the app (e.g. `http://localhost:5173`). API requests to `/api` are proxied to the backend.

## How to test the project

There are no automated test suites yet; you test by running the app and walking through the flows below.

### 1. Smoke test (backend only)

- Start backend; ensure you see `Server running on http://localhost:3000` and no DB errors.
- Open in browser: `http://localhost:3000/api/locations` — you should get JSON with the 4 seeded locations.

### 2. Full stack — Time Entries

1. Start backend and frontend; open the app in the browser.
2. Go to **Time Entries**.
3. Select a **location** (e.g. Casa del Mar) and a **start/end date** (e.g. 2026-01-01 to 2026-01-07).
4. Click **Load range** — table should show time entries for that location/range (or “No entries” if none).
5. (Optional) Click **Load from Connecteam** — if `CONNECTEAMS_API_KEY` is valid, entries are synced and the table updates. Pagination (e.g. 25 per page) should work.

### 3. Full stack — Daily Tips (required for Weekly Payout)

1. Go to **Daily Tips**; select the same **location** and a **date** (e.g. 2026-01-01).
2. Enter **AM Gross Tips** and **PM Gross Tips** (e.g. 400 and 600); click **Save**.
3. Click **Calculate** (or rely on auto-calculation if the page does it). You should see:
   - Production deduction (4%), distributable amounts, tip rates.
   - Staff table with per-employee AM/PM hours and allocated tips.
4. Repeat for a few more days in the same week (e.g. Jan 1–7) so Weekly Payout has data.

### 4. Full stack — Weekly Payout

1. Go to **Weekly Payout**; select the same **location** and set **Week (Mon–Sun)** to the Monday of the week you used (e.g. 2026-01-01).
2. Check the **Staff payout table**:
   - **Daily Tips (Mon–Sun)** should be the sum of that week’s daily tips per employee (non-zero if you entered gross tips for those days).
   - **Tardiness**, **Manual Deduction**, **Net Weekly Tips**, **Redistribution**, **Final Payable** should compute from your inputs.
3. In **Tardiness & manual deductions**, set tardiness minutes for one employee (e.g. 12 min) and optional manual deduction + reason; click **Save**. Reload payout — that employee should show 20% tardiness deduction and others may show redistribution.

### 5. Edge checks

- **No tip input**: For a day with no Daily Tip Input, Daily Tips calculation shows an error; Weekly Payout treats that day as $0 for everyone — expected.
- **No time entries**: Daily Tips can still show manager input and $0 allocations if no one worked; Weekly Payout shows $0 daily tips until at least one day has tip input.
- **Different location**: Change location in each page; data should be scoped per location.

### 6. Optional — API with curl/Postman

- `GET /api/locations` — list locations.
- `GET /api/time-entries?locationId=<id>&startDate=2026-01-01&endDate=2026-01-07` — time entries (replace `<id>` with a location `_id` from the first call).
- `GET /api/daily-tips/<locationId>/2026-01-01` — daily tip calculation for that location/date (after saving tip input).
- `GET /api/weekly-payout/<locationId>/2026-01-01` — weekly payout for the week starting that Monday.

Use the same base URL as the frontend (e.g. `http://localhost:3000/api` when calling the backend directly).

---

**Summary**: Run backend + frontend, then test **Time Entries** → **Daily Tips** (enter gross tips for at least one week) → **Weekly Payout**. Tardiness and manual deductions are optional; they only affect payout after you save them.
