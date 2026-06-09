# Expo / EAS runbook

This runbook describes two lean ways to use dotenc with Expo apps. Choose the
runner that owns the build, then give that runner the dotenc identity.

Do not mix the two approaches for the same release path. Running an EAS cloud
build while GitHub Actions also decrypts release values creates extra glue,
duplicate secret surfaces, and no useful security boundary.

## When to use this

Use this runbook when an Expo app keeps build-time configuration in encrypted
`.env.*.enc` files and needs those values during a build, for example:

- `APP_VARIANT`
- `EXPO_PUBLIC_*` values that are intentionally bundled into the app
- native config values read by `app.config.js`
- store, ads, purchases, analytics, or feature flag IDs

Do not put secrets that must stay hidden from users in `EXPO_PUBLIC_*`
variables. Expo inlines `EXPO_PUBLIC_*` values into the client bundle.

## Choose one path

| Path | Build runner | CD runner | GitHub secrets | dotenc identity | dotenc GitHub Actions |
| --- | --- | --- | --- | --- | --- |
| Cloud build | EAS cloud workers | EAS Workflows | None | EAS gets `DOTENC_PRIVATE_KEY_BASE64`, plus optional passphrase | No |
| Local build | GitHub-hosted runners | GitHub Actions | `DOTENC_PRIVATE_KEY_BASE64`, plus optional passphrase | GitHub gets `DOTENC_PRIVATE_KEY_BASE64`, plus optional passphrase | Yes |

Cloud build is the default recommendation when you want EAS Build and EAS
Workflows to own production delivery through the EAS GitHub integration. Local
build is useful when the GitHub runner must own the whole build and release
process with `eas build --local`.

In cloud mode, GitHub does not need any release secrets. EAS receives GitHub
events through its GitHub integration and decrypts build and submit values on
EAS infrastructure.

If GitHub runs `eas build --local`, EAS is not the process decrypting dotenc.
Give GitHub the identity, use the reusable dotenc actions there, and do not
also store a dotenc private key on EAS for that release path. `EXPO_TOKEN`
belongs in the encrypted dotenc environment for this path, because the GitHub
runner still needs EAS CLI authentication for `eas build --local` and
`eas submit`.

## Approach 1: Cloud build with EAS Workflows

In the cloud build approach, EAS owns build and CD. The EAS GitHub integration
starts workflows from GitHub events, and the EAS workers are the only machines
that decrypt the app's dotenc environments.

### 1. Create a dedicated EAS key

Create a dedicated key specifically for EAS. This example creates a passwordless
key; if you choose a passphrase-protected key, also store
`DOTENC_PRIVATE_KEY_PASSPHRASE` on EAS as described below:

```bash
ssh-keygen -t ed25519 -f eas_key -N "" -C "eas"
```

Add the public key to the project and grant only the environments required for
cloud builds and submissions:

```bash
dotenc key add eas --from-ssh ./eas_key
dotenc auth grant production eas
git add .dotenc .env.production.enc
git commit -m "Grant EAS access to production environment"
```

### 2. Store the private key on EAS

Create an EAS environment variable named `DOTENC_PRIVATE_KEY_BASE64` in the
matching EAS environment, usually `production`. If the private key is encrypted,
also create `DOTENC_PRIVATE_KEY_PASSPHRASE` in the same EAS environment.

Recommended settings:

- Name: `DOTENC_PRIVATE_KEY_BASE64`
- Visibility: `secret`
- Scope: project-wide unless several projects intentionally share the same key
- Environment: the EAS environment used by the build profile or workflow job

For passphrase-protected keys, use the same settings for
`DOTENC_PRIVATE_KEY_PASSPHRASE`.

The value must be the base64-encoded private key file:

```bash
base64 < eas_key | tr -d '\n'
```

`DOTENC_PRIVATE_KEY` with the raw private key text is still supported for
backwards compatibility, but provider setup should prefer
`DOTENC_PRIVATE_KEY_BASE64`.

After the key is stored on EAS, delete the local copy:

```bash
rm eas_key eas_key.pub
```

### 3. Pin the EAS environment in `eas.json`

Set the EAS environment explicitly for every build profile that uses dotenc:

