import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TAbstractFile,
	Notice,
	WorkspaceLeaf,
} from "obsidian";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface SidecarMetadataSettings {
	/** Pattern for the sidecar filename. {{filename}} is the original basename. */
	namingPattern: string;
	/** Comma-separated list of folders to watch. Empty = entire vault. */
	watchedFolders: string;
	/** YAML frontmatter template inserted into new sidecars. */
	sidecarTemplate: string;
	/** Automatically delete sidecar when the source file is deleted. */
	autoDeleteSidecar: boolean;
	/** Automatically create sidecar when a non-md file is created. */
	autoCreateOnNew: boolean;
	/** Automatically open the sidecar when a non-md file is opened. */
	autoOpenSidecar: boolean;
}

const DEFAULT_SETTINGS: SidecarMetadataSettings = {
	namingPattern: "{{filename}}.md",
	watchedFolders: "",
	sidecarTemplate: [
		"---",
		"tags: []",
		"description: \"\"",
		"source: \"{{filepath}}\"",
		"created: \"{{date}}\"",
		"---",
		"",
		"# {{filename}}",
		"",
	].join("\n"),
	autoDeleteSidecar: true,
	autoCreateOnNew: true,
	autoOpenSidecar: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonMarkdown(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension !== "md";
}

function isSidecarFile(file: TAbstractFile): boolean {
	if (!(file instanceof TFile)) return false;
	// A sidecar is a .md file whose name (without .md) still has an extension,
	// e.g. "photo.png.md" → stem "photo.png" which contains a dot.
	if (file.extension !== "md") return false;
	const stem = file.name.slice(0, -(file.extension.length + 1)); // remove ".md"
	return stem.includes(".");
}

function renderTemplate(
	template: string,
	vars: Record<string, string>
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(
			new RegExp(`\\{\\{${key}\\}\\}`, "g"),
			value
		);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class SidecarMetadataPlugin extends Plugin {
	settings: SidecarMetadataSettings = DEFAULT_SETTINGS;

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async onload() {
		await this.loadSettings();

		// --- Vault events ---------------------------------------------------

		// Auto-create sidecar on file creation
		this.registerEvent(
			this.app.vault.on("create", async (file: TAbstractFile) => {
				if (!this.settings.autoCreateOnNew) return;
				if (!isNonMarkdown(file)) return;
				if (isSidecarFile(file)) return;
				if (!this.isInWatchedFolder(file)) return;
				await this.createSidecar(file);
			})
		);

		// Auto-delete sidecar on source deletion
		this.registerEvent(
			this.app.vault.on("delete", async (file: TAbstractFile) => {
				if (!this.settings.autoDeleteSidecar) return;
				if (!isNonMarkdown(file)) return;
				const sidecarPath = this.getSidecarPath(file as TFile);
				const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
				if (sidecar && sidecar instanceof TFile) {
					await this.app.vault.delete(sidecar);
					new Notice(`Sidecar deleted: ${sidecarPath}`);
				}
			})
		);

		// Handle rename / move of source → rename sidecar too
		this.registerEvent(
			this.app.vault.on(
				"rename",
				async (file: TAbstractFile, oldPath: string) => {
					// Only act on non-md files that are NOT sidecars themselves
					if (!(file instanceof TFile)) return;
					if (file.extension === "md") return;

					const oldSidecarPath = this.buildSidecarPathFromRaw(oldPath);
					const oldSidecar =
						this.app.vault.getAbstractFileByPath(oldSidecarPath);

					if (oldSidecar && oldSidecar instanceof TFile) {
						const newSidecarPath = this.getSidecarPath(file);
						// Update frontmatter source reference
						let content = await this.app.vault.read(oldSidecar);
						content = content.replace(
							new RegExp(
								`source:\\s*["']?${this.escapeRegex(oldPath)}["']?`
							),
							`source: "${file.path}"`
						);
						await this.app.vault.modify(oldSidecar, content);
						// Rename sidecar file
						await this.app.fileManager.renameFile(
							oldSidecar,
							newSidecarPath
						);
						new Notice(`Sidecar moved: ${newSidecarPath}`);
					}
				}
			)
		);

		// Auto-open sidecar in split pane when a non-md file is opened
		this.registerEvent(
			this.app.workspace.on("file-open", async (file: TFile | null) => {
				if (!this.settings.autoOpenSidecar) return;
				if (!file || file.extension === "md") return;
				await this.openSidecar(file);
			})
		);

		// --- Commands -------------------------------------------------------

		this.addCommand({
			id: "create-sidecar-current",
			name: "Create sidecar for current file",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension === "md") return false;
				if (checking) return true;
				this.createSidecar(file).then(() =>
					new Notice(`Sidecar created for ${file.name}`)
				);
				return true;
			},
		});

		this.addCommand({
			id: "bulk-create-sidecars",
			name: "Bulk-create sidecars for all non-md files without one",
			callback: async () => {
				let count = 0;
				const files = this.app.vault.getFiles();
				for (const file of files) {
					if (file.extension === "md") continue;
					if (isSidecarFile(file)) continue;
					if (!this.isInWatchedFolder(file)) continue;
					const sidecarPath = this.getSidecarPath(file);
					if (this.app.vault.getAbstractFileByPath(sidecarPath))
						continue;
					await this.createSidecar(file);
					count++;
				}
				new Notice(`Created ${count} sidecar file(s).`);
			},
		});

		// --- Settings tab ---------------------------------------------------

		this.addSettingTab(new SidecarMetadataSettingTab(this.app, this));
	}

	// -----------------------------------------------------------------------
	// Settings persistence
	// -----------------------------------------------------------------------

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// -----------------------------------------------------------------------
	// Core helpers
	// -----------------------------------------------------------------------

	/** Build the sidecar path for a given non-md TFile. */
	getSidecarPath(file: TFile): string {
		const dir = file.parent ? file.parent.path : "";
		const sidecarName = renderTemplate(this.settings.namingPattern, {
			filename: file.name,
		});
		return dir ? `${dir}/${sidecarName}` : sidecarName;
	}

	/** Build the sidecar path from a raw vault path string (used for old paths on rename). */
	buildSidecarPathFromRaw(filePath: string): string {
		const parts = filePath.split("/");
		const basename = parts.pop()!;
		const dir = parts.join("/");
		const sidecarName = renderTemplate(this.settings.namingPattern, {
			filename: basename,
		});
		return dir ? `${dir}/${sidecarName}` : sidecarName;
	}

	/** Check whether a file lives inside one of the watched folders (or anywhere if empty). */
	isInWatchedFolder(file: TAbstractFile): boolean {
		const folders = this.settings.watchedFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
		if (folders.length === 0) return true; // entire vault
		return folders.some(
			(folder) =>
				file.path.startsWith(folder + "/") || file.path === folder
		);
	}

	/** Create a sidecar .md for the given file (idempotent). */
	async createSidecar(file: TFile): Promise<TFile | null> {
		const sidecarPath = this.getSidecarPath(file);
		if (this.app.vault.getAbstractFileByPath(sidecarPath)) return null;

		const now = new Date();
		const dateStr = now.toISOString().split("T")[0];

		const content = renderTemplate(this.settings.sidecarTemplate, {
			filename: file.name,
			filepath: file.path,
			date: dateStr,
			extension: file.extension,
		});

		return await this.app.vault.create(sidecarPath, content);
	}

	/** Open the sidecar note for a file in a right split pane. */
	async openSidecar(file: TFile): Promise<void> {
		const sidecarPath = this.getSidecarPath(file);
		const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
		if (!sidecar || !(sidecar instanceof TFile)) return;

		// Check if sidecar is already open in some leaf
		const existingLeaf = this.findLeafWithFile(sidecar);
		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			return;
		}

		// Open in a new split to the right
		const leaf = this.app.workspace.getLeaf("split", "vertical");
		await leaf.openFile(sidecar);
	}

	/** Find an existing workspace leaf that has the given file open. */
	private findLeafWithFile(file: TFile): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (
				leaf.view &&
				"file" in leaf.view &&
				(leaf.view as any).file?.path === file.path
			) {
				found = leaf;
			}
		});
		return found;
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

