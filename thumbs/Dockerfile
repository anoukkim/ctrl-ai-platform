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

# The image ships the browsers (/ms-playwright, PLAYWRIGHT_BROWSERS_PATH)
# but not the Python package — installed here at exactly the image's
# version, so it finds those browsers (found at the first server render,
# 2026-10-17: "No module named 'playwright'"). The image's Python is the
# system one; this container has nothing else to break.
RUN pip install --no-cache-dir --break-system-packages playwright==1.62.0 \
    && python -c "import playwright.sync_api"

WORKDIR /srv/thumbs
COPY worker.py ./

# The socket directory, shared with the api through the `thumbs_sock`
# volume. A new named volume takes this directory's mode from whichever
# image mounts it first, so the api image makes the same one: 1777 (like
# /tmp) lets the worker create its socket whichever user it runs as, and
# the sticky bit keeps anyone else from removing it. Without this the
# volume came up root-owned and the worker could not bind (2026-10-17).
RUN mkdir -p /run/thumbs && chmod 1777 /run/thumbs

# `pwuser` exists in the base image (uid 1000); the browsers are readable
# by everyone there.
USER pwuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python worker.py --probe

CMD ["python", "worker.py"]
