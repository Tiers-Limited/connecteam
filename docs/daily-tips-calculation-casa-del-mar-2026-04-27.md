# Daily Tips Calculation — Casa del Mar (2026-04-27)

This document walks through how the **AM tip rate** and **PM tip rate** shown on the Daily Tips → Breakdown page are computed for this specific location and date.

---

## 1. Inputs (saved gross tips)

| Field   | Value      |
| ------- | ---------- |
| Location| Casa del Mar |
| Date    | 2026-04-27 |
| AM gross tips | **$632.00** |
| PM gross tips | **$282.17** |
| Total gross   | **$914.17** |

Casa del Mar uses the AM 06:00–14:00 / PM 14:00–23:00 shift boundaries (`SHIFT_BOUNDARIES_CASA_ORANJESTAD` in `backend/utils/constants.js`).

No manual clock entries exist for this date, so the manual-tip subtraction step is a no-op.

---

## 2. Formulas

The full pipeline lives in `backend/services/tipsCalculationService.js`. The relevant pieces are:

### 2a. Production pool (5.4%)

```
productionDeductionTotal = (amGross + pmGross) × PRODUCTION_DEDUCTION_PERCENT
```

`PRODUCTION_DEDUCTION_PERCENT = 0.054` from `backend/utils/constants.js`.

### 2b. Split the pool between AM and PM (proportional to gross)

```
productionDeductionAM = (amGross / totalGross) × productionDeductionTotal
productionDeductionPM = (pmGross / totalGross) × productionDeductionTotal
```

### 2c. Distributable per shift

```
distributableAM = amGross − productionDeductionAM
distributablePM = pmGross − productionDeductionPM
```

### 2d. Subtract any manual tips already paid out

```
adjustedDistributableAM = max(0, distributableAM − manualAMTipsTotal)
adjustedDistributablePM = max(0, distributablePM − manualPMTipsTotal)
```

### 2e. Weighted hours (denominator)

```
totalWeightedAMHours = Σᵢ amHoursᵢ × jobMultiplierᵢ
totalWeightedPMHours = Σᵢ pmHoursᵢ × jobMultiplierᵢ
```

`jobMultiplier` comes from `JOB_TIP_MULTIPLIERS` in `backend/utils/constants.js`:

| Job title  | Multiplier |
| ---------- | ---------- |
| (default)  | 1.00       |
| Dishwasher | 0.75       |

### 2f. Tip rates

```
amTipRate = (totalWeightedAMHours > 0) ? adjustedDistributableAM / totalWeightedAMHours : 0
pmTipRate = (totalWeightedPMHours > 0) ? adjustedDistributablePM / totalWeightedPMHours : 0
```

### 2g. Per-employee tips

```
amTipsᵢ = amHoursᵢ × amTipRate × jobMultiplierᵢ
pmTipsᵢ = pmHoursᵢ × pmTipRate × jobMultiplierᵢ
```

---

## 3. Step-by-step with this day's numbers

### Step 1 — Production pool

```
productionDeductionTotal = (632.00 + 282.17) × 0.054
                        = 914.17 × 0.054
                        = 49.36518          → shown as $49.365
```

### Step 2 — AM/PM split of the pool

```
productionDeductionAM = (632.00  / 914.17) × 49.36518
                     ≈ 0.691347 × 49.36518
                     ≈ 34.128

productionDeductionPM = (282.17  / 914.17) × 49.36518
                     ≈ 0.308653 × 49.36518
                     ≈ 15.237
```

Sanity check: 34.128 + 15.237 = 49.365 ✓

### Step 3 — Distributable

```
distributableAM = 632.00 − 34.128 = 597.872   → AM distributable: $597.872
distributablePM = 282.17 − 15.237 = 266.932   → PM distributable: $266.932
```

### Step 4 — Adjusted distributable

No manual entries on this date:

```
adjustedDistributableAM = 597.872
adjustedDistributablePM = 266.932
```

### Step 5 — Weighted hours

Apply the literal formula `Σᵢ hoursᵢ × jobMultiplierᵢ`. Reverse-engineering the per-row tips reveals two employees on the Dishwasher (0.75) multiplier; everyone else is on the default 1.00:

