import { parseDocument } from 'yaml';

export interface ViewInfo { name: string; type: string }
export interface Appearance { pinned: boolean; icon: string }
export interface TabInfo extends ViewInfo, Appearance { active: boolean }
export interface TabSettings { wrap: boolean; appearances: Record<string, Appearance> }
export const ICONS = ['', 'table', 'list', 'calendar', 'columns-3', 'star', 'check-check', 'briefcase'] as const;
export const DEFAULT_SETTINGS: TabSettings = { wrap: false, appearances: {} };
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const preferenceKey = (path: string, name: string): string => JSON.stringify([path, name]);

export function normalizeSettings(raw: unknown): TabSettings {
	const saved = object(raw) ? raw : {};
	const appearances: Record<string, Appearance> = {};
	if (object(saved.appearances)) for (const [key, value] of Object.entries(saved.appearances)) {
		try {
			const parts: unknown = JSON.parse(key);
			if (!Array.isArray(parts) || parts.length !== 2 || !parts.every((p: unknown) => typeof p === 'string' && p.length > 0) || !object(value)) continue;
			appearances[key] = { pinned: value.pinned === true, icon: typeof value.icon === 'string' && ICONS.some((i) => i === value.icon) ? value.icon : '' };
		} catch { /* Corrupt preferences do not affect the free tabs. */ }
	}
	return { wrap: saved.wrap === true, appearances };
}

/** Read only. Invalid YAML or ambiguous names leave view selection to core Bases. */
export function readViews(text: string): ViewInfo[] {
	try {
		const doc = parseDocument(text);
		if (doc.errors.length) return [];
		const data: unknown = doc.toJS({ maxAliasCount: 100 });
		if (!object(data) || !Array.isArray(data.views)) return [];
		const views: ViewInfo[] = [];
		const names = new Set<string>();
		for (const value of data.views as unknown[]) {
			if (!object(value) || typeof value.name !== 'string' || !value.name.trim() || typeof value.type !== 'string' || !value.type.trim()) continue;
			if (names.has(value.name)) return [];
			names.add(value.name);
			views.push({ name: value.name, type: value.type });
		}
		return views;
	} catch { return []; }
}

export function planTabs(views: ViewInfo[], active: string, appearances: Record<string, Appearance>, path: string, pro: boolean): TabInfo[] {
	const selected = views.some((v) => v.name === active) ? active : views[0]?.name;
	const tabs = views.map((view): TabInfo => {
		const style = appearances[preferenceKey(path, view.name)];
		return { ...view, active: view.name === selected, pinned: pro && style?.pinned === true, icon: pro ? style?.icon ?? '' : '' };
	});
	return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

/** Golden vector and live strip entry point. */
export function tabModel(text: string, active = '', raw: unknown = null, path = '', pro = false): TabInfo[] {
	return planTabs(readViews(text), active, normalizeSettings(raw).appearances, path, pro);
}

export function keyTarget(key: string, index: number, length: number, rtl = false): number | null {
	if (length < 1) return null;
	if (key === 'Home') return 0;
	if (key === 'End') return length - 1;
	if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
	const step = (key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
	return ((index + step) % length + length) % length;
}

export function movePreferences(settings: TabSettings, oldPath: string, newPath: string): TabSettings {
	const appearances: Record<string, Appearance> = {};
	for (const [key, value] of Object.entries(settings.appearances)) {
		const [path, name] = JSON.parse(key) as [string, string];
		const moved = path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
		appearances[preferenceKey(moved, name)] = { ...value };
	}
	return { ...settings, appearances };
}
