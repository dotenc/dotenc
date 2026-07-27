FROM oven/bun:1.3.14-slim

# Install openssh-client for ssh-keygen and expect for PTY-driven e2e flows
RUN apt-get update && apt-get install -y openssh-client git expect && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown bun:bun /app

# Copy workspace config for layer caching
COPY --chown=bun:bun package.json bun.lockb ./
COPY --chown=bun:bun cli/package.json cli/
COPY --chown=bun:bun website/package.json website/

USER bun

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source and e2e tests
COPY --chown=bun:bun cli/ cli/

ENTRYPOINT ["bun", "test", "--isolate", "/app/cli/e2e/tests/"]
