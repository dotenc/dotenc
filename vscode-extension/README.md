# dotenc VS Code Extension

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/dotenc.dotenc-vscode-extension)
![Open VSX Version](https://img.shields.io/open-vsx/v/dotenc/dotenc-vscode-extension)

Open encrypted dotenc environment files as regular dotenv documents in VS Code.

## What you get

- Open `.env.<environment>.enc` directly and edit decrypted content in the native editor.
- Save normally; the extension re-encrypts content on write.
- Native editor features for dotenv files, including syntax highlighting.
- Inline visibility of who has access to the current environment while editing.
- `Open Encrypted Source` status bar action for troubleshooting.

## Prerequisites

- `dotenc` CLI `0.5.2` or newer.
- A dotenc project initialized in your workspace.

Install the CLI with the official script:

```sh
curl -fsSL https://dotenc.org/install.sh | sh
```

## Usage

- Open any `.env.<environment>.enc` file in VS Code.
- Or run `dotenc: Open Decrypted Environment` from the Command Palette.
- Use `dotenc: Open Encrypted Source` when you want to inspect the raw encrypted file.

## Settings

- `dotenc.autoViewDecrypted`: automatically open `.env.<environment>.enc` files in the decrypted editor (default: `true`).
- `dotenc.executablePath`: path to the `dotenc` executable (default: `dotenc`). Configure this in your user/remote settings (not workspace settings).

## Update checks

On startup, the extension checks whether a newer `dotenc` CLI version is available.

To disable CLI update checks:

```sh
export DOTENC_SKIP_UPDATE_CHECK=1
```

## Reference

- Repository: https://github.com/dotenc/dotenc
- CLI and workflow docs: https://github.com/dotenc/dotenc#readme
