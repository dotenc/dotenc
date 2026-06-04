# Expo / EAS runbook

This runbook describes the recommended way to use dotenc with Expo apps built
on EAS Build or EAS Workflows.

## When to use this

Use this pattern when an Expo app keeps build-time configuration in encrypted
`.env.*.enc` files and needs those values during EAS cloud builds, for example:

- `APP_VARIANT`
- `EXPO_PUBLIC_*` values that are intentionally bundled into the app
- native config values read by `app.config.js`
- store, ads, purchases, analytics, or feature flag IDs

Do not put secrets that must stay hidden from users in `EXPO_PUBLIC_*`
variables. Expo inlines `EXPO_PUBLIC_*` values into the client bundle.

## Mental model

EAS cloud workers need their own dotenc identity.

1. Generate a dedicated CI SSH key.
2. Add the public key to `.dotenc/`.
3. Grant that key access to the encrypted environment used by the build.
4. Store the private key on EAS as `DOTENC_PRIVATE_KEY`.
5. Install dotenc in the EAS job.
6. Run the build steps with variables loaded by `dotenc run`.

`DOTENC_PRIVATE_KEY` is consumed automatically by dotenc. You do not need a
`~/.ssh` directory on the EAS worker.

## 1. Create a dedicated EAS key

Create a passwordless key specifically for EAS:

```bash
ssh-keygen -t ed25519 -f eas_key -N "" -C "eas"
```

Add the public key to the project and grant only the environments required for
builds:

```bash
dotenc key add eas --from-ssh ./eas_key
dotenc auth grant production eas
git add .dotenc .env.production.enc
git commit -m "Grant EAS access to production environment"
```

## 2. Store the private key on EAS

Create an EAS environment variable named `DOTENC_PRIVATE_KEY` in the matching
EAS environment, usually `production`.

Recommended settings:

- Name: `DOTENC_PRIVATE_KEY`
- Visibility: `secret`
- Scope: project-wide unless several projects intentionally share the same key
- Environment: the EAS environment used by the build profile

The value must be the full private key text, including the `BEGIN` and `END`
lines and line breaks:

```bash
cat eas_key
```

After the key is stored on EAS, delete the local copy:

```bash
rm eas_key eas_key.pub
```

If the EAS dashboard or another provider path turns an uploaded file into a file
path instead of the key contents, convert it before invoking dotenc:

```bash
if [ -n "${DOTENC_PRIVATE_KEY:-}" ] && [ -f "$DOTENC_PRIVATE_KEY" ]; then
  export DOTENC_PRIVATE_KEY="$(cat "$DOTENC_PRIVATE_KEY")"
fi
```

If a provider cannot preserve multiline values, prefer fixing the provider
secret format. As a fallback, store a base64-encoded key in another variable and
decode it into `DOTENC_PRIVATE_KEY` before running dotenc:

```bash
export DOTENC_PRIVATE_KEY="$(printf '%s' "$DOTENC_PRIVATE_KEY_B64" | base64 -d)"
```

## 3. Pin the EAS environment in `eas.json`

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
the EAS environment that contains `DOTENC_PRIVATE_KEY`.

## 4. Use a custom EAS Build

Default EAS Build steps resolve Expo config and run native build phases without
being wrapped by dotenc. Use a Custom EAS Build when `app.config.js`, native
prebuild, or store builds need decrypted values.

Create `.eas/build/production-ios.yml`:

```yaml
build:
  name: iOS production build with dotenc
  steps:
    - eas/checkout

    - run:
        name: Install dotenc
        command: npm install -g @dotenc/cli

    - run:
        name: Export dotenc environment
        command: |
          if [ -n "${DOTENC_PRIVATE_KEY:-}" ] && [ -f "$DOTENC_PRIVATE_KEY" ]; then
            export DOTENC_PRIVATE_KEY="$(cat "$DOTENC_PRIVATE_KEY")"
          fi

          dotenc run --strict -e production node - <<'NODE'
          const { spawnSync } = require('node:child_process');

          const keys = [
            'APP_VARIANT',
            'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
            'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
            'EXPO_PUBLIC_ADMOB_IOS_APP_ID',
            'EXPO_PUBLIC_ADMOB_ANDROID_APP_ID',
            'EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID',
            'EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID',
            'EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID',
            'EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID'
          ];

          for (const key of keys) {
            const value = process.env[key];
            if (value !== undefined) {
              const result = spawnSync('set-env', [key, value], { stdio: 'inherit' });
              if (result.status !== 0) process.exit(result.status ?? 1);
            }
          }
          NODE

    - eas/install_node_modules
    - eas/resolve_apple_team_id_from_credentials:
        id: resolve_apple_team_id_from_credentials
    - eas/prebuild:
        inputs:
          apple_team_id: ${ steps.resolve_apple_team_id_from_credentials.apple_team_id }
    - run:
        name: Install pods
        working_directory: ./ios
        command: pod install
    - eas/configure_ios_credentials
    - eas/generate_gymfile_from_template:
        inputs:
          credentials: ${ eas.job.secrets.buildCredentials }
    - eas/run_fastlane
    - eas/find_and_upload_build_artifacts
```

Then reference the custom build in `eas.json`:

```json
{
  "build": {
    "production": {
      "environment": "production",
      "config": "production-ios.yml"
    }
  }
}
```

For Android Play Store builds, use explicit custom build steps instead of a
generic shortcut. The important ordering is:

1. Install dependencies.
2. Export the dotenc environment before Expo config resolution or prebuild.
3. Resolve build config.
4. Run prebuild.
5. Inject Android credentials.
6. Configure the Android version.
7. Run Gradle and upload the AAB.