| Employee                  | Multiplier | AM hrs | PM hrs |
| ------------------------- | ---------- | -----: | -----: |
| Aimee RAS                 | 0.75       | 0.583  | 7.516  |
| Alexia Brenn MANLAPAZ     | 1.00       | 0.000  | 6.616  |
| Allison CROES             | 1.00       | 6.500  | 1.283  |
| Amilaine GEERMAN          | 1.00       | 0.583  | 7.216  |
| Amy ENGELHART             | 1.00       | 6.916  | 0.633  |
| Govanne QUANDUS           | 1.00       | 7.000  | 0.616  |
| Isabella KELLY            | 1.00       | 6.533  | 1.133  |
| Lorena GRAUT PAVA         | 1.00       | 6.650  | 1.050  |
| Maholis OBREGON CAICEDO   | 1.00       | 6.533  | 1.150  |
| Nafes RODRIGUES DOS S.    | 1.00       | 0.483  | 6.983  |
| Sarai DELGADO ROMERO      | 1.00       | 0.600  | 7.683  |
| Sugey REYES HOYOS         | 0.75       | 7.100  | 0.566  |
| Yuris RILEY               | 1.00       | 5.466  | 1.066  |
| Zael SIERRA MORALES       | 1.00       | 6.483  | 0.966  |

#### AM weighted hours

```
totalWeightedAMHours = Σᵢ amHoursᵢ × jobMultiplierᵢ

  = 0.583 × 0.75      ← Aimee RAS (Dishwasher)
  + 0.000 × 1.00      ← Alexia Brenn MANLAPAZ
  + 6.500 × 1.00      ← Allison CROES
  + 0.583 × 1.00      ← Amilaine GEERMAN
  + 6.916 × 1.00      ← Amy ENGELHART
  + 7.000 × 1.00      ← Govanne QUANDUS
  + 6.533 × 1.00      ← Isabella KELLY
  + 6.650 × 1.00      ← Lorena GRAUT PAVA
  + 6.533 × 1.00      ← Maholis OBREGON CAICEDO
  + 0.483 × 1.00      ← Nafes RODRIGUES DOS SANTOS
  + 0.600 × 1.00      ← Sarai DELGADO ROMERO
  + 7.100 × 0.75      ← Sugey REYES HOYOS (Dishwasher)
  + 5.466 × 1.00      ← Yuris RILEY
  + 6.483 × 1.00      ← Zael SIERRA MORALES

  = 0.4373 + 0.0000 + 6.5000 + 0.5830 + 6.9160 + 7.0000
  + 6.5330 + 6.6500 + 6.5330 + 0.4830 + 0.6000 + 5.3250
  + 5.4660 + 6.4830

  ≈ 59.512
```

#### PM weighted hours

```
totalWeightedPMHours = Σᵢ pmHoursᵢ × jobMultiplierᵢ

  = 7.516 × 0.75      ← Aimee RAS (Dishwasher)
  + 6.616 × 1.00      ← Alexia Brenn MANLAPAZ
  + 1.283 × 1.00      ← Allison CROES
  + 7.216 × 1.00      ← Amilaine GEERMAN
  + 0.633 × 1.00      ← Amy ENGELHART
  + 0.616 × 1.00      ← Govanne QUANDUS
  + 1.133 × 1.00      ← Isabella KELLY
  + 1.050 × 1.00      ← Lorena GRAUT PAVA
  + 1.150 × 1.00      ← Maholis OBREGON CAICEDO
  + 6.983 × 1.00      ← Nafes RODRIGUES DOS SANTOS
  + 7.683 × 1.00      ← Sarai DELGADO ROMERO
  + 0.566 × 0.75      ← Sugey REYES HOYOS (Dishwasher)
  + 1.066 × 1.00      ← Yuris RILEY
  + 0.966 × 1.00      ← Zael SIERRA MORALES

  = 5.6370 + 6.6160 + 1.2830 + 7.2160 + 0.6330 + 0.6160
  + 1.1330 + 1.0500 + 1.1500 + 6.9830 + 7.6830 + 0.4245
  + 1.0660 + 0.9660

  ≈ 42.462
```

The `61.433` (AM) and `44.483` (PM) you see in the totals row are the **raw** summed hours — they would only equal the weighted hours if every employee were on the default 1.00 multiplier. The tip-rate denominator uses the weighted sums above.

### Step 6 — Tip rates

```
amTipRate = 597.872 / 59.512  ≈ 10.046 $/hr   → AM tip rate: $10.046/hr ✓
pmTipRate = 266.932 / 42.462  ≈  6.286 $/hr   → PM tip rate: $6.286/hr ✓
```

---

## 4. Per-employee verification

