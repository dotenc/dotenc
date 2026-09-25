---
title: "When to use dotenc"
description: "Choose the right operational model for your secrets."
---

dotenc fits teams that want encrypted configuration reviewed and versioned with
application code. Local SSH identities authorize decryption; an external secrets
service is not required for normal use.

## Good fits

- Development profiles that follow your branches.
- Small teams sharing selected environments with explicit recipients.
- CI runners that receive one bootstrap identity and decrypt configuration locally.
- Repositories where environment changes should be reviewed alongside code.

## Choose another model when you need

- Centralized policy enforcement independent of repository writers.
- Dynamic, short-lived credentials issued by a remote secrets API.
- HSM-backed storage mandated by your environment.
- Revocation that prevents access to retained historical ciphertext.

A Git-native encryption tool and a centralized secret manager solve different
problems. The [security specification](/docs/security/model/) describes exactly
what dotenc does and does not guarantee.
