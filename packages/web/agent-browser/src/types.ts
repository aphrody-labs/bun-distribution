// SPDX-License-Identifier: Apache-2.0

export interface LaunchOptions {
	headless?: boolean;
	session?: string;
	executablePath?: string;
	cdpUrl?: string;
	port?: number;
	proxy?: string;
	userDataDir?: string;
	hideScrollbars?: boolean;
	timeoutMs?: number;
}

export interface RefEntry {
	ref: string;
	role: string;
	name: string;
	backendNodeId?: number;
	selector?: string;
	frameId?: string;
}

export interface SnapshotResult {
	raw: string;
	refs: Map<string, RefEntry>;
	title?: string;
	url?: string;
}

export interface ClickOptions {
	button?: "left" | "right" | "middle";
	clickCount?: number;
	delayMs?: number;
	force?: boolean;
}

export interface ScreenshotOptions {
	path?: string;
	fullPage?: boolean;
	format?: "png" | "jpeg";
	quality?: number;
}

export interface PdfOptions {
	path?: string;
	landscape?: boolean;
	displayHeaderFooter?: boolean;
	printBackground?: boolean;
	scale?: number;
}

export interface Cookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
}

export interface CommandResponse<T = unknown> {
	id: string;
	success: boolean;
	data?: T;
	error?: string;
}
