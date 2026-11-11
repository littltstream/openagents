FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     libpq-dev \
#     && rm -rf /var/lib/apt/lists/*
RUN sed -i \
    's|http://deb.debian.org|https://mirrors.cloud.tencent.com|g' \
    /etc/apt/sources.list.d/debian.sources \
    && apt-get -o APT::Update::Error-Mode=any update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple

# Production uses Browser Fabric (cloud) via BROWSERFABRIC_API_KEY — all
# browser operations are proxied via REST API, no local Chromium needed.
# For local-browser dev mode, install playwright and run
# `playwright install chromium`.

# Copy application code
COPY . .

RUN chmod +x entrypoint.sh

ENV PYTHONPATH=/app

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
