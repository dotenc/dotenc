import { beforeEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

let stdout: EventEmitter
let stderr: EventEmitter
let child: EventEmitter & {
	stdout: EventEmitter
	stderr: EventEmitter
	exitCode: number | null
	signalCode: NodeJS.Signals | null
	kill: ReturnType<typeof mock>
}

const spawn = mock(() => child as never)

mock.module("node:child_process", () => ({ spawn }))

const { runOpCommand } = await import("../helpers/onePasswordKeyProvider")

beforeEach(() => {
	stdout = new EventEmitter()
	stderr = new EventEmitter()
	child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		exitCode: null,
		signalCode: null,
		kill: mock(() => true),
	})
	spawn.mockClear()
})

describe("runOpCommand cleanup", () => {
	test("zeros stdout received before and after a timeout settles", async () => {
		const beforeTimeout = Buffer.from("private-key-before-timeout")
		const pending = runOpCommand(["read"], { timeoutMs: 1 })
		stdout.emit("data", beforeTimeout)

		await expect(pending).rejects.toMatchObject({ code: "timeout" })
		expect(beforeTimeout.every((byte) => byte === 0)).toBe(true)
		expect(child.kill).toHaveBeenCalledWith("SIGKILL")

		const afterTimeout = Buffer.from("private-key-after-timeout")
		stdout.emit("data", afterTimeout)
		expect(afterTimeout.every((byte) => byte === 0)).toBe(true)
	})
})
