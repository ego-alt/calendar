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

# Set production environment variables
ENV FLASK_ENV=production
ENV FLASK_APP=app.py

# Expose the port that the app will run on
EXPOSE 8001

# Run the Flask application using Gunicorn with the correct module reference.
# This tells Gunicorn to call the create_app() factory in app.py.
CMD ["uv", "run", "gunicorn", "app:create_app()", "--bind", "0.0.0.0:8001", "--workers", "3", "--timeout", "120", "--worker-class", "sync"]
