FROM oven/bun:1.3.14-slim

# Install tools needed by tests (ssh-keygen, git, nano)
RUN apt-get update && apt-get install -y openssh-client git nano && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config for layer caching
COPY package.json bun.lockb ./
COPY cli/package.json cli/
COPY website/package.json website/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source and tests
COPY cli/ cli/
COPY .github/workflows/publish-aur-package.yml .github/workflows/publish-aur-package.yml

# Run unit tests only (e2e has a dedicated Docker image/job)
ENTRYPOINT ["bun", "test", "--isolate", "/app/cli/src/tests"]
