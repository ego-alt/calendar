# Personal Calendar & Mood Tracker

![Calendar Image](images/calendar.png)

## Features

A retrospective life log: how each day felt, what happened, the receipts and
tickets that go with it, and the trends over time.

- **Calendar** — Month, Week, Year and Diary views (one switch on desktop, a
  bottom bar on phones). Tap any day to open it: set its **mood** (Great →
  Rough), toggle the **marker** (a small, unlabelled red dot, a private
  tracker shown quietly on the calendar and the mood trend), write **entries** with optional times, people, places and notes, add
  **moments** inside an entry, and attach **photos and PDFs**.
- **Never lose writing** — half-written entries are kept as drafts per day and
  come back when the day reopens; deletes (entries, moments, attachments) can
  be undone, and are purged after 30 days.
- **Diary** — a month to read back, day by day, with moods, entries, moments
  and attachments; **Year** — twelve tappable months.
- **Stats** — logged days, streak, mood calendar (tap a day to open it), mood
  over time (actual / 7-day / 28-day), mood mix by month or weekday, days with
  entries, and **Mood with…**: average mood with each person and at each place
  against your overall average. Last 12 months or any year.
- **Search** — by meaning, words and filters (date, mood, who, where); typed
  phrases like "dinner with Sam last month" are understood.
- **Receipts & tickets** — from the day panel or the phone scanner app; HEIC
  photos become JPEGs, every photo gets a thumbnail, and each attachment can
  have a caption and belong to one of the day's entries.
- **Export** — the whole diary as a zip (JSON, a Markdown diary, the original
  files), from the foot of the Stats page.
- **Installable** — add it to a phone's home screen; days you've opened stay
  readable offline.
- **Keyboard** — `←`/`→` (or `h`/`l`) month or week, `j`/`k` year, `t` today,
  `m` `w` `y` `d` views, `n` write, `1`–`5` mood, `x` marker, `/` search, `?`
  for the list.

## Development Setup (uv)

1. Install [`uv`](https://docs.astral.sh/uv/).
2. Create the project environment and install dependencies:

```bash
uv sync
```

   On an Intel Mac this fails: the locked `onnxruntime` (used by search) only
   ships wheels for Apple-silicon Macs, Linux and Windows. Either develop on one
   of those, or install the dependencies into a separate environment with an
   older `onnxruntime<1.20`.

3. Initialize the database (fresh clones):

```bash
uv run flask --app app:create_app db upgrade
```

   If you already have an `instance/events.db` from before migrations were introduced,
   stamp it once instead of upgrading:

```bash
uv run flask --app app:create_app db stamp head
```

4. Run the app:

```bash
uv run flask --app app:create_app run --port 8001
```

5. Run linting:

```bash
uv run ruff check .
```

6. Run tests:

```bash
uv run pytest
```

## Home stack (with dashboard)

Served at `/calendar/` behind the [dashboard](../dashboard) nginx proxy, gated by
its `auth_request` and wired into `../dashboard/docker-compose.yml` (internal
port `5002`). Set:

```bash
AUTH_PROXY_HEADER=X-Forwarded-User
APPLICATION_ROOT=/calendar
```

Dashboard handles login; this app trusts `X-Forwarded-User` and stores events and
mood data against local `users` rows. Omit both variables for standalone dev.

After adding a user in dashboard:

```bash
cd ../dashboard && uv run python scripts/sync_household_users.py
```

> On the Pi, merged commits that pass CI deploy themselves within about five
> minutes (see the dashboard README, "Deploying"). To deploy by hand: code is
> baked into the image at build time, so after pulling run
> `docker compose build calendar && docker compose up -d calendar`. A bare `up -d`
> reuses the old image.

The DB lives at `instance/events.db` (bind-mounted in compose). The container
runs `flask db upgrade` on start, so migrations apply automatically.

## Search

Hybrid semantic + keyword search over diary entries (events and their
subevents), entirely on-device — no external services or API keys. Retrieval
combines local embeddings (`fastembed` / ONNX), SQLite FTS5 lexical matching,
and metadata filters (date range, mood, who, where), fused with Reciprocal Rank
Fusion. Search is its own top-level view (the **Search** tab, at `/search`);
clicking a result jumps to that day on the calendar.

Entries are indexed automatically on create/edit/delete. Build (or rebuild) the
index for existing data:

```bash
uv run flask --app app:create_app reindex
```

Tunables (optional env vars):

- `SEARCH_DENSE_MIN_SCORE` — cosine floor for semantic matches (default `0.6`).
  Lower for more recall, raise to cut weak matches.
- `FASTEMBED_CACHE_PATH` — where the embedding model is cached. The Docker image
  bakes it in at build time so the container needs no network at runtime.

## Receipts and tickets

Each day can hold photos and PDFs (receipts, tickets), attached in the day
panel or sent from the phone scanner app (`POST /attachments` with `file`,
`year`, `month`, `day`). Only images and PDFs are accepted (up to 10 MB each);
iPhone HEIC photos are converted to JPEG on upload, and a small thumbnail is
kept for each photo (`instance/attachments/thumbs/`). An attachment can have a
caption and can be linked to one of the day's entries, which shows it in that
entry's card.

## Deleting and undo

Deleting an entry, a moment or an attachment marks it deleted (`deleted_at`) and
offers **Undo**; nothing deleted shows anywhere (calendar, diary, stats,
search). Items deleted more than 30 days ago are removed for good, attachment
files included, on the next delete or with:

```bash
uv run flask --app app:create_app purge-deleted
```

## Schema changes

After editing `models.py`:

```bash
uv run flask --app app:create_app db migrate -m "describe the change"
uv run flask --app app:create_app db upgrade
```