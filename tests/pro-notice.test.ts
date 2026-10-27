import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MenuItem, Notice, TFile } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import type { WorkspaceLeaf } from 'obsidian';
import BasesViewTabsPlugin from '../src/main';
import { TabStrip } from '../src/strip';
import { preferenceKey } from '../src/model';
import manifest from '../manifest.json';

// A free user can select Pin view (Pro) and the icon items of the tab menu. The select shows the shared Pro notice
// with the "Sponsor on GitHub" button and saves nothing. A Pro user pins the view and sets the icon as before.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const LEAD = 'Pinned views and view icons need Pro.';
const cleanup: TabStrip[] = [];

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'bases-view-tabs' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'Tasks.base': 'views: [{name: All, type: table}, {name: Done, type: table}]' } });
	const file = app.vault.getAbstractFileByPath('Tasks.base') as TFile;
	const plugin = new BasesViewTabsPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.pro = fakePro(pro);
	const save = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
	vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined);
	const host = document.createElement('div'); document.body.append(host);
	const header = host.createDiv({ cls: 'bases-header' }); host.createDiv({ cls: 'bases-view' });
	const leaf = { getViewState: () => ({ type: 'bases', state: { file: 'Tasks.base', viewName: 'All' } }), setViewState: vi.fn() } as unknown as WorkspaceLeaf;
	const strip = new TabStrip(plugin, leaf, file as never, header); strip.load(); cleanup.push(strip);
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	return { plugin, strip, save, shown };
}
const item = (menu: { items: unknown[] }, title: string) => (menu.items as MenuItem[]).find((i) => i.title__ === title)!;
const click = async (i: MenuItem) => { await i.onClick__?.(new MouseEvent('click')); };

describe('Pro items of the tab menu', () => {
	afterEach(() => { for (const s of cleanup.splice(0)) s.unload(); document.body.replaceChildren(); vi.restoreAllMocks(); });

	it('a free user who selects Pin view (Pro) or an icon gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		const { plugin, strip, save, shown } = await setup(false);
		const tab = { name: 'All', type: 'table', active: true, pinned: false, icon: '' };
		const menu = strip.menu(tab) as unknown as { items: unknown[] };
		const pin = item(menu, 'Pin view (Pro)');
		const star = item(menu, 'Icon: star');
		expect(pin.disabled).toBe(false);
		expect(star.disabled).toBe(false);
		await click(pin);
		await click(star);
		expect(shown).toEqual([
			{ text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(save).not.toHaveBeenCalled();
		expect(plugin.settings.appearances).toEqual({});
	});

	it('a Pro user who selects Pin view and an icon saves them, with no Pro notice', async () => {
		const { plugin, strip, save, shown } = await setup(true);
		const tab = { name: 'All', type: 'table', active: true, pinned: false, icon: '' };
		const menu = strip.menu(tab) as unknown as { items: unknown[] };
		await click(item(menu, 'Pin view'));
		await click(item(menu, 'Icon: star'));
		expect(save).toHaveBeenCalledTimes(2);
		expect(plugin.settings.appearances[preferenceKey('Tasks.base', 'All')]).toEqual({ pinned: true, icon: 'star' });
		expect(shown).toEqual([]);
	});
});
