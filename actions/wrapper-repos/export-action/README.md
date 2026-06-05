# export-action

Export allowlisted dotenc variables to later GitHub Actions steps.

```yaml
- uses: dotenc/export-action@v1
  with:
    environment: github-actions
    names: EXPO_TOKEN
  env:
    DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}
```

Implementation is delegated to `ivanfilhoz/dotenc/actions/export@v1`.
