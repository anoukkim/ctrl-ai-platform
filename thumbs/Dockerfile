# thumbs — the thumbnail render worker (thumbnail-render-worker).
#
# A pinned Playwright image: Chromium and the Python bindings at exactly
# this version, nothing fetched at run time. Built by GitHub Actions like
# the api and web images; the server only pulls. The container runs
# read-only as the image's unprivileged user, with Chromium's own sandbox
# on (docker-compose.prod.yml adds the seccomp profile, the socket volume,
# the memory, CPU and capability limits — and no network to the others).
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Chromium writes its profile and caches under HOME; /tmp is the
    # container's one writable place (a tmpfs).
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_CONFIG_HOME=/tmp/.config

WORKDIR /srv/thumbs
COPY worker.py ./

# `pwuser` exists in the base image (uid 1000); the browsers are readable
# by everyone there.
USER pwuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python worker.py --probe

CMD ["python", "worker.py"]
