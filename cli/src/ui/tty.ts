type TtyStream = Pick<NodeJS.WriteStream, "isTTY">

export const isInteractive = (
	stdin: TtyStream = process.stdin,
	stdout: TtyStream = process.stdout,
) => Boolean(stdin.isTTY && stdout.isTTY)
