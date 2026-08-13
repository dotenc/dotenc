type DerElement = {
	tag: number
	contentStart: number
	contentEnd: number
	nextOffset: number
}

const ED25519_OID = Buffer.from([0x2b, 0x65, 0x70])

const readElement = (der: Buffer, offset: number): DerElement => {
	if (offset < 0 || offset + 2 > der.byteLength) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}

	const tag = der[offset]
	const firstLengthByte = der[offset + 1]
	let contentLength: number
	let contentStart: number

	if ((firstLengthByte & 0x80) === 0) {
		contentLength = firstLengthByte
		contentStart = offset + 2
	} else {
		const lengthBytes = firstLengthByte & 0x7f
		if (
			lengthBytes === 0 ||
			lengthBytes > 4 ||
			offset + 2 + lengthBytes > der.length
		) {
			throw new Error("Invalid Ed25519 DER encoding.")
		}
		if (der[offset + 2] === 0) {
			throw new Error("Invalid Ed25519 DER encoding.")
		}
		contentLength = 0
		for (let index = 0; index < lengthBytes; index++) {
			contentLength = contentLength * 256 + der[offset + 2 + index]
		}
		if (contentLength < 128) {
			throw new Error("Invalid Ed25519 DER encoding.")
		}
		contentStart = offset + 2 + lengthBytes
	}

	const contentEnd = contentStart + contentLength
	if (!Number.isSafeInteger(contentEnd) || contentEnd > der.byteLength) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}

	return { tag, contentStart, contentEnd, nextOffset: contentEnd }
}

const readChildren = (der: Buffer, parent: DerElement): DerElement[] => {
	const children: DerElement[] = []
	let offset = parent.contentStart
	while (offset < parent.contentEnd) {
		const child = readElement(der, offset)
		if (child.nextOffset > parent.contentEnd) {
			throw new Error("Invalid Ed25519 DER encoding.")
		}
		children.push(child)
		offset = child.nextOffset
	}
	if (offset !== parent.contentEnd) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	return children
}

const validateEd25519Algorithm = (der: Buffer, algorithm: DerElement) => {
	if (algorithm.tag !== 0x30) throw new Error("Invalid Ed25519 DER encoding.")
	const children = readChildren(der, algorithm)
	if (
		children.length !== 1 ||
		children[0].tag !== 0x06 ||
		!der
			.subarray(children[0].contentStart, children[0].contentEnd)
			.equals(ED25519_OID)
	) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
}

export const extractEd25519PublicKey = (spki: Buffer): Buffer => {
	const outer = readElement(spki, 0)
	if (outer.tag !== 0x30 || outer.nextOffset !== spki.byteLength) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	const children = readChildren(spki, outer)
	if (children.length !== 2) throw new Error("Invalid Ed25519 DER encoding.")
	validateEd25519Algorithm(spki, children[0])

	const publicKey = children[1]
	if (
		publicKey.tag !== 0x03 ||
		publicKey.contentEnd - publicKey.contentStart !== 33 ||
		spki[publicKey.contentStart] !== 0
	) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	return Buffer.from(
		spki.subarray(publicKey.contentStart + 1, publicKey.contentEnd),
	)
}

export const extractEd25519PrivateSeed = (pkcs8: Buffer): Buffer => {
	const outer = readElement(pkcs8, 0)
	if (outer.tag !== 0x30 || outer.nextOffset !== pkcs8.byteLength) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	const children = readChildren(pkcs8, outer)
	if (children.length < 3) throw new Error("Invalid Ed25519 DER encoding.")

	const [version, algorithm, privateKey, ...optional] = children
	if (
		version.tag !== 0x02 ||
		version.contentEnd - version.contentStart !== 1 ||
		(pkcs8[version.contentStart] !== 0 && pkcs8[version.contentStart] !== 1)
	) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	validateEd25519Algorithm(pkcs8, algorithm)
	if (privateKey.tag !== 0x04) throw new Error("Invalid Ed25519 DER encoding.")

	const nested = readElement(pkcs8, privateKey.contentStart)
	if (
		nested.tag !== 0x04 ||
		nested.nextOffset !== privateKey.contentEnd ||
		nested.contentEnd - nested.contentStart !== 32
	) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}

	let sawAttributes = false
	let sawPublicKey = false
	for (const element of optional) {
		if (element.tag === 0xa0 && !sawAttributes && !sawPublicKey) {
			sawAttributes = true
			continue
		}
		if (
			element.tag === 0x81 &&
			!sawPublicKey &&
			pkcs8[version.contentStart] === 1 &&
			element.contentEnd - element.contentStart === 33 &&
			pkcs8[element.contentStart] === 0
		) {
			sawPublicKey = true
			continue
		}
		throw new Error("Invalid Ed25519 DER encoding.")
	}
	if (pkcs8[version.contentStart] === 0 && sawPublicKey) {
		throw new Error("Invalid Ed25519 DER encoding.")
	}

	return Buffer.from(pkcs8.subarray(nested.contentStart, nested.contentEnd))
}
