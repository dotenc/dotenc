const path = require("node:path")
const vscode = require("vscode")
const { VIEW_DECRYPTED_COMMAND } = require("./helpers/constants")
const {
	getWorkspaceUriForStartup,
} = require("./helpers/getWorkspaceUriForStartup")

class EnvFileItem extends vscode.TreeItem {
	constructor(name, fileUri, dir) {
		super(name, vscode.TreeItemCollapsibleState.None)
		this.contextValue = "environment"
		this.iconPath = new vscode.ThemeIcon("file")
		this.fileUri = fileUri
		this.envDir = dir
		this.environmentName = name
		this.command = {
			command: VIEW_DECRYPTED_COMMAND,
			title: "View",
			arguments: [fileUri],
		}
	}
}

class EnvDirItem extends vscode.TreeItem {
	constructor(label, _dirPath, children) {
		super(label, vscode.TreeItemCollapsibleState.Expanded)
		this.contextValue = "environmentFolder"
		this.iconPath = new vscode.ThemeIcon("folder")
		this._children = children
	}
}

class EnvironmentsProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter()
		this.onDidChangeTreeData = this._onDidChangeTreeData.event

		this._watcher = vscode.workspace.createFileSystemWatcher("**/.env.*.enc")
		this._watcher.onDidCreate(() => this.refresh())
		this._watcher.onDidDelete(() => this.refresh())

		this._configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("dotenc.executablePath")) {
				this.refresh()
			}
		})
	}

	dispose() {
		this._watcher.dispose()
		this._configWatcher.dispose()
		this._onDidChangeTreeData.dispose()
	}

	refresh() {
		this._onDidChangeTreeData.fire()
	}

	getTreeItem(element) {
		return element
	}

	async getChildren(element) {
		if (!vscode.workspace.isTrusted) {
			return []
		}

		if (element instanceof EnvDirItem) {
			return element._children
		}

		if (element != null) {
			return []
		}

		const workspaceUri = getWorkspaceUriForStartup()
		if (!workspaceUri) {
			return []
		}

		// Discover all encrypted env files in the workspace — no CLI call needed.
		const uris = await vscode.workspace.findFiles("**/.env.*.enc")
		if (!uris.length) {
			return []
		}

		// Group by directory, sorted for stable display order.
		const dirMap = new Map()
		const sortedUris = [...uris].sort((a, b) =>
			a.fsPath.localeCompare(b.fsPath),
		)
		for (const uri of sortedUris) {
			const dir = path.dirname(uri.fsPath)
			const name = path.basename(uri.fsPath).slice(5, -4) // ".env.NAME.enc"
			if (!dirMap.has(dir)) {
				dirMap.set(dir, [])
			}
			dirMap.get(dir).push({ name, fileUri: uri, dir })
		}

		const dirs = Array.from(dirMap.keys()).sort()

		if (dirs.length <= 1) {
			// Single-level: flat list, no folder nodes (preserves flat-project UX).
			const entries = dirs.length === 1 ? dirMap.get(dirs[0]) : []
			return entries.map(
				({ name, fileUri, dir }) => new EnvFileItem(name, fileUri, dir),
			)
		}

		// Multi-level: folder nodes labelled relative to the workspace root.
		return dirs.map((dir) => {
			const label = path.relative(workspaceUri.fsPath, dir) || "."
			const children = dirMap
				.get(dir)
				.map(
					({ name, fileUri, dir: entryDir }) =>
						new EnvFileItem(name, fileUri, entryDir),
				)
			return new EnvDirItem(label, dir, children)
		})
	}
}

module.exports = { EnvironmentsProvider, EnvFileItem, EnvDirItem }
