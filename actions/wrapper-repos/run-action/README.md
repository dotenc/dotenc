# run-action

Run one command with variables decrypted from a dotenc environment.

```yaml
- uses: dotenc/run-action@v1
  with:
    environment: test
    command: npm test
  env:
    DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}
```

Implementation is delegated to `ivanfilhoz/dotenc/actions/run@v1`.
