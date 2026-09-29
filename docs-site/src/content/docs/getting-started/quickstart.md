---
title: "Quick start"
description: "Encrypt your first environment and run a Node.js app."
---

This walkthrough uses Node.js and harmless example values. Install the
[dotenc CLI](/docs/getting-started/installation/) and make sure you have an
Ed25519 or RSA SSH key. If you do not, create one with `ssh-keygen` first.

## 1. Start a project

```bash
mkdir dotenc-demo
cd dotenc-demo
git init
dotenc init --name alice
```

Choose your SSH identity when prompted. This creates `.dotenc/alice.pub`,
`.env.development.enc`, and `.env.personal.alice.enc`. If a plaintext `.env`
already exists, initialization migrates its content into development and
removes that plaintext file. For an existing project, see [clone setup](/docs/getting-started/setup/).

## 2. Add shared configuration

```bash
dotenc env edit development
```

In the editor, enter this example value, save, and close:

```dotenv
GREETING=Hello from dotenc!
```

The CLI encrypts your changes on save. For a different editor, use
`dotenc config editor "code --wait"` on supported platforms or set `EDITOR`.

## 3. Run your app

Create `app.js`:

```js
console.log(process.env.GREETING || "No greeting")
```

```bash
dotenc dev node app.js
```

The app prints `Hello from dotenc!`. Only print harmless demo values like this;
real credentials should never appear in application logs.

## 4. Make it personal

```bash
dotenc env edit personal.alice
```

Set `GREETING=Hello, Alice!`, save, and run the app again. Your personal value
overrides the shared development value. `dev` automatically selects the one
accessible personal profile; pass `--profile alice` when several are accessible.

## 5. Commit encrypted configuration

```bash
git add .dotenc/alice.pub .env.development.enc .env.personal.alice.enc app.js
git commit -m "Add encrypted development configuration"
```

Commit the encrypted files; never commit your private key or a plaintext `.env`.
Follow [team setup](/docs/guides/teams/) to grant another person access, or
[CI/CD setup](/docs/ci/overview/) to give a runner its own identity.
