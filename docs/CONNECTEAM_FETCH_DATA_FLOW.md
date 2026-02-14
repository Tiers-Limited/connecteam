# Fetching Data from Connecteam – API Order and How Data Is Used

This document describes **which Connecteam APIs are called**, **in what order**, **what data comes back**, and **how that data is used** in our backend. All calls go through a single helper: `connecteamsFetch(path)` with base URL from config (`CONNECTEAMS_BASE`, default `https://api.connecteam.com`) and header `X-API-KEY: <CONNECTEAMS_API_KEY>`.

---

## 1. Entry point

- **Our backend function:** `connecteamsService.getTimeEntriesFromConnecteams(startDate, endDate)`  
  - Used by: **sync** (Time Entries), **Weekly Tardiness**, **Daily Tips**, **clock-in-times**.
- It calls the Connecteam APIs **in a fixed order** and builds a list of **time entries** with: `connecteamsUserId`, `employeeName`, `locationKey`, `date`, `clockIn`, `clockOut`, optional `scheduledTime`.

---

## 2. API call order and usage

### Step 1 – Users (first API)

| What | Value |
|------|--------|
| **API** | `GET /users/v1/users?limit=100&offset=0&order=asc&userStatus=active` |
| **Pagination** | Repeated with `offset += limit` until a page returns fewer than `limit` items. |
| **Purpose** | Build a **user map**: Connecteam user id → name and location info. |

**Data we use from the response:**

- `data` (or `data.users` / `items`) → list of user objects.
- Per user:
  - `userId` or `id` → key in the map.
  - `firstName` + `lastName` (or `name` / `fullName`) → display name.
  - **Custom fields** (we read):
    - **"Location"** → list of location values (e.g. "Casa del Mar").
    - **"Location - Job"** or **"Location/Job"** → location/job values.

**How it’s used:**

- **Filter:** We only keep time entries for users who “belong” to one of our 4 locations (Oranjestad, Casa del Mar, The Cove, Drive Thru). That is done by matching these custom field values (after normalizing) to our `LOCATIONS` keys.
- **Name:** Each time entry gets `employeeName` from this map.
- **Location fallback:** If a punch has no schedule (no shift), we try to assign `locationKey` from the user’s Location / Location-Job custom field.

---

### Step 2 – Time clocks

| What | Value |
|------|--------|
| **API** | `GET /time-clock/v1/time-clocks` |
| **Purpose** | Get the list of **time clocks** we will ask for timesheets and time-activities. |

**Data we use:**

- `data` (or `timeClocks` / `items`) → array of time clock objects.
- We take the first **25** time clocks.
- Per clock: `id` or `timeClockId` → used in the next API paths.
- We also store `assignedUserIds` (or `userIds` / `assignedUserId`) per clock → used when the timesheet doesn’t have a user id on each record, to infer the single user for that clock.

**How it’s used:**

- The **timesheet** and **time-activities** calls (steps 5 and 6) are made **per time clock id**. So this API decides “which clocks we pull data from.”

---

### Step 3 – Schedulers

| What | Value |
|------|--------|
| **API** | `GET /scheduler/v1/schedulers` |
| **Purpose** | Get scheduler ids so we can fetch **shifts** (schedule) for the date range. |

**Data we use:**

- `data` (or `schedulers` / `items`) → list of schedulers.
- We prefer **non-archived** (`isArchived === false`); if none, we use all.
- We take up to **10** scheduler ids: `id` or `schedulerId`.

**How it’s used:**

- Each scheduler id is used in **Step 4** to request shifts. Shifts give us **scheduled start time**, **location**, and **timezone** per (user, date), which we need for tardiness and for assigning a location to a punch.

---

### Step 4 – Shifts (per scheduler)

