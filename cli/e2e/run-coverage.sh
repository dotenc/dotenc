#!/usr/bin/env bash
set -euo pipefail

cd /app/cli

rm -rf /tmp/node-v8-coverage
mkdir -p /tmp/node-v8-coverage

# Build a Node-targeted bundle with a linked sourcemap so c8 can discover and
# remap coverage to src/*.ts.
bun build src/cli.ts \
	--outdir dist \
	--target node \
	--packages external \
	--sourcemap=linked

export DOTENC_E2E_CLI_RUNTIME="node"
export DOTENC_E2E_CLI_PATH="/app/cli/dist/cli.js"
export NODE_V8_COVERAGE="/tmp/node-v8-coverage"

bun test --isolate /app/cli/e2e/tests/

rm -rf /cov/*
bunx c8 report \
	--temp-directory /tmp/node-v8-coverage \
	--reporter lcov \
	--reporter text-summary \
	--report-dir /cov
