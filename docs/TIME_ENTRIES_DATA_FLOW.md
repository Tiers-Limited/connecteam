# Time Entries Page – API Connections & How “User from Location” Works

This document explains how the **Time Entries** page (`frontend/src/pages/TimeEntries.jsx`) fetches data, which IDs link users to locations, and how the backend connects to the Connecteam API.

---

## 1. Overview

- The Time Entries page shows **clock-in / clock-out** per employee per day for a **selected location** and **date range**.
- Data can come from:
  1. **Backend DB (MongoDB)** – after a “Load from Connecteam” sync.
  2. **Session storage** – cached for the same location + range when you come back to the page.
- “This user is from this location” is enforced by **storing each time entry with a `locationId`** when syncing from Connecteam. When you filter by location on the page, you only see entries that were saved for that location.

---

## 2. IDs and Where They Come From

### 2.1 Location ID (`locationId`)

| Where | What it is | How we get it |
|-------|------------|----------------|
| **Frontend** | MongoDB `ObjectId` of a **Location** document | From **AppContext**: `locations` is loaded via `GET /locations`; user picks one → `selectedLocationId`. |
| **Backend** | Same: `Location._id` | **Location** collection is seeded (e.g. “Casa del Mar”, “Oranjestad”, …). Names must match the 4 fixed Connecteam locations. |

- **Locations** in the app are stored in MongoDB (`Location` model: `_id`, `name`, `isActive`).
- The frontend gets the list once from `GET /locations` and keeps it in **AppContext**; the Time Entries page uses `selectedLocationId` from that list.

### 2.2 Employee ID (`employeeId`)

| Where | What it is | How we get it |
|-------|------------|----------------|
| **TimeEntry document** | MongoDB `ObjectId` of an **Employee** document | Set during **Connecteam sync**: each Connecteam user is resolved to an Employee by `connecteamsUserId` + `locationId`. |
| **Employee document** | `_id`, `name`, `locationId`, `connecteamsUserId` | One Employee per (**Connecteam user**, **location**): same person can exist once per location (e.g. “John” at Casa del Mar and “John” at Oranjestad). |

- So “this user is from this location” means: **this time entry has `employeeId` → that Employee has `locationId` = the selected location**, and that Employee was created/updated for that location during sync.

### 2.3 Connecteam IDs (external)

| ID | Meaning |
|----|--------|
| **connecteamsUserId** | Connecteam’s user id (e.g. string `"12023123"`). Stored on **Employee** so we can match Connecteam punch data to our Employee. |
| **locationKey** | Connecteam’s internal location key (e.g. `"casa del mar"`, `"oranjestad"`). Used only during sync to map to our **Location** by name. |

- Our app does **not** use Connecteam’s user id on the Time Entries UI; we only show **Employee name** and times. The link “user ↔ location” is via our **Employee** and **TimeEntry** documents.

---

## 3. How the Frontend Fetches Data

### 3.1 APIs Used by the Time Entries Page

| Action | API | Purpose |
|--------|-----|--------|
| Get locations (once, in App) | `GET /locations` | Populate location dropdown; `selectedLocationId` is one of these `_id`s. |
| Load time entries for range | `GET /time-entries/:locationId/range?startDate=...&endDate=...` | Fetch entries for the **chosen location** and date range. |
| Sync from Connecteam | `POST /connecteams/sync?startDate=...&endDate=...` | Pull punches from Connecteam and write them into **TimeEntry** with our `locationId` and `employeeId`. |

- So “this user is from this location” on the page is enforced by **only calling** `GET /time-entries/:locationId/range` with the **selected location’s `_id`**. The backend only returns entries where `TimeEntry.locationId === that locationId`.

### 3.2 Flow on the Page

1. **Location & dates**
   - User selects **Location** (from `locations` in context → `selectedLocationId`).
   - User sets **Start date** and **End date** (persisted in session storage for the view).

2. **Load range**
   - User clicks **“Load range”** (or cache is used; see below).
   - Frontend calls:
     - `getTimeEntriesRange(selectedLocationId, startDate, endDate)`  
       → `GET /time-entries/${locationId}/range?startDate=...&endDate=...`
   - Response: array of time entry objects (see “Shape of a time entry” below).

