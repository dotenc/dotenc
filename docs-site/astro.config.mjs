import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

export default defineConfig({
	site: "https://dotenc.org",
	base: "/docs",
	trailingSlash: "always",
	integrations: [
		starlight({
			title: "dotenc",
			description: "Encrypted environments. Versioned with your code.",
			favicon: "/favicon.svg",
			logo: { src: "../website/public/brand-symbol.svg" },
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/dotenc/dotenc",
				},
			],
			editLink: {
				baseUrl: "https://github.com/dotenc/dotenc/edit/main/docs-site/",
			},
			customCss: ["./src/styles/custom.css"],
			sidebar: [
				{
					label: "Start here",
					items: [
						"index",
						"getting-started/installation",
						"getting-started/quickstart",
						"getting-started/setup",
						"concepts/how-it-works",
						"concepts/when-to-use",
					],
				},
				{
					label: "Everyday use",
					items: [
						"guides/environments",
						"guides/development",
						"guides/run",
						"guides/rename",
						"guides/git-diffs",
						"guides/monorepos",
						"guides/maintenance",
					],
				},
				{
					label: "Teams and keys",
					items: [
						"guides/teams",
						"guides/offboarding",
						"guides/keys",
						"guides/passphrases",
						"guides/1password",
					],
				},
				{
					label: "CI/CD",
					collapsed: true,
					items: [
						"ci/overview",
						"ci/providers",
						"ci/github-actions",
						"ci/pull-request-diffs",
						"ci/expo-eas",
						"ci/vercel",
						"ci/netlify",
						"ci/cloudflare",
						"ci/coolify",
						"ci/railpack",
						"ci/nixpacks",
						"ci/containers",
					],
				},
				{
					label: "Integrations",
					items: ["integrations/vscode", "integrations/agents"],
				},
				{
					label: "Reference",
					items: [
						"reference/commands",
						"reference/configuration",
						"reference/doctor",
						"reference/artifacts",
						"reference/linux-packages",
					],
				},
				{ label: "Security", items: ["security/overview", "security/model"] },
				{ label: "dotenc.org", link: "https://dotenc.org/" },
			],
		}),
	],
})