```json
{
  "build": {
    "production": {
      "environment": "production",
      "ios": {
        "buildConfiguration": "Release"
      },
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

This avoids accidental mismatches between the encrypted dotenc environment and
the EAS environment that contains `DOTENC_PRIVATE_KEY_BASE64`.

### 4. Use a custom EAS Build when config needs dotenc

Default EAS Build steps resolve Expo config and run native build phases without
being wrapped by dotenc. Use a Custom EAS Build when `app.config.js`, native
prebuild, or store builds need decrypted values.

The important ordering is:

1. Check out the repository.
2. Install dependencies.
3. Install dotenc.
4. Export allowlisted dotenc values before Expo config resolution or prebuild.
5. Run the usual EAS build steps.

For Android Play Store builds, the custom build must also inject signing
credentials before Gradle runs:

```yaml
build:
  name: Android production build with dotenc
  steps:
    - eas/checkout
    - eas/install_node_modules

    - run:
        name: Install dotenc
        command: npm install -g @dotenc/cli

    - run:
        name: Export production env from dotenc
        command: npx dotenc run --strict -e production node scripts/eas/export-dotenc-env.cjs

    - eas/resolve_build_config
    - eas/prebuild
    - eas/inject_android_credentials
    - eas/configure_android_version
    - eas/run_gradle
    - eas/find_and_upload_build_artifacts
```

Reference the custom build in `eas.json`:

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "production": {
      "autoIncrement": true,
      "environment": "production",
      "android": {
        "buildType": "app-bundle",
        "config": "production-android.yml"
      }
    }
  }
}
```

The `eas/inject_android_credentials` step is required for store builds that
will be uploaded to Google Play. Without it, a custom Android build can produce
an AAB that builds successfully but is rejected by Google Play as debug-signed.

Do not add `eas/configure_eas_update` unless the app actually installs and
configures `expo-updates`. For projects that do not use `expo-updates`, that
step can fail during local or cloud inspection.

### 5. Export only an allowlist

`dotenc run` only provides decrypted variables to the command it wraps. Custom
EAS Build steps run in separate shells, so later steps will not see those
variables automatically. When a later EAS step needs a decrypted value, run a
small allowlisted script under `dotenc run` and have that script call EAS
`set-env` for each variable that should be shared with later steps.

Minimal example:

```js
// scripts/eas/export-dotenc-env.cjs
const { spawnSync } = require('node:child_process');

const names = ['APP_VARIANT', 'EXPO_PUBLIC_API_URL'];

for (const name of names) {
  const value = process.env[name];

  if (!value) {
    console.error(`Missing required dotenc env var: ${name}`);
    process.exit(1);
  }

  const result = spawnSync('set-env', [name, value], {
    stdio: ['ignore', 'ignore', 'inherit']
  });

  if (result.status !== 0) process.exit(result.status || 1);
}
```

Use an explicit allowlist to avoid accidentally sharing unrelated CI variables
or dotenc internals with later build steps.

Example allowlisted export script:

```js
// scripts/eas/export-dotenc-env.cjs
const { spawnSync } = require('node:child_process');

const platform = process.env.EAS_BUILD_PLATFORM;
const commonNames = ['APP_VARIANT'];
const iosNames = [
  'EXPO_PUBLIC_ADMOB_IOS_APP_ID',
  'EXPO_PUBLIC_ADMOB_IOS_BANNER_ID',
  'EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID',
  'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'
];
const androidNames = [
  'EXPO_PUBLIC_ADMOB_ANDROID_APP_ID',
  'EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID',
  'EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY'
];

const names = [
  ...commonNames,
  ...(platform === 'android' ? androidNames : []),
  ...(platform === 'ios' || !platform ? iosNames : [])
];

const missing = names.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing required dotenc env vars: ${missing.join(', ')}`);
  process.exit(1);
}

