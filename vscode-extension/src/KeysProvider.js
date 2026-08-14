const { createPublicKey } = require("node:crypto")
const path = require("node:path")
const vscode = require("vscode")

async function getPublicKeyAlgorithm(uri) {
	try {
		const content = await vscode.workspace.fs.readFile(uri)
		const key = createPublicKey(Buffer.from(content))
		if (key.asymmetricKeyType === "rsa") {
			return "rsa"
		}
		if (key.asymmetricKeyType === "ed25519") {
			return "ed25519"
		}
	} catch {
		// Keep invalid keys visible; the CLI will provide details when they are used.
	}

	return undefined
}

class KeysProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter()
		this.onDidChangeTreeData = this._onDidChangeTreeData.event

		this._watcher = vscode.workspace.createFileSystemWatcher("**/.dotenc/*.pub")
		this._watcher.onDidCreate(() => this.refresh())
		this._watcher.onDidDelete(() => this.refresh())
		this._watcher.onDidChange(() => this.refresh())
	}

	dispose() {
		this._watcher.dispose()
		this._onDidChangeTreeData.dispose()
	}

	refresh() {
		this._onDidChangeTreeData.fire()
	}

	getTreeItem(element) {
		return element
	}

	async getChildren() {
		if (!vscode.workspace.isTrusted) {
			return []
		}

		const uris = await vscode.workspace.findFiles("**/.dotenc/*.pub")
		return Promise.all(
			[...uris]
				.sort((a, b) => a.fsPath.localeCompare(b.fsPath))
				.map(async (uri) => {
					const name = path.basename(uri.fsPath, ".pub")
					const item = new vscode.TreeItem(
						name,
						vscode.TreeItemCollapsibleState.None,
					)
					item.iconPath = new vscode.ThemeIcon("key")
					item.description = await getPublicKeyAlgorithm(uri)
					return item
				}),
		)
	}
}

module.exports = { KeysProvider }
