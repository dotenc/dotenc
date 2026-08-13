import type crypto from "node:crypto"
import type { PrivateKeyEntry } from "./getPrivateKeys"

export type KeyCandidateSource = "environment" | "filesystem" | "1password"

export type KeyCandidateGroup = {
	id: string
	label: string
}

export type KeyCandidate = {
	source: KeyCandidateSource
	selector: string
	name: string
	hint: string
	group: KeyCandidateGroup
	publicKey: crypto.KeyObject
	fingerprint: string
	algorithm: "rsa" | "ed25519"
	loadPrivateKey: () => Promise<PrivateKeyEntry>
	exportPrivateKey?: () => Promise<Buffer>
}
