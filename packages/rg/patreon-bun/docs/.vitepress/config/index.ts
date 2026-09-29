import { DefaultTheme, defineConfig } from "vitepress";

import * as shared from "./shared";

import { author, bugs, description, license, name, version } from "../../../package.json";

import typedocSidebar from "../../api/typedoc-sidebar.json";

interface GitHubStatsComponentProps {
	repo: string;
	keyName: string;
	iconClass: string;
	label: string;
}

const repoUrl = "https://github.com/rose-griffon/rg",
	branch = "main";

const createSidebarItems = () =>
	[
		shared.createGuideItem(true),
		shared.createLinksItem({
			branch,
			bugsUrl: bugs.url,
			repoUrl,
			version,
		}),
	] as DefaultTheme.SidebarItem[];

export default defineConfig({
	title: name,
	description,

	cleanUrls: true,
	lastUpdated: true,

	vite: {
		ssr: {
			noExternal: [/\.css$/, /^vuetify/],
		},
		build: {
			chunkSizeWarningLimit: 800,
		},
	},

	themeConfig: {
		nav: [
			shared.createGuideItem(false),
			{ text: "Reference", link: "/api/", activeMatch: "/api/" },
			{ text: "API Reference", link: "https://patreon.apidocumentation.com/v2-stable/reference" },
			shared.createLinksItem({
				branch,
				bugsUrl: bugs.url,
				repoUrl,
				version,
			}),
			{
				component: "GitHubStat",
				props: {
					label: "GitHub stars",
					iconClass: "vpi-social-github",
					repo: "rose-griffon/rg",
					keyName: "stargazers_count",
				} satisfies GitHubStatsComponentProps,
			},
		] as DefaultTheme.NavItem[],
		sidebar: {
			"/guide/": createSidebarItems(),
			"/apps/": createSidebarItems(),
			"/api/": typedocSidebar,
		},

		externalLinkIcon: true,
		editLink: {
			text: "Edit this page on GitHub",
			pattern: `${repoUrl}/edit/${branch}/packages/patreon-bun/docs/:path`,
		},
		socialLinks: [
			{
				icon: "github",
				link: repoUrl,
			},
		],

		outline: "deep",
		search: {
			provider: "local",
			options: {
				detailedView: true,
			},
		},

		footer: {
			message: `Released under <a href="${repoUrl}/blob/${branch}/packages/patreon-bun/LICENSE">the ${license} License</a>.`,
			copyright: `Copyright © 2023 - present | ${author}`,
		},
	},
});