class SidecarMetadataSettingTab extends PluginSettingTab {
	plugin: SidecarMetadataPlugin;

	constructor(app: App, plugin: SidecarMetadataPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Sidecar Metadata Settings" });

		new Setting(containerEl)
			.setName("Sidecar naming pattern")
			.setDesc(
				"Pattern for the sidecar filename. Use {{filename}} for the original file name (e.g. photo.png). Default: {{filename}}.md"
			)
			.addText((text) =>
				text
					.setPlaceholder("{{filename}}.md")
					.setValue(this.plugin.settings.namingPattern)
					.onChange(async (value) => {
						this.plugin.settings.namingPattern =
							value || DEFAULT_SETTINGS.namingPattern;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Watched folders")
			.setDesc(
				"Comma-separated list of folder paths to watch. Leave empty to watch the entire vault."
			)
			.addText((text) =>
				text
					.setPlaceholder("assets, images/photos")
					.setValue(this.plugin.settings.watchedFolders)
					.onChange(async (value) => {
						this.plugin.settings.watchedFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sidecar template")
			.setDesc(
				"Frontmatter / content template for new sidecars. Variables: {{filename}}, {{filepath}}, {{date}}, {{extension}}"
			)
			.addTextArea((text) => {
				text.inputEl.rows = 10;
				text.inputEl.cols = 50;
				text.setPlaceholder("---\ntags: []\n---")
					.setValue(this.plugin.settings.sidecarTemplate)
					.onChange(async (value) => {
						this.plugin.settings.sidecarTemplate = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Auto-create sidecar on file creation")
			.setDesc(
				"Automatically create a sidecar .md when a new non-markdown file is added to a watched folder."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCreateOnNew)
					.onChange(async (value) => {
						this.plugin.settings.autoCreateOnNew = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-open sidecar")
			.setDesc(
				"Automatically open the sidecar note in a split pane when a non-markdown file is opened."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpenSidecar)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenSidecar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-delete sidecar")
			.setDesc(
				"Automatically delete the sidecar .md file when its source file is deleted."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoDeleteSidecar)
					.onChange(async (value) => {
						this.plugin.settings.autoDeleteSidecar = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
