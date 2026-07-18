import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const filePath = process.argv[2]
if (!filePath || path.basename(filePath) !== ".env.development") {
	throw new Error("The README nano helper only edits .env.development.")
}

// Keep the temporary plaintext path out of the captured editor title. The
// basename still points at the same file because nano runs from its directory.
const resolvedFilePath = await fs.realpath(filePath)
const resolvedTemporaryDirectory = await fs.realpath(os.tmpdir())
if (!resolvedFilePath.startsWith(`${resolvedTemporaryDirectory}${path.sep}`)) {
	throw new Error("The README nano helper only edits dotenc temporary files.")
}
const workingDirectory = path.dirname(resolvedFilePath)

const expectProgram = String.raw`
set timeout 20
fconfigure stdout -buffering none

spawn -noecho nano -w -x +999 .env.development
expect {
  -re {File: .env.development} {}
  timeout { puts stderr "nano did not open the environment file"; exit 1 }
  eof { puts stderr "nano exited before the file was ready"; exit 1 }
}
after 700

# Nano and macOS Pico share these shortcuts. The +999 argument starts at the
# end of the file; add a fresh line and type at a human cadence.
send -- "\005"
send -- "\r"
after 450
set greeting "GREETING=Hello from dotenc!"
set typing_delays {55 75 95}
set index 0
foreach character [split $greeting ""] {
  send -- $character
  expect {
    -re {.+} {}
    timeout { puts stderr "nano did not echo an edited character"; exit 1 }
    eof { puts stderr "nano exited while editing"; exit 1 }
  }

  if {$character eq " "} {
    set delay 140
  } elseif {[regexp {[=.!]} $character]} {
    set delay 110
  } else {
    set delay [lindex $typing_delays [expr {$index % 3}]]
  }
  after $delay
  incr index
}
after 1100

# Write the file, accept its existing name, then leave the editor.
send -- "\017"
expect {
  -re {File Name to write} {}
  timeout { puts stderr "nano did not show its write prompt"; exit 1 }
  eof { puts stderr "nano exited before saving"; exit 1 }
}
after 500
send -- "\r"
expect {
  -re {Wrote [0-9]+ lines?} {}
  timeout { puts stderr "nano did not confirm the write"; exit 1 }
  eof { puts stderr "nano exited without confirming the write"; exit 1 }
}
after 700
send -- "\030"
expect eof
set result [wait]
exit [lindex $result 3]
`

const child = spawn("expect", ["-c", expectProgram], {
	cwd: workingDirectory,
	env: { ...process.env, TERM: "xterm" },
	stdio: "inherit",
})

const exitCode = await new Promise<number>((resolve, reject) => {
	child.once("error", reject)
	child.once("exit", (code) => resolve(code ?? 1))
})

if (exitCode !== 0) {
	throw new Error(`Automated nano session exited with code ${exitCode}.`)
}
