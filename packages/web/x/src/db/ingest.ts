// SPDX-License-Identifier: Apache-2.0

import { parseUserResult } from "../core/parse";
import type { Store } from "./store";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function findAndUpsertUsers(root: unknown, store: Store): number {
	const stack: unknown[] = [root];
	const visited = new WeakSet<object>();
	const userIds = new Set<string>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (!isObject(current) || visited.has(current)) continue;
		visited.add(current);

		const userResults = current.user_results;
		if (isObject(userResults) && isObject(userResults.result)) {
			const user = parseUserResult(userResults.result);
			if (user && !userIds.has(user.id)) {
				store.upsertUser(user);
				userIds.add(user.id);
			}
		}

		for (const value of Object.values(current)) {
			if (Array.isArray(value)) stack.push(...value);
			else if (isObject(value)) stack.push(value);
		}
	}

	return userIds.size;
}
