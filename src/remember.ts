/**
 * The last selected view of each .base file (free). Pure functions; main.ts connects them to the workspace.
 * Key order is age order: the first key is the oldest entry, the last key is the newest entry.
 */
export type LastViews = Record<string, string>;
export const REMEMBER_LIMIT = 200;

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Corrupt entries are dropped. Only the newest `limit` entries stay. */
export function normalizeLastViews(raw: unknown, limit = REMEMBER_LIMIT): LastViews {
	if (!object(raw)) return {};
	const entries = Object.entries(raw).filter((e): e is [string, string] => e[0].length > 0 && typeof e[1] === 'string' && e[1].length > 0);
	return Object.fromEntries(entries.slice(Math.max(0, entries.length - limit)));
}

/** Stores `name` as the newest entry for `path`. The oldest entries go when the store is full. */
export function rememberView(views: LastViews, path: string, name: string, limit = REMEMBER_LIMIT): LastViews {
	if (!path || !name) return views;
	const next: LastViews = { ...views };
	delete next[path];
	next[path] = name;
	return normalizeLastViews(next, limit);
}

/** The new path of `path` after a rename of `oldPath` (a file or a folder) to `newPath`. */
export function movedPath(path: string, oldPath: string, newPath: string): string {
	if (path === oldPath) return newPath;
	return path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
}

/** Moves the entries of a renamed file or folder. Other entries and the age order stay. */
export function moveLastViews(views: LastViews, oldPath: string, newPath: string): LastViews {
	return Object.fromEntries(Object.entries(views).map(([path, name]) => [movedPath(path, oldPath, newPath), name]));
}

/** Removes the entries of a deleted file or folder. */
export function dropLastViews(views: LastViews, path: string): LastViews {
	return Object.fromEntries(Object.entries(views).filter(([key]) => key !== path && !key.startsWith(`${path}/`)));
}

export interface RestoreInput {
	/** The "Remember the last view" setting. */
	enabled: boolean;
	/** The stored view of this base, if there is one. */
	stored: string | undefined;
	/** viewName in the leaf state right after the open. An empty string means "not set yet". */
	current: string;
	/** The view names of the .base file, in file order. Core Bases shows the first one when no view is set. */
	views: string[];
}

/**
 * The view to select after a new open of a base, or null to keep the current view.
 * A view other than the default (the first view) came from a link, a saved layout or the user: it stays.
 * Core Bases puts the default view in the state when the open names no view, so the default view can be replaced.
 * Known limit: a link to the first view looks like a plain open. View.getEphemeralState returns {} and
 * BasesView.setEphemeralState does not keep the link subpath (Obsidian 1.15.0 app.js). Only a patch of
 * WorkspaceLeaf.openFile could see it, and BRIEF.md allows no core patch.
 */
export function restoreTarget({ enabled, stored, current, views }: RestoreInput): string | null {
	if (!enabled || !stored || !views.includes(stored)) return null;
	const fallback = views[0] ?? '';
	if (current && current !== fallback) return null;
	return stored === (current || fallback) ? null : stored;
}
