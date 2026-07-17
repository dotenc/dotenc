# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.10

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /repo

COPY package.json bun.lockb bunfig.toml tsconfig.base.json ./
COPY cli/package.json cli/tsconfig.json cli/
COPY website/package.json website/package.json

RUN bun install --frozen-lockfile

COPY cli/src cli/src

ARG TARGETARCH
RUN set -eux; \
	arch="${TARGETARCH:-$(uname -m)}"; \
	case "$arch" in \
		amd64|x86_64) target="bun-linux-x64" ;; \
		arm64|aarch64) target="bun-linux-arm64" ;; \
		*) echo "Unsupported target architecture: $arch" >&2; exit 1 ;; \
	esac; \
	bun build cli/src/cli.ts --compile --target="$target" --outfile /out/dotenc; \
	chmod +x /out/dotenc

FROM debian:bookworm-slim AS runtime

ARG DOTENC_VERSION=dev
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="dotenc CLI" \
	org.opencontainers.image.description="Git-native encrypted environments powered by SSH keys" \
	org.opencontainers.image.source="https://github.com/dotenc/dotenc" \
	org.opencontainers.image.url="https://github.com/dotenc/dotenc" \
	org.opencontainers.image.documentation="https://github.com/dotenc/dotenc#readme" \
	org.opencontainers.image.licenses="MIT" \
	org.opencontainers.image.version="${DOTENC_VERSION}" \
	org.opencontainers.image.revision="${VCS_REF}"

RUN set -eux; \
	apt-get update; \
	DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates openssh-client; \
	rm -rf /var/lib/apt/lists/*; \
	groupadd --gid 10001 dotenc; \
	useradd --uid 10001 --gid dotenc --create-home --home-dir /home/dotenc --shell /usr/sbin/nologin dotenc; \
	mkdir -p /workspace; \
	chown dotenc:dotenc /workspace

COPY --from=build /out/dotenc /usr/local/bin/dotenc

USER dotenc
ENV HOME=/home/dotenc
WORKDIR /workspace

ENTRYPOINT ["dotenc"]
CMD ["--help"]
