import { Browser } from "../src/api/browser.ts";
import { join } from "node:path";

async function run() {
	const futRoot = join(import.meta.dir, "..", "..", "..", "packages", "fut");
	const outDir = join(futRoot, "src", "docs", "screenshots");

	// 1. FUT.GG Squad Builder
	console.log("Launching browser for FUT.GG Squad Builder...");
	const pageFutgg = await Browser.newPage({
		profile: "stealth",
		viewport: { width: 1920, height: 1080 },
	});

	try {
		console.log("Navigating to https://www.fut.gg/squad-builder/ ...");
		await pageFutgg.goto("https://www.fut.gg/squad-builder/");
		await Bun.sleep(4000);

		// Full-screen HD capture
		const futggScreenshotPath = join(outDir, "futgg_squad_builder_hd.png");
		await pageFutgg.screenshot({
			path: futggScreenshotPath,
			fullPage: true,
		});
		console.log("Captured FUT.GG HD screenshot:", futggScreenshotPath);

		// Extract DOM details
		const futggDetails = await pageFutgg.evaluate(`(() => {
			const buttons = Array.from(document.querySelectorAll("button")).map(b => ({
				text: b.innerText.trim(),
				ariaLabel: b.getAttribute("aria-label"),
				className: b.className,
			})).filter(b => b.text || b.ariaLabel);

			const inputs = Array.from(document.querySelectorAll("input, select, textarea")).map(i => ({
				tag: i.tagName.toLowerCase(),
				type: i.getAttribute("type"),
				name: i.getAttribute("name"),
				placeholder: i.getAttribute("placeholder"),
				value: i.value,
				className: i.className,
			}));

			const links = Array.from(document.querySelectorAll("a")).map(a => ({
				text: a.innerText.trim(),
				href: a.href,
			})).filter(a => a.text && a.href && !a.href.startsWith("javascript"));

			return {
				title: document.title,
				buttonsCount: buttons.length,
				buttons: buttons.slice(0, 50),
				inputsCount: inputs.length,
				inputs,
				linksCount: links.length,
				links: links.slice(0, 30),
			};
		})()`);

		await Bun.write(
			join(outDir, "futgg_squad_builder_meta.json"),
			JSON.stringify(futggDetails, null, 2),
		);
		console.log("Saved FUT.GG meta JSON!");
	} catch (err) {
		console.error("Error capturing FUT.GG:", err);
	} finally {
		await pageFutgg.close();
	}

	// 2. FUTBin Squad Builder
	console.log("\nLaunching browser for FUTBin Squad Builder...");
	const futbinCookiesPath = join(futRoot, "src", "cookies", "futbin.json");
	const pageFutbin = await Browser.newPage({
		profile: "stealth",
		cookies: futbinCookiesPath,
		viewport: { width: 1920, height: 1080 },
	});

	try {
		console.log("Navigating to https://www.futbin.com/27/squad-builder or /25/squad-builder ...");
		// Test 27 first, fallback to 25/26 if 27 redirects
		await pageFutbin.goto("https://www.futbin.com/25/squad-builder");
		await Bun.sleep(5000);

		const futbinScreenshotPath = join(outDir, "futbin_squad_builder_hd.png");
		await pageFutbin.screenshot({
			path: futbinScreenshotPath,
			fullPage: true,
		});
		console.log("Captured FUTBin HD screenshot:", futbinScreenshotPath);

		const futbinDetails = await pageFutbin.evaluate(`(() => {
			const buttons = Array.from(document.querySelectorAll("button, .btn, input[type='button'], input[type='submit']")).map(b => ({
				text: (b.innerText || b.value || "").trim(),
				className: b.className,
				id: b.id,
			})).filter(b => b.text);

			const inputs = Array.from(document.querySelectorAll("input, select, textarea")).map(i => ({
				tag: i.tagName.toLowerCase(),
				type: i.getAttribute("type"),
				name: i.getAttribute("name"),
				id: i.id,
				placeholder: i.getAttribute("placeholder"),
				value: i.value,
				className: i.className,
			}));

			return {
				title: document.title,
				buttonsCount: buttons.length,
				buttons: buttons.slice(0, 50),
				inputsCount: inputs.length,
				inputs: inputs.slice(0, 50),
			};
		})()`);

		await Bun.write(
			join(outDir, "futbin_squad_builder_meta.json"),
			JSON.stringify(futbinDetails, null, 2),
		);
		console.log("Saved FUTBin meta JSON!");
	} catch (err) {
		console.error("Error capturing FUTBin:", err);
	} finally {
		await pageFutbin.close();
	}
}

run().catch(console.error);
