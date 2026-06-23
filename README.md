# Personal Calendar & Mood Tracker

![Calendar Image](images/calendar.png)

## Features

- **Interactive Calendar Interface**
  - Monthly view with intuitive navigation
  - Keyboard shortcuts for navigation (h/l keys)

- **Event Management**
  - Create, edit, and delete events
  - Add location, attendees, and notes to events
  - Daily mood logging with color coding

## Development Setup (uv)

1. Install [`uv`](https://docs.astral.sh/uv/).
2. Create the project environment and install dependencies:

```bash
uv sync
```

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

> Code is baked into the image at build time. After pulling changes, rebuild:
> `docker compose build calendar && docker compose up -d calendar`. A bare
> `up -d` reuses the old image.

The DB lives at `instance/events.db` (bind-mounted in compose). The container
runs `flask db upgrade` on start, so migrations apply automatically.

## Search

Hybrid semantic + keyword search over diary entries (events and their
subevents), entirely on-device — no external services or API keys. Retrieval
combines local embeddings (`fastembed` / ONNX), SQLite FTS5 lexical matching,
and metadata filters (date range, mood, who, where), fused with Reciprocal Rank
Fusion. Search lives at the top of the **Stats** view; clicking a result jumps to
that day on the calendar.

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

## Schema changes

After editing `models.py`:

```bash
uv run flask --app app:create_app db migrate -m "describe the change"
uv run flask --app app:create_app db upgrade
```