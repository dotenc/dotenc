---
title: "Provider runbooks"
description: "Provider runbooks with dotenc, the Git-native encrypted environment CLI."
---

## Provider runbooks

Some CI/CD providers need extra setup because build steps, environment
resolution, or secret storage work differently from a generic shell pipeline.

- [GitHub Actions](/docs/ci/github-actions/) — use a dedicated GitHub Actions
  key, then run commands, export allowlisted variables, or write file-shaped
  credentials from encrypted dotenc environments.
- [Expo / EAS](/docs/ci/expo-eas/) — choose one lean path: EAS cloud builds with
  an EAS dotenc identity, or GitHub local builds with a GitHub dotenc identity.
- [Vercel](/docs/ci/vercel/) — use a dedicated Vercel dotenc identity for
  Vercel-owned cloud builds, then wrap the Vercel build command.
- [Netlify](/docs/ci/netlify/) — use a dedicated Netlify dotenc identity for
  Netlify-owned cloud builds, then wrap the Netlify build command.
- [Cloudflare](/docs/ci/cloudflare/) — choose the trust boundary for Pages Git
  builds, Pages Direct Upload, Workers Builds, or external Wrangler deploys.
- [Coolify](/docs/ci/coolify/) — add
  dotenc to the application's existing Dockerfile, Railpack, or Nixpacks image,
  then keep decryption at runtime when possible.
- [Railpack](/docs/ci/railpack/) —
  compose the CLI image as a generic build or deploy layer without replacing
  the auto-detected application runtime.
- [Nixpacks](/docs/ci/nixpacks/) —
  support existing Nixpacks deployments with a pinned standalone binary;
  prefer Railpack for new generated-image deployments.
- [Provider helpers roadmap](https://github.com/dotenc/dotenc/blob/main/docs/PROVIDER_HELPERS_ROADMAP.md) — track planned
  presets, provider plugins, provider CLIs, and the criteria for revisiting
  builder images.