`amTipsᵢ = amHoursᵢ × $10.046 × multiplierᵢ`
`pmTipsᵢ = pmHoursᵢ × $6.286 × multiplierᵢ`

| Employee                  | Mult. | AM hrs | AM tips (calc) | AM tips (shown) | PM hrs | PM tips (calc) | PM tips (shown) |
| ------------------------- | ----- | -----: | -------------: | --------------: | -----: | -------------: | --------------: |
| Aimee RAS                 | 0.75  | 0.583  | $4.392         | $4.395          | 7.516  | $35.435        | $35.439         |
| Alexia Brenn MANLAPAZ     | 1.00  | 0.000  | $0.000         | $0.000          | 6.616  | $41.589        | $41.594         |
| Allison CROES             | 1.00  | 6.500  | $65.299        | $65.300         | 1.283  | $8.063         | $8.067          |
| Amilaine GEERMAN          | 1.00  | 0.583  | $5.857         | $5.860          | 7.216  | $45.359        | $45.366         |
| Amy ENGELHART             | 1.00  | 6.916  | $69.478        | $69.485         | 0.633  | $3.978         | $3.981          |
| Govanne QUANDUS           | 1.00  | 7.000  | $70.322        | $70.323         | 0.616  | $3.872         | $3.876          |
| Isabella KELLY            | 1.00  | 6.533  | $65.630        | $65.634         | 1.133  | $7.120         | $7.124          |
| Lorena GRAUT PAVA         | 1.00  | 6.650  | $66.806        | $66.806         | 1.050  | $6.600         | $6.600          |
| Maholis OBREGON CAICEDO   | 1.00  | 6.533  | $65.630        | $65.634         | 1.150  | $7.229         | $7.229          |
| Nafes RODRIGUES DOS S.    | 1.00  | 0.483  | $4.852         | $4.855          | 6.983  | $43.895        | $43.899         |
| Sarai DELGADO ROMERO      | 1.00  | 0.600  | $6.028         | $6.027          | 7.683  | $48.295        | $48.299         |
| Sugey REYES HOYOS         | 0.75  | 7.100  | $53.495        | $53.495         | 0.566  | $2.668         | $2.671          |
| Yuris RILEY               | 1.00  | 5.466  | $54.911        | $54.918         | 1.066  | $6.701         | $6.705          |
| Zael SIERRA MORALES       | 1.00  | 6.483  | $65.128        | $65.132         | 0.966  | $6.072         | $6.076          |
| **Totals**                |       | **61.433** | **$597.87**| **$597.87**     | **44.483** | **$266.93**| **$266.93**     |

Sub-cent differences come from the engine using the un-truncated hours (e.g. `7.10000xxx`) while the table shows hours truncated to three decimals. The totals reconcile exactly to the AM/PM distributable pools — every dollar of distributable tips is paid out through the tip rate.

---

## 5. One-line summaries

- **AM tip rate** = `(632.00 − 5.4 % AM share) / weighted AM hours` = **$597.872 / 59.512 ≈ $10.046/hr**
- **PM tip rate** = `(282.17 − 5.4 % PM share) / weighted PM hours` = **$266.932 / 42.462 ≈ $6.286/hr**

---

## 6. Source references

| Concept                     | Location                                              |
| --------------------------- | ----------------------------------------------------- |
| 5.4% production pool        | `PRODUCTION_DEDUCTION_PERCENT` in `backend/utils/constants.js` |
| Job multipliers             | `JOB_TIP_MULTIPLIERS` in `backend/utils/constants.js`         |
| Casa del Mar shift bounds   | `SHIFT_BOUNDARIES_CASA_ORANJESTAD` in `backend/utils/constants.js` |
| Pool / distributable split  | `computeProductionPoolAndDistributables()` in `backend/services/tipsCalculationService.js` |
| Manual tip subtraction      | `adjustedDistributableAM` / `adjustedDistributablePM` blocks in `backend/services/tipsCalculationService.js` |
| Weighted hours              | `weightedHoursForTipRate()` in `backend/services/tipsCalculationService.js` |
| Tip-rate formula            | `amTipRate` / `pmTipRate` assignment in `backend/services/tipsCalculationService.js` |
| Per-employee tips           | `amTipsRaw` / `pmTipsRaw` loop in `backend/services/tipsCalculationService.js` |
| Frontend display            | `AM tip rate` / `PM tip rate` line in `frontend/src/pages/DailyTips.jsx` |
