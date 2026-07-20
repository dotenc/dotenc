import { runAction } from "./runtime"

runAction()
	.then((result) => {
		if (result.shouldFail) process.exitCode = 1
	})
	.catch(() => {
		console.error(
			"::error::The redacted dotenc diff could not be completed safely. No secret content was emitted.",
		)
		process.exitCode = 1
	})
