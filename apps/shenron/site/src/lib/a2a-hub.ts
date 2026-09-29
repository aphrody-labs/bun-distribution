// SPDX-License-Identifier: Apache-2.0
/**
 * a2a-hub.ts — site-side wiring of the Shenron A2A hub (`@shenron/pipeline/aphrody/a2a`).
 *
 * The hub no longer imports the bot `admin-lab` module (W2-APH-05): the host injects
 * the #bot-admin notifier. Here it is `sendAdminLabMessage` of `@/lib/admin-lab`,
 * loaded lazily so route modules do not pull `server-only` until an alert is sent.
 */

import { ShenronA2AHub, type AdminNotifier } from "@shenron/pipeline/aphrody/a2a";

let configured = false;

const siteAdminNotifier: AdminNotifier = async (message) => {
	const { sendAdminLabMessage } = await import("@/lib/admin-lab");
	return sendAdminLabMessage(message);
};

/** Returns the hub, configured once per process with the site admin notifier. */
export function getA2AHub(): typeof ShenronA2AHub {
	if (!configured) {
		ShenronA2AHub.configure({ notifier: siteAdminNotifier });
		configured = true;
	}
	return ShenronA2AHub;
}
