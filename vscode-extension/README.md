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

- `dotenc` CLI `0.9.0` or newer.
- A dotenc project initialized in your workspace.
- A trusted VS Code workspace. The extension does not decrypt, encrypt, manage
  environments, install, or execute the CLI in an untrusted workspace.

Install the CLI with the official script:

```sh
curl -fsSL https://dotenc.org/install.sh | sh
```

## Usage

- Open any `.env.<environment>.enc` file in VS Code.
- Or run `dotenc: Open Decrypted Environment` from the Command Palette.
- Use `dotenc: Open Encrypted Source` when you want to inspect the raw encrypted file.

## Settings

- `dotenc.autoViewDecrypted`: automatically open `.env.<environment>.enc` files
  in the decrypted editor (default: `true`). This is machine-scoped; workspace
  and folder overrides are ignored.
- `dotenc.executablePath`: path to the `dotenc` executable (default: `dotenc`).
  This is machine-scoped; configure it in user/remote settings. Workspace and
  folder overrides are ignored.

Automatic decrypted views are a developer-experience choice. Opening one
materializes plaintext in VS Code editor memory, and unsaved dirty content can
be persisted by VS Code's hot-exit/backup machinery depending on your editor
settings and shutdown behavior. Treat the editor profile and its backup storage
as trusted. Use `dotenc: Open Encrypted Source` when you do not need plaintext,
and save or discard sensitive edits deliberately. The custom dotenc document
scheme does not itself imply that VS Code Local History stores the document.

## Update checks

The extension does not run the CLI merely because a trusted workspace starts.
It checks for a newer CLI version lazily after the first actual dotenc CLI
operation, and version/install/update helpers run outside the workspace
directory.

To disable CLI update checks:

```sh
export DOTENC_SKIP_UPDATE_CHECK=1
```

## Reference

- Repository: https://github.com/dotenc/dotenc
- CLI and workflow docs: https://github.com/dotenc/dotenc#readme
