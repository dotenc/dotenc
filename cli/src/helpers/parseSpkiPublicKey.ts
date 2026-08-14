import crypto from "node:crypto"

export const parseSpkiPublicKey = (input: string): crypto.KeyObject => {
	const lines = input.trim().split(/\r?\n/)
	if (
		lines.length < 3 ||
		lines[0] !== "-----BEGIN PUBLIC KEY-----" ||
		lines.at(-1) !== "-----END PUBLIC KEY-----"
	) {
		throw new Error("Expected a public-only SPKI PEM key.")
	}

	const encoded = lines.slice(1, -1).join("")
	if (
		encoded.length === 0 ||
		encoded.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
	) {
		throw new Error("Expected a public-only SPKI PEM key.")
	}

	const der = Buffer.from(encoded, "base64")
	if (der.toString("base64") !== encoded) {
		throw new Error("Expected a public-only SPKI PEM key.")
	}

	let publicKey: crypto.KeyObject
	try {
		publicKey = crypto.createPublicKey({
			key: der,
			format: "der",
			type: "spki",
		})
	} catch {
		throw new Error("Expected a public-only SPKI PEM key.")
	}
	const canonicalDer = publicKey.export({ type: "spki", format: "der" })
	if (!Buffer.from(canonicalDer).equals(der)) {
		throw new Error("Expected a public-only SPKI PEM key.")
	}
	return publicKey
}