3. **Load from Connecteam**
   - User clicks **“Load from Connecteam”**.
   - Frontend calls:
     - `syncFromConnecteams(startDate, endDate)`  
       → `POST /connecteams/sync?startDate=...&endDate=...`
   - Backend fetches from Connecteam, maps **locationKey → our locationId** and **connecteamsUserId → our Employee (per locationId)**, then creates **TimeEntry** documents with that `locationId` and `employeeId`. So every stored entry is tied to one of our locations.
   - After sync, the page typically calls **Load range** again so the table shows the new data for the **current** `selectedLocationId`.

4. **Persistence**
   - View range: `sessionStorage` (`timeEntries_view`: `viewStartDate`, `viewEndDate`).
   - Fetched data: `sessionStorage` (`timeEntries_data`: `locationId`, `startDate`, `endDate`, `entries`) and **AppContext** `timeEntriesCache`.
   - On return to the page, if cache/storage matches current location + range, entries are restored without a new request (until user changes range or clicks Load again).

---

## 4. Backend: How “User from Location” Is Enforced

### 4.1 Reading time entries (what the page sees)

- **Route:** `GET /time-entries/:locationId/range?startDate=&endDate=`
- **Service:** `timeEntryService.getByLocationDateRange(locationId, startDate, endDate)`:
  - Queries **TimeEntry** with:
    - `locationId` = the `locationId` from the URL (the selected location).
    - `date` in `[startDate, endDate]`.
  - Populates `employeeId` with `name` only.
- So the frontend **only ever gets entries that are stored for that location**. There is no “user from another location” in that response; the filter is by `locationId` in the DB.

### 4.2 Writing time entries (sync from Connecteam)

- **Route:** `POST /connecteams/sync?startDate=&endDate=`
- **Flow:**
  1. Backend calls **Connecteam API** (via `connecteamsService.getTimeEntriesFromConnecteams(startDate, endDate)`).
  2. Connecteam returns raw entries with:
     - `connecteamsUserId`
     - `employeeName`
     - `locationKey` (e.g. `"casa del mar"`)
     - `date`, `clockIn`, `clockOut`, optional `scheduledTime`
  3. **Mapping location:**  
     Backend has a fixed list **LOCATIONS** (e.g. `{ key: 'casa del mar', name: 'Casa del Mar' }`). For each key it finds a **Location** in MongoDB by **name** (e.g. `locationService.getByName('Casa del Mar')`) and gets `locationId = loc._id`. So `locationKey` → our **Location** `_id`.
  4. **Mapping user:**  
     For each raw entry, backend calls `employeeService.findOrCreateByConnecteams(connecteamsUserId, locationId, employeeName)`:
     - Finds or creates an **Employee** with that `connecteamsUserId` and **that** `locationId`.
     - So the same Connecteam user can be different **Employee** documents in different locations (e.g. one Employee at Casa del Mar, one at Oranjestad).
  5. **Creating TimeEntry:**  
     For each entry we create a **TimeEntry** with:
     - `employeeId` = that Employee’s `_id`
     - `locationId` = the one we resolved from `locationKey`
     - `date`, `clockIn`, `clockOut`, optional `scheduledTime`
- So “this user is from this location” is fixed at **sync time**: the entry is stored with the **locationId** that came from Connecteam’s `locationKey`. When the user later selects “Casa del Mar” on the Time Entries page, we only query by that location’s `_id`, so we only see entries (and thus users) that were synced for that location.

---

## 5. Shape of the Data

### 5.1 Response of `GET /time-entries/:locationId/range`

Each item in the `data` array (and thus each row the frontend uses) looks like:

```js
{
  _id: "...",           // TimeEntry document id
  employeeId: {
    _id: "...",         // Employee document id (MongoDB ObjectId)
    name: "Adriana CAICEDO SANCHEZ"
  },
  locationId: "...",    // Location document id (same for all in this response)
  date: "2026-02-08T00:00:00.000Z",
  clockIn: "06:30",
  clockOut: "14:37",
  scheduledTime: "06:00"  // optional
}
```

