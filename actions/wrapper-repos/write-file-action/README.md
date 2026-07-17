# write-file-action

Write one decrypted dotenc variable to a file with restricted permissions.

```yaml
- uses: dotenc/write-file-action@v1
  with:
    environment: github-actions
    name: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
    path: google-play-service-account.json
  env:
    DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
```

Implementation is delegated to `dotenc/dotenc/actions/write-file@v1`.
