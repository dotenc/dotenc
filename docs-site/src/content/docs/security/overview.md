---
title: "Security model"
description: "Security model with dotenc, the Git-native encrypted environment CLI."
---

## Security Model

- Each environment has its own randomly generated 256-bit data key.
- Data keys are encrypted per-user using their SSH public key.
- dotenc uses AES-256-GCM for authenticated encryption.
- Your repository alone is not enough to decrypt secrets.
- Access can be revoked at any time.

AES-GCM detects changes to a ciphertext under its data key; it does not prove
who authored a complete replacement envelope. Repository writers are trusted,
with Git permissions, review, and history providing the authorship layer.

For a detailed breakdown of the cryptographic design, key material handling, threat model, and vulnerability reporting, see [SECURITY.md](/docs/security/model/).