- The frontend groups by **employee + date** and shows **first clock-in** and **last clock-out** per day, then builds the table with date columns (e.g. 02 Feb, 03 Feb, …).

### 5.2 Connecteam raw entry (before we save)

```js
{
  connecteamsUserId: "12023123",
  employeeName: "Daniel TABORDA VEGA",
  locationKey: "casa del mar",
  date: "2026-02-08",
  clockIn: "06:55",
  clockOut: "14:56",
  scheduledTime: "07:00"  // optional
}
```

- `locationKey` is mapped to our **Location** by name → `locationId`.
- `connecteamsUserId` + `locationId` → our **Employee** (find or create) → `employeeId`.
- That `locationId` and `employeeId` are what make “this user from this location” in the DB and on the Time Entries page.

---

## 6. Summary Table (IDs and APIs)

| Concept | ID / API | Role |
|--------|----------|------|
| **Locations in the app** | `Location._id` (`locationId`) | From DB; frontend gets list via `GET /locations` and uses `selectedLocationId`. |
| **Connecteam location** | `locationKey` (string, e.g. `"casa del mar"`) | Only in sync; mapped to `Location` by **name** to get `locationId`. |
| **User in the app** | `Employee._id` (`employeeId`) | One Employee per (Connecteam user, location); used in **TimeEntry**. |
| **Connecteam user** | `connecteamsUserId` (string) | Stored on **Employee**; used in sync to find/create Employee per location. |
| **Time entry** | `TimeEntry` with `employeeId`, `locationId`, `date`, `clockIn`, `clockOut` | Only shown for the **selected location** because the page calls `GET /time-entries/:locationId/range`. |
| **How we know “user from location”** | Each **TimeEntry** has `locationId`; we only query by that `locationId` | So the page only shows entries (and thus employees) that belong to the chosen location. |

---

## 7. File Reference

| Layer | File | Responsibility |
|-------|------|----------------|
| Frontend page | `frontend/src/pages/TimeEntries.jsx` | Location/date UI, calls `getTimeEntriesRange(locationId, start, end)` and `syncFromConnecteams(start, end)`, groups by employee+date, first/last clock. |
| Frontend API | `frontend/src/services/timeEntryService.js` | `getTimeEntriesRange` → `GET /time-entries/:locationId/range`. |
| Frontend API | `frontend/src/services/connecteamsService.js` | `syncFromConnecteams` → `POST /connecteams/sync`. |
| Frontend context | `frontend/src/context/AppContext.jsx` | `locations`, `selectedLocationId`, `timeEntriesCache`. |
| Backend route | `backend/routes/timeEntryRoutes.js` | `GET /:locationId/range`, `GET /:locationId/:date`. |
| Backend controller | `backend/controllers/timeEntryController.js` | `getByLocationDateRange`, `getByLocationAndDate`. |
| Backend service | `backend/services/timeEntryService.js` | `getByLocationDateRange(locationId, startDate, endDate)` – query **TimeEntry** by `locationId` and date range. |
| Backend sync | `backend/controllers/connecteamsController.js` | `syncFromConnecteams` – call Connecteam, map `locationKey` → `locationId`, `connecteamsUserId` + `locationId` → Employee, create **TimeEntry**. |
| Backend Connecteam | `backend/services/connecteamsService.js` | `getTimeEntriesFromConnecteams(startDate, endDate)` – returns raw entries with `connecteamsUserId`, `locationKey`, etc. |
| Backend constants | `backend/utils/constants.js` | **LOCATIONS** – list of `{ key, name }` used to map Connecteam `locationKey` to our Location by name. |
| Models | `backend/models/TimeEntry.js` | `employeeId`, `locationId`, `date`, `clockIn`, `clockOut`, `scheduledTime`. |
| Models | `backend/models/Employee.js` | `name`, `locationId`, `connecteamsUserId`. |
| Models | `backend/models/Location.js` | `name`, `isActive`. |

This is how the Time Entries page connects to the APIs and how we know which user belongs to which location: **locationId** on **TimeEntry** and **Employee**, and the page only requesting entries for the **selected location’s ID**.
