import { decrypt, ECIES_CONFIG, encrypt } from "eciesjs"

ECIES_CONFIG.ellipticCurve = "ed25519"

export const eciesEncrypt = (publicKey: Buffer, data: Buffer): Buffer =>
	Buffer.from(encrypt(publicKey, data))

export const eciesDecrypt = (privateKey: Buffer, data: Buffer): Buffer =>
	decrypt(privateKey, data)
