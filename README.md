# Corvia Tips

## Connecteam integration – how it is called and what data is used

All Connecteam API calls use the same base URL (`CONNECTEAMS_BASE`, default `https://api.connecteam.com`) and header `X-API-KEY: <CONNECTEAMS_API_KEY>`. The Corvia Tips backend calls these APIs in a fixed order when fetching time entries (used by Weekly Tardiness, Time Entries sync, Daily Tips, and clock-in times).

### Call order and parameters

| Order | API | Method | Path / query params | Data used as params |
|-------|-----|--------|---------------------|----------------------|
| **1** | **Users** | GET | `/users/v1/users?limit=100&offset={offset}&order=asc&userStatus=active` | `limit`, `offset` (paginated until a page has fewer than 100 items). |
| **2** | **Time clocks** | GET | `/time-clock/v1/time-clocks` | None. |
| **3** | **Schedulers** | GET | `/scheduler/v1/schedulers` | None. |
| **4** | **Shifts** (per scheduler) | GET | `/scheduler/v1/schedulers/{schedulerId}/shifts?startTime={start}&endTime={end}&limit=100&offset={offset}` | **Path:** `schedulerId` from step 3. **Query:** `startTime`, `endTime` (Unix seconds or ms for the date range), `limit`, `offset`. |
| **5** | **Time activities** (per time clock) | GET | `/time-clock/v1/time-clocks/{timeClockId}/time-activities?startDate={startDate}&endDate={endDate}&userIds={id1}&userIds={id2}&...` | **Path:** `timeClockId` from step 2. **Query:** `startDate`, `endDate` (YYYY-MM-DD), `userIds` (array of user IDs from step 1 that belong to our locations). |
| **6** | **Job** (per unique jobId) | GET | `/jobs/v1/jobs/{jobId}` | **Path:** `jobId` from each shift in the time-activities response. |

### Where the params come from

- **Date range** (`startDate`, `endDate`, `startTime`, `endTime`): From the caller (e.g. weekly tardiness uses the week’s Monday–Sunday; sync uses the selected range). Converted to YYYY-MM-DD for time-activities and to Unix time for shifts.
- **User IDs** (`userIds` in time-activities): From step 1 (Users). We only include user IDs that “belong” to our 4 locations (Oranjestad, Casa del Mar, The Cove, Drive Thru) by matching their custom fields “Location” and “Location - Job” to our location keys.
- **Time clock IDs**: From step 2 (Time clocks). Only clocks matching `CONNECTEAM_TIME_CLOCK_NAMES` (default `SANTOS`) or `CONNECTEAM_TIME_CLOCK_IDS` are used for time-activities (e.g. `13138505`). Other clocks (e.g. DHG Office) are ignored.
- **Scheduler IDs**: From step 3 (Schedulers). We use up to 10 (non-archived first); each is used in the shifts URL as `schedulerId`.
- **Job IDs**: From step 5 (Time activities). Each shift in the response has a `jobId`; we collect unique job IDs and call the Job API once per ID to get `job.title`, which we use as the **location** (normalized to our location keys).

### What we use from each response

- **Users:** `userId`/`id`, `firstName`/`lastName` (or `name`/`fullName`), custom fields “Location” and “Location - Job” → user map and list of location-filtered user IDs for time-activities.
- **Time clocks:** `id`/`timeClockId` → list of time clock IDs for the time-activities calls.
- **Schedulers:** `id`/`schedulerId`, `isArchived` → list of scheduler IDs for the shifts calls.
- **Shifts:** `start`/`startTime`, `assignedUserIds`/`userIds`, `timezone` → schedule map: scheduled start time and timezone per (user, date) for tardiness and formatting.
- **Time activities:** `timeActivitiesByUsers` (or similar) → per user, `shifts` with `jobId`, `start`, `end` → punch pairs and job IDs.
- **Job:** `data.job.title` (or `job.name`) → location for that job; we normalize it to one of our location keys. User profile locations are **not** used as a fallback (avoids showing the same punch at every site).

### Entry point in code

- **Function:** `connecteamsService.getTimeEntriesFromConnecteams(startDate, endDate)` in `backend/services/connecteamsService.js`.
- **Config:** `CONNECTEAMS_BASE` and `CONNECTEAMS_API_KEY` in `backend/config/env.js` (from `.env`).

More detail is in `docs/CONNECTEAM_FETCH_DATA_FLOW.md`.
