FROM rust:1.95-bookworm AS market-data-build

WORKDIR /app/services/market-data

COPY services/market-data/Cargo.toml services/market-data/Cargo.lock ./
COPY services/market-data/src ./src
COPY shared /app/shared
RUN cargo build --release --locked

FROM debian:bookworm-slim AS market-data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=market-data-build /app/services/market-data/target/release/market-data /usr/local/bin/market-data
ENV MARKET_DATA_BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["market-data"]

FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./
RUN npm ci
RUN python3 -m venv /opt/stock-venv \
  && /opt/stock-venv/bin/python -m pip install --no-cache-dir --upgrade pip \
  && /opt/stock-venv/bin/python -m pip install --no-cache-dir -r requirements.txt

COPY . .
ENV PYTHON_BIN=/opt/stock-venv/bin/python
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