Create `.eas/build/production-android.yml`:

```yaml
build:
  name: Android production build with dotenc
  steps:
    - eas/checkout
    - eas/install_node_modules

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

Then reference the custom build in `eas.json`:

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
In the EAS logs, verify both `Signing config injected` and the Gradle
`:app:validateSigningRelease` task before submitting.

Do not add `eas/configure_eas_update` unless the app actually installs and
configures `expo-updates`. For projects that do not use `expo-updates`, that
step can fail during local or cloud inspection.

### Why the allowlist?

`dotenc run` injects decrypted variables into a single command. Custom EAS Build
steps are separate shells, so values needed by later EAS steps must be exported
with `set-env`. Use an explicit allowlist to avoid accidentally sharing unrelated
CI variables or dotenc internals with later build steps.

Example allowlisted export script:

```js
// scripts/eas/export-dotenc-env.cjs
const { spawnSync } = require('node:child_process');

const platform = process.env.EAS_BUILD_PLATFORM;
const commonNames = [];
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

## 5. Build locally and in the cloud

Cloud build:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

Local sanity check with the same encrypted environment:

```bash
dotenc run --strict -e production npx expo config --type public
dotenc run --strict -e production npx expo prebuild --clean --platform ios
dotenc run --strict -e production npx expo prebuild --clean --platform android
```

## EAS Workflows

EAS Workflows can run build jobs and custom jobs on EAS infrastructure. If a
workflow triggers a pre-packaged EAS Build job, keep the profile aligned with
the environment configured in `eas.json`:

```yaml
jobs:
  build_ios:
    type: build
    params:
      platform: ios
      profile: production

  build_android:
    type: build
    params:
      platform: android
      profile: production
```

The pre-packaged build job reads the EAS environment from the selected build
profile. For jobs that do accept `environment` directly, such as fingerprint,
update, or custom shell jobs, set it explicitly to the same value.

If a workflow uses custom shell steps instead of a pre-packaged build job, use
the same `npm install -g @dotenc/cli` plus `dotenc run --strict -e ...` pattern
from the custom build example.

For GitHub-connected EAS Workflows that should run on every push to `main`,
keep the workflow in `.eas/workflows/*.yml`:

```yaml
name: Android Production Build

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
```

If GitHub Actions is used only to call EAS, that GitHub job needs `EXPO_TOKEN`.
Do not put `DOTENC_PRIVATE_KEY` only in GitHub and expect EAS Workflows or EAS
Build workers to see it. The dotenc private key belongs in the EAS
`production` environment because the actual build runs on EAS workers.

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

Keep `google-play-service-account.json` out of git. Add it to `.gitignore` and
store it only in the local machine or in the CI secret store.

For local submission after a successful cloud build:

```bash
eas submit --platform android --profile production --latest --non-interactive
```

For GitHub Actions submission, store the service account JSON as a base64 secret
such as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, recreate the file in the job,
then run `eas submit`:

```yaml
- name: Write Google Play service account
  run: |
    printf '%s' "$GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64" | base64 -d > google-play-service-account.json
    chmod 600 google-play-service-account.json
  env:
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 }}

- name: Submit Android build
  run: npx eas-cli@latest submit --platform android --profile production --latest --non-interactive
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

If the same workflow starts the build and submits later, make sure the submitted
artifact is the newly finished build. Avoid re-submitting an older failed AAB by
checking the build ID, app version, and Android version code in the EAS output.

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
  RevenueCat public API keys, come from dotenc through the allowlisted export
  step before config resolution.

## GitHub-triggered EAS builds

When GitHub Actions triggers `eas build`, GitHub secrets are not automatically
available on EAS builders. `DOTENC_PRIVATE_KEY` must exist on EAS servers as an
EAS environment variable for cloud builds.

A GitHub workflow can still trigger the build:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g eas-cli
      - run: eas build --platform android --profile production --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

But the dotenc private key belongs in the EAS project/account environment, not
only in GitHub. Google Play service account JSON is different: it is needed by
the job that runs `eas submit`, so store it in GitHub only when GitHub Actions
is responsible for submitting to Google Play.

## Troubleshooting

- `No private keys found`: `DOTENC_PRIVATE_KEY` is missing, malformed, or
  exposed as a file path. Confirm it is available on EAS and contains the full
  key text before dotenc runs.
- `failed to decrypt`: the EAS key was not granted access to the selected
  dotenc environment, or the wrong environment name was passed to `-e`.
- `app.config.js` sees empty values: the dotenc export step ran after config
  resolution. Move it before `eas/prebuild` or any step that reads Expo config.
- A value exists locally but not in EAS: confirm the selected build profile in
  `eas.json` uses the expected EAS environment (`development`, `preview`, or
  `production`). For workflow jobs that set `environment` directly, confirm
  they use the same value.
- A secret appears in logs: avoid `set -x`, avoid `env`, and never print
  decrypted values. Use allowlisted `set-env` calls.
- Google Play rejects the upload with `APK has been signed in debug mode`: the
  Android custom build did not inject store signing credentials. Add
  `eas/inject_android_credentials` before `eas/configure_android_version` and
  `eas/run_gradle`, rebuild with a new version code, then submit the new AAB.
- The EAS build is successful but Play Store submission uses the wrong artifact:
  submit by checking the latest build ID, app version, and version code. Do not
  reuse an AAB from a failed submission.
- `serviceAccountKeyPath` works locally but fails in GitHub Actions: recreate
  the JSON file from a base64 GitHub secret before running `eas submit`, and
  ensure the path matches `eas.json`.
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
