# Mood: DB table → config — migration plan

**Goal:** moods become a single config (key · name · color · order); `DailyLog`
stores a mood **key**; the colour round-trip and the `Mood` table are deleted.

## Why

`Mood` is config-shaped, not data-shaped: a fixed, global, 5-row set with no
`user_id` that only changes when we edit it. The DB version actively costs us:

- **A fragile colour-matching hack.** Mood identity is the colour string, so
  `routes/mood.py` re-identifies the picked mood by RGB triple
  (`_find_mood_by_color` + `_RGB_TRIPLE`) because browsers serialize alpha
  differently. The frontend *already* has the keys — `templates/index.html` has
  `data-mood="emerald|sea|turquoise|royal|purple"` — but `index.js` throws them
  away and sends `getComputedStyle(...).backgroundColor` instead. The whole hack
  is gratuitous.
- **Colours duplicated and drifting** — DB rows (`rgba(...,0.502)`) *and*
  `index.css` (`#2ecc7180`, …). The `index.css` comment even admits the drift.
- **No ordering** for consistent display.
- **Palette changes need a DB migration** instead of a one-line edit.

## Source of truth — `moods.py`

```python
MOODS = [
    {"key": "emerald",   "name": "Emerald",     "color": "#2ecc71", "order": 1},
    {"key": "sea",       "name": "Sea green",   "color": "#16a585", "order": 2},
    {"key": "turquoise", "name": "Turquoise",   "color": "#009595", "order": 3},
    {"key": "royal",     "name": "Royal blue",  "color": "#3674b5", "order": 4},
    {"key": "purple",    "name": "Blue purple", "color": "#5b5bb5", "order": 5},
]
MOOD_BY_KEY = {m["key"]: m for m in MOODS}
```

Cells render at ~50% alpha today — apply that in CSS, not the config.

## Phase 1 — Additive (no breakage, fully reversible)

1. Add `moods.py`.
2. Alembic migration: **add** `daily_logs.mood_key` (String, nullable). Leave
   `mood_id` in place.
3. **Backfill** `mood_key` from the existing `Mood` rows, mapping by **name**
   (not id — dev and Pi ids may differ):

   ```python
   NAME_TO_KEY = {"Emerald": "emerald", "Sea green": "sea", "Turquoise": "turquoise",
                  "Royal blue": "royal", "Blue purple": "purple"}
   # UPDATE daily_logs SET mood_key = NAME_TO_KEY[moods.name] via join
   ```

   ⚠️ Before running on the Pi, confirm its `moods` table has these exact 5
   names; adjust the map if it drifted.

*Checkpoint: both columns coexist; nothing reads `mood_key` yet.*

## Phase 2 — Switch reads + writes to the config

4. **FE — `static/js/index.js`:** send the key, not the colour. Replace
   `getComputedStyle(option).backgroundColor` → `option.dataset.mood`; POST body
   becomes `{year, month, day, mood: key}` (or `mood: null` to clear).
5. **`routes/mood.py`:** accept `mood` (key); validate against `MOOD_BY_KEY`; set
   `DailyLog.mood_key`. **Delete** `_find_mood_by_color`, `_rgb_triple`,
   `_RGB_TRIPLE`, and the `Mood` import.
6. **`utils.py`:** every `log.mood.color` / `log.mood` usage (`get_daily_logs`,
   `get_month_data`, `get_year_data`, `get_stats_data`) resolves via
   `MOOD_BY_KEY[log.mood_key]`. Backend keeps emitting resolved `color`/`name` in
   its payloads, so calendar-cell and stats rendering need **no further FE
   change**.
7. **Single-source the colours:** inject `:root{--mood-emerald:#2ecc71;…}` from
   `MOODS` in the base template and have `index.css` swatches + cell styles use
   `var(--mood-…)`. Kills the DB-vs-CSS drift.

*Checkpoint: pick/clear works via keys; calendar + stats render identically;
`mood_id` now unused.*

## Phase 3 — Drop the DB Mood (cleanup)

8. Alembic migration: drop `daily_logs.mood_id` (FK), drop the `moods` table.
9. Remove the `Mood` model + the `DailyLog.mood` relationship from `models.py`.
10. Grep for stragglers (`Mood`, `mood_id`, `mood.color`) across `routes/`,
    `utils.py`, `tests/`.

## Cross-cutting

- **Rollback:** back up `instance/events.db` before each migration; give each
  Alembic revision a real `downgrade()` (Phase 1 down = drop `mood_key`; Phase 3
  down = recreate `moods` + `mood_id`, best-effort — re-derived ids won't match
  originals).
- **Tests:** `routes/mood.py` update/clear, `utils.get_stats_data`, and a
  month/year render — assert colours still resolve.
- **Deploy order (home stack):** Phases 1 → 2 → 3 as separate commits/deploys;
  the container runs `flask db upgrade` on start, so migrations auto-apply. Don't
  squash Phase 3's drop into Phase 1 — separate phases mean a bad Phase 2 is
  trivially revertible while data is intact.

## Caveat: `order`, not `score`

This uses `order` (display), **not** `score`. The palette is green→blue, not a
good→bad scale, so an "average mood" is meaningless. If you later want the stats
*trend line*, redefine the palette as an emotional scale and add `score` — a
one-field config change, no migration. The current "mood mix" stat needs only
`order`.