| What | Value |
|------|--------|
| **API** | `GET /scheduler/v1/schedulers/{schedulerId}/shifts?startTime={start}&endTime={end}&limit=100&offset={offset}` |
| **Parameters** | `startTime` / `endTime`: Unix time in **seconds** or **milliseconds** (we try both if the first format returns nothing). `limit` / `offset` for pagination. |
| **Purpose** | Build **schedule map**: `scheduleMap[userId][date]` = `{ scheduledStartMs, locationKey, timezone }`. |

**Data we use from each shift:**

- `start` / `startTime` / `scheduledStart` / `startTimestamp` → scheduled start (we normalize to ms).
- `assignedUserIds` or `userIds` or `assignedUserId` → which user(s) this shift is for.
- `timezone` → used to format clock-in/out and date in that timezone.
- **Location:**  
  `locationData.gps.address` or `locationData.address` or `locationData.name`, or `location` (string) or `locationName` / `address`. We normalize this string to one of our 4 keys (e.g. "casa del mar") via `normalizeLocationKey()`.

**How it’s used:**

- **Location:** For each punch we later assign a `locationKey`; the first choice is the shift’s location for that user/date.
- **Scheduled time:** We store `scheduledStartMs` and format it as `scheduledTime` (e.g. "07:00") for tardiness (minutes late = clockIn − scheduled).
- **Timezone:** All clock-in/clock-out and date formatting for that punch use this timezone (or default America/Aruba).
- We keep the **earliest** scheduled start per (user, date) when there are multiple shifts.

---

### Step 5 – Timesheet (per time clock)

| What | Value |
|------|--------|
| **API** | `GET /time-clock/v1/time-clocks/{timeClockId}/timesheet?startDate={startDate}&endDate={endDate}` |
| **Parameters** | `startDate` / `endDate` in **YYYY-MM-DD** (same as our function args). |
| **Purpose** | Get actual **punch pairs** (clock-in / clock-out) per user per day. |

**Data we use:**

- **Structure A:** `users` → each has `userId` / `user_id`, and `dailyRecords` or `days` → each day has `date` and `records` / `punches` / `activities`.
- **Structure B:** If no `users`, we use `dailyRecords` or `days` or `records` at top level; we may not have user id on each record (then we use the time clock’s single assigned user if any).
- Per record we read:
  - **Start:** `start` / `clockIn` / `clockInTime` / `startTime` → `timestamp` or `time` (Unix seconds or ms).
  - **End:** `end` / `clockOut` / `clockOutTime` / `endTime` → same.

**How it’s used:**

- We flatten to one “record” per punch pair, with `_date` (YYYY-MM-DD) and `_userId`.
- We **filter** by user: only users in `userMap` that belong to our 4 locations (from Step 1).
- For each record we:
  - Get **clockIn** / **clockOut** (formatted in the timezone from the schedule map, or default).
  - Get **locationKey** from schedule for that (user, date); if missing, from user’s Location custom field; else first location key.
  - Get **scheduledTime** from schedule (for tardiness).
- We push into the **entries** array one object per punch pair: `connecteamsUserId`, `employeeName`, `locationKey`, `date`, `clockIn`, `clockOut`, optional `scheduledTime` / `scheduledStartMs` / `clockInMs`.

---

### Step 6 – Time-activities (fallback, per time clock)

| What | Value |
|------|--------|
| **API** | `GET /time-clock/v1/time-clocks/{timeClockId}/time-activities?startDate={startDate}&endDate={endDate}` |
| **Purpose** | Another source of punch pairs if the **timesheet** structure is empty or different. |

**Data we use:**

- `timeActivitiesByUsers` / `timeActivities` / `users` / `items` or array → list of per-user objects.
- Per user: `userId` / `user_id` / `id`; then `shifts` / `activities` / `records` / `timeActivities` → list of shift/activity objects.
- Per shift: same as timesheet – start/end timestamps, we derive clock-in and clock-out, date, timezone; we get location from schedule or user custom field.

**How it’s used:**

