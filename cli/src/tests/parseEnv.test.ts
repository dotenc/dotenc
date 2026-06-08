import { describe, expect, test } from "bun:test"
import { parseEnv } from "../helpers/parseEnv"

describe("parseEnv", () => {
	test("should parse a simple key-value pair", () => {
		const env = parseEnv("FOO=bar")
		expect(env.FOO).toBe("bar")
	})

	test("should parse a key-value pair with a space", () => {
		const env = parseEnv("FOO = bar")
		expect(env.FOO).toBe("bar")
	})

	test("should parse a complex env file", () => {
		const env = parseEnv(`FOO="
bar"
  BAR="baz
foo
"
BAZ=123

# Comment here "!#' foo

HELLO = WORLD
DOTENC_HELLO = "Hello, world!"
WITH_QUOTES = 'Test with "quotes"'
`)

		expect(env.FOO).toBe("\nbar")
		expect(env.BAR).toBe("baz\nfoo\n")
		expect(env.BAZ).toBe("123")
		expect(env.HELLO).toBe("WORLD")
		expect(env.DOTENC_HELLO).toBe("Hello, world!")
		expect(env.WITH_QUOTES).toBe('Test with "quotes"')
	})
})
