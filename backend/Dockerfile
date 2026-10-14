# CTRL+AI backend (FastAPI) — the `api` service in docker-compose.prod.yml.
#
# Built by GitHub Actions and pulled by the server; the server never builds.
# Nothing secret is in this image: the server's .env is handed to the
# container at run time (docker-compose.prod.yml, `env_file`).
#
# Migrations are a separate, documented step — never run at start-up, so
# two workers can never race to migrate the same database:
#
#   docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
# The example apps `python -m app.db.import_example_apps` publishes.
COPY examples ./examples

# Run as an ordinary user. var/storage is where generated files live and
# var/apps where member apps are written (builder-static-runtime); the
# compose file mounts a named volume on each, which Docker creates with
# this ownership.
RUN useradd --system --uid 10001 --home-dir /app ctrlai \
    && mkdir -p /app/var/storage /app/var/apps \
    && chown -R ctrlai /app/var
USER ctrlai

# PORT: the platform's port (8000 inside the compose network).
# WEB_CONCURRENCY: worker processes — set in .env (2 for the e2-medium).
ENV PORT=8000 \
    WEB_CONCURRENCY=2
EXPOSE 8000

# --proxy-headers: the client's address arrives in X-Forwarded-For from
# Caddy and Next.js. Trusting every forwarder is safe only because this
# port is reachable from inside the compose network alone.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --workers \"$WEB_CONCURRENCY\" --proxy-headers --forwarded-allow-ips='*'"]
