# syntax=docker/dockerfile:1
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy project metadata first to leverage Docker cache
COPY pyproject.toml uv.lock /app/

# Install dependencies from the lock file
RUN uv sync --frozen --no-dev --no-install-project

# Copy the rest of the project files
COPY . /app/

# Install the local project after source is copied
RUN uv sync --frozen --no-dev

# Bake the embedding model into the image so runtime search needs no network
# egress (the home stack may be locked down). search_index reads the same env var.
ENV FASTEMBED_CACHE_PATH=/app/.fastembed_cache
RUN uv run python -c "import os; from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-small-en-v1.5', cache_dir=os.environ['FASTEMBED_CACHE_PATH'])"

# Set production environment variables
# Runs as uid 10001, like the dashboard; the data folder (instance/, mounted
# from the Pi) must belong to it. The embedding model takes a lock as it loads.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/instance && chown -R app:app /app/instance "$FASTEMBED_CACHE_PATH"
USER app
ENV HOME=/tmp

ENV FLASK_ENV=production
ENV FLASK_APP=app:create_app

# Expose the port that the app will run on
EXPOSE 8001

# Apply pending migrations, then start the Flask application via Gunicorn.
# Straight from the virtualenv: `uv run` would install the dev tools on every start.
CMD ["sh", "-c", ".venv/bin/flask db upgrade && exec .venv/bin/gunicorn 'app:create_app()' --bind 0.0.0.0:8001 --workers 3 --timeout 120 --worker-class sync"]