for (const name of names) {
  const result = spawnSync('set-env', [name, process.env[name]], {
    stdio: ['ignore', 'ignore', 'inherit']
  });

  if (result.error) {
    console.error(`Failed to export ${name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status || 1);
}

const ready = spawnSync('set-env', ['DOTENC_ENV_READY', '1'], {
  stdio: ['ignore', 'ignore', 'inherit']
});

if (ready.status !== 0) process.exit(ready.status || 1);
```

### 6. Use EAS Workflows for CD

Put release automation in `.eas/workflows/*.yml`. The workflow runs on EAS
infrastructure, so it can use the same EAS `DOTENC_PRIVATE_KEY_BASE64` to decrypt
submission credentials inside EAS custom jobs.

Example Android build and submit workflow:

```yaml
name: Android production release

on:
  push:
    branches: ['main']
  workflow_dispatch: {}

jobs:
  build_android:
    name: Build Android
    type: build
    params:
      platform: android
      profile: production

  submit_android:
    name: Submit Android
    type: custom
    needs: [build_android]
    environment: production
    runs_on: linux-medium
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - name: Install dotenc
        run: npm install -g @dotenc/cli
      - name: Write Google Play service account
        run: |
          dotenc run --strict -e production node - <<'NODE'
          const fs = require('node:fs');
          const value = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

          if (!value) {
            console.error('Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON in dotenc.');
            process.exit(1);
          }

          fs.writeFileSync('google-play-service-account.json', value, { mode: 0o600 });
          NODE
      - name: Submit Android build to Google Play
        run: |
          npx eas-cli@latest submit \
            --platform android \
            --profile production \
            --id "${{ needs.build_android.outputs.build_id }}" \
            --non-interactive \
            --wait \
            --verbose
```

Do not use dotenc GitHub Actions in this approach. GitHub does not store release
secrets for this path. The app environment, Google Play JSON, and other release
values stay in dotenc and are decrypted on EAS by the EAS identity.

## Approach 2: Local build on GitHub runners

In the local build approach, GitHub owns build and CD. The GitHub runner uses
`eas build --local`, so GitHub is the system that needs the dotenc identity.
EAS does not need a dotenc private key for this release path.

### 1. Create a dedicated GitHub Actions key

Create a dedicated key specifically for GitHub Actions. This example creates a
passwordless key; if you choose a passphrase-protected key, also store
`DOTENC_PRIVATE_KEY_PASSPHRASE` in GitHub:

```bash
ssh-keygen -t ed25519 -f github_actions_key -N "" -C "github-actions"
dotenc key add github-actions --from-ssh ./github_actions_key
dotenc auth grant production github-actions
git add .dotenc .env.production.enc
git commit -m "Grant GitHub Actions access to production environment"
```

Store the base64-encoded private key in GitHub as
`DOTENC_PRIVATE_KEY_BASE64`:

```bash
base64 < github_actions_key | tr -d '\n'
```

If the key is encrypted, also store `DOTENC_PRIVATE_KEY_PASSPHRASE`. Delete the
temporary private key after storing it.

`EXPO_TOKEN`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, and other release values can
live in the encrypted dotenc environment that the GitHub Actions key can
decrypt.

### 2. Build locally with dotenc actions

Use `dotenc/export-action` only for values later steps need as environment
variables, and `dotenc/write-file-action` only for file-shaped credentials.

Example Android local build and submit workflow:

```yaml
name: Android local production release

on:
  push:
    branches: ['main']
  workflow_dispatch:

jobs:
  build:
    name: Build and submit Android locally
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - uses: dotenc/setup-action@v1

      - uses: dotenc/export-action@v1
        with:
          environment: production
          names: |
            EXPO_TOKEN
            APP_VARIANT
            EXPO_PUBLIC_ADMOB_ANDROID_APP_ID
            EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID
            EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID
            EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
        env:
          DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
          DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}

      - uses: dotenc/write-file-action@v1
        with:
          environment: production
          name: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
          path: google-play-service-account.json
        env:
          DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
          DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}

      - run: npx eas-cli@latest build --local --platform android --profile production --non-interactive --output ./app-release.aab

      - run: npx eas-cli@latest submit --platform android --profile production --path ./app-release.aab --non-interactive --wait --verbose
```

For iOS local builds, use a macOS runner and an `.ipa` output path:

```yaml
- run: npx eas-cli@latest build --local --platform ios --profile production --non-interactive --output ./app-release.ipa
- run: npx eas-cli@latest submit --platform ios --profile production --path ./app-release.ipa --non-interactive --wait
```

Local build runners should still keep exports short and explicit. Never export
the whole decrypted environment.

## Google Play submission

Android Play Store submission needs a Google Play service account JSON file and
an Android submit profile:

```json
{
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-play-service-account.json",
        "track": "internal",
        "releaseStatus": "completed"
      }
    }
  }
}
```

Keep `google-play-service-account.json` out of git. In cloud mode, materialize
it inside the EAS custom submit job with `dotenc run`. In local mode, materialize
it inside GitHub Actions with `dotenc/write-file-action`.

Play Store setup checklist:

- `android.package` in Expo config matches the package created in Play Console.
- The production Android build uses `android.buildType: "app-bundle"`.
- `cli.appVersionSource` is `remote` and the production profile has
  `autoIncrement: true`, or version codes are otherwise managed explicitly.
- The Google Play Android Developer API is enabled for the service account
  project.
- The service account is added in Play Console with permission to manage the
  target app and create releases on the intended track.
- The first upload uses a fresh version code that has never been submitted.
- Store-related IDs that are safe to bundle, such as AdMob app/unit IDs and
  RevenueCat public API keys, come from dotenc before config resolution.

## Local sanity checks

Run Expo config and prebuild locally under the same encrypted environment before
enabling CI/CD:

```bash
dotenc run --strict -e production npx expo config --type public
dotenc run --strict -e production npx expo prebuild --clean --platform ios
dotenc run --strict -e production npx expo prebuild --clean --platform android
```

For cloud builds, also run a manual EAS build after storing the EAS identity:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

## Troubleshooting

- `No private keys found`: `DOTENC_PRIVATE_KEY_BASE64` is missing, malformed, or
  scoped to the wrong runner environment. In cloud mode, check EAS. In local
  mode, check GitHub Actions.
- `failed to decrypt`: the provider key was not granted access to the selected
  dotenc environment, or the wrong environment name was passed to `-e`.
- `app.config.js` sees empty values: the dotenc export step ran after config
  resolution. In cloud mode, move it before `eas/prebuild`. In local mode,
  export allowlisted values before `eas build --local`.
- A value exists locally but not in EAS: confirm the selected build profile in
  `eas.json` uses the expected EAS environment (`development`, `preview`, or
  `production`). For workflow jobs that set `environment` directly, confirm
  they use the same value.
- A secret appears in logs: avoid `set -x`, avoid `env`, and never print
  decrypted values. Use allowlisted `set-env`, `export-action`, and
  `write-file-action` calls.
- Google Play rejects the upload with `APK has been signed in debug mode`: the
  Android custom build did not inject store signing credentials. Add
  `eas/inject_android_credentials` before `eas/configure_android_version` and
  `eas/run_gradle`, rebuild with a new version code, then submit the new AAB.
- The build is successful but Play Store submission uses the wrong artifact:
  in cloud mode, submit by the upstream EAS build ID. In local mode, submit by
  the local artifact path produced by `eas build --local --output`.
- `Google Service Account Keys cannot be set up in --non-interactive mode`:
  the submit runner does not have a usable Google Play service account file.
  Configure `serviceAccountKeyPath` in `eas.json`, then create that file in the
  same job that runs `eas submit`.
- RevenueCat or Play integrations report that the service account cannot create
  a Google Cloud Pub/Sub topic: grant the service account the required Pub/Sub
  permissions or create the RTDN topic manually. Credential status in external
  dashboards may remain in a "needs attention" state for several hours after
  permissions are fixed.

## References

- [Expo: Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/)
- [Expo: Create and manage EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/)
- [Expo: Using environment variables in EAS](https://docs.expo.dev/eas/environment-variables/usage/)
- [Expo: Custom build configuration schema](https://docs.expo.dev/custom-builds/schema/)
- [Expo: EAS Workflows introduction](https://docs.expo.dev/eas/workflows/introduction/)
- [Expo: EAS Workflows syntax](https://docs.expo.dev/eas/workflows/syntax/)
- [Expo: EAS Submit](https://docs.expo.dev/submit/introduction/)
- [Expo: Submit to the Google Play Store](https://docs.expo.dev/submit/android/)
- [Expo: Configure EAS Submit with eas.json](https://docs.expo.dev/submit/eas-json/)
