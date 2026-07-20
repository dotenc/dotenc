import { basename, dirname, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "..")
const defaultOutputPath = resolve(repositoryRoot, "actions/diff/dist/index.js")
const outputPath = process.argv[2]
	? resolve(process.cwd(), process.argv[2])
	: defaultOutputPath

type PackageManifest = {
	dependencies?: Record<string, string>
}

const cliManifest = (await Bun.file(
	resolve(repositoryRoot, "cli/package.json"),
).json()) as PackageManifest
const cliDependencies = new Set(Object.keys(cliManifest.dependencies ?? {}))

function packageNameForSpecifier(specifier: string): string {
	if (specifier.startsWith("@")) {
		return specifier.split("/", 2).join("/")
	}

	return specifier.split("/", 1)[0] ?? specifier
}

const rootWorkspaceDependencies: Bun.BunPlugin = {
	name: "root-workspace-dependencies",
	setup(build) {
		build.onResolve({ filter: /^[^./]/ }, ({ path }) => {
			if (
				path.startsWith("node:") ||
				!cliDependencies.has(packageNameForSpecifier(path))
			) {
				return
			}

			return { path: Bun.resolveSync(path, repositoryRoot) }
		})
	},
}

const result = await Bun.build({
	entrypoints: [resolve(repositoryRoot, "actions/diff/src/index.ts")],
	env: "disable",
	format: "cjs",
	naming: basename(outputPath),
	outdir: dirname(outputPath),
	packages: "bundle",
	plugins: [rootWorkspaceDependencies],
	root: repositoryRoot,
	sourcemap: "none",
	splitting: false,
	target: "node",
	throw: false,
})

if (!result.success) {
	for (const message of result.logs) {
		console.error(message)
	}
	process.exit(1)
}

const generatedOutput = result.outputs.find(
	(output) => output.kind === "entry-point",
)
if (!generatedOutput || resolve(generatedOutput.path) !== outputPath) {
	console.error("Diff action build did not produce the requested output path.")
	process.exit(1)
}

console.log(`Built ${outputPath}`)