- Same as Step 5: we push more entries into the same **entries** array with the same shape. So the final list can contain entries from both **timesheet** and **time-activities**.

---

## 3. What we return from `getTimeEntriesFromConnecteams`

- **Array of entries.** Each entry:

| Field | Type | Source |
|-------|------|--------|
| `connecteamsUserId` | string | From Users + Timesheet/Time-activities (user id). |
| `employeeName` | string | From Users (name). |
| `locationKey` | string | From Shifts (location) or User custom field "Location" / "Location - Job", or first LOCATIONS key. |
| `date` | string | YYYY-MM-DD from the punch date in the shift’s timezone (or default). |
| `clockIn` | string | "HH:mm" from punch start, formatted in that timezone. |
| `clockOut` | string | "HH:mm" from punch end (or start + 8h if no end). |
| `scheduledTime` | string (optional) | "HH:mm" from Shifts (earliest scheduled start for that user/date). |
| `scheduledStartMs` | number (optional) | From Shifts, for tardiness math. |
| `clockInMs` | number (optional) | For first-punch logic and tardiness. |

- There can be **multiple entries per (user, location, date)** (e.g. multiple punch pairs in a day). Callers (sync, weekly tardiness) that need “one row per employee per day” use the **first clock-in** of the day and the **last clock-out** when aggregating.

---

## 4. How this data is used in the app

| Feature | Uses Connecteam data by |
|--------|--------------------------|
| **Time Entries – “Load from Connecteam”** | `getTimeEntriesFromConnecteams` → dedupe → map `locationKey` to our DB `locationId`, `connecteamsUserId` + `locationId` to our Employee → create/update **TimeEntry** in MongoDB. So “data from Connecteam” becomes our DB entries for the selected location/range. |
| **Weekly Tardiness** | Same function → filter by location (optional) → compute minutes late (scheduled vs first clock-in), keep **first punch per (employee, date)** for daily/week totals → return entries + dailyTotals + weekTotal. |
| **Daily Tips** | Same function for the selected date (and location) → first/last punch per employee per day → AM/PM split and tip calculation. |
| **Clock-in times API** | Same function → filter by `userId` and optional location → return list of `{ date, clockIn, clockOut, ... }`. |

So **all** of these flows depend on the **same** Connecteam fetch sequence: Users → Time clocks → Schedulers → Shifts → Timesheet (per clock) → Time-activities (per clock).

---

## 5. Summary – API order and role

| Order | Connecteam API | What we get | What we use it for |
|-------|----------------|------------|---------------------|
| 1 | **GET /users/v1/users** (paginated) | User list with custom fields (Location, Location - Job) | User map: filter by our 4 locations, employee name, location fallback. |
| 2 | **GET /time-clock/v1/time-clocks** | List of time clocks | Which clocks to call for timesheet and time-activities. |
| 3 | **GET /scheduler/v1/schedulers** | List of schedulers | Which schedulers to ask for shifts. |
| 4 | **GET /scheduler/v1/schedulers/{id}/shifts** (per scheduler, paginated) | Shifts in date range | Schedule map: scheduled time, location, timezone per (user, date). |
| 5 | **GET /time-clock/v1/time-clocks/{id}/timesheet** (per clock) | Punches per user per day | Build entries: clockIn, clockOut, date, locationKey, scheduledTime. |
| 6 | **GET /time-clock/v1/time-clocks/{id}/time-activities** (per clock) | Same idea, different structure | Extra punch pairs added to entries. |

**Config:** Base URL and API key come from `backend/config/env.js`: `CONNECTEAMS_BASE` (default `https://api.connecteam.com`), `CONNECTEAMS_API_KEY` (set in `.env`).

**File:** All of the above is implemented in `backend/services/connecteamsService.js` (function `getTimeEntriesFromConnecteams` and helpers like `connecteamsFetch`, `normalizeLocationKey`, `userBelongsToLocations`, etc.).
