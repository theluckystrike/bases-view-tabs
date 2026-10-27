import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type BasesViewTabsPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select Pin view (Pro) and the icon items of the tab menu. The select shows the shared Pro notice
// with the "Sponsor on GitHub" button and saves nothing. A Pro user pins the view with no Pro notice.
type Host = { plugins: { plugins: Record<string, BasesViewTabsPlugin> } };
const LEAD = 'Pinned views and view icons need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['bases-view-tabs']!;
		const pro = p.pro as SponsorsManager;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on);
}

/** Opens the tab menu of the first tab, selects the item with this title, then returns the notices and the saved data. */
async function select(title: string) {
	await obsidianPage.openFile('Bases View Tabs/Tasks.base');
	await browser.waitUntil(async () => (await browser.$$('.workspace-leaf.mod-active .bvt-tab').length) === 3, { timeout: 15000, timeoutMsg: 'No tabs' });
	await browser.executeObsidian(() => {
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		const tab = activeDocument.querySelector<HTMLElement>('.workspace-leaf.mod-active .bvt-tab')!;
		const r = tab.getBoundingClientRect();
		tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
	});
	const item = await browser.$(`//div[contains(@class,"menu-item")][.//div[contains(@class,"menu-item-title") and normalize-space(text())="${title}"]]`);
	await item.waitForDisplayed({ timeout: 5000 });
	const disabled = ((await item.getAttribute('class')) ?? '').includes('is-disabled');
	await item.click();
	await browser.pause(400);
	return browser.executeObsidian(async ({ app }, disabled) => {
		const p = (app as unknown as Host).plugins.plugins['bases-view-tabs']!;
		return {
			disabled,
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			appearances: JSON.stringify(p.settings.appearances),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			icons: activeDocument.querySelectorAll('.workspace-leaf.mod-active .bvt-tab .bvt-icon').length,
		};
	}, disabled);
}

describe('Pro items of the tab menu', function () {
	afterEach(async () => {
		await browser.keys('Escape');
		await setPro(false);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['bases-view-tabs']!;
			p.settings.appearances = {}; await p.saveSettings(); p.refresh();
		});
	});

	it('a free user who selects Pin view (Pro) or an icon gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		const before = await browser.executeObsidian(async ({ app }) => JSON.stringify((await (app as unknown as Host).plugins.plugins['bases-view-tabs']!.loadData()) ?? {}));
		const pin = await select('Pin view (Pro)');
		expect(pin.disabled).toBe(false);
		if (!pin.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Pin view: ${JSON.stringify(pin.notices)}`);
		expect(pin.appearances).toBe('{}');
		expect(pin.saved).toBe(before);
		const icon = await select('Icon: star');
		if (!icon.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Icon: star: ${JSON.stringify(icon.notices)}`);
		expect(icon.appearances).toBe('{}');
		expect(icon.saved).toBe(before);
		expect(icon.icons).toBe(0);
	});

	it('a Pro user who selects Pin view pins it, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		const pin = await select('Pin view');
		expect(pin.appearances).toContain('"pinned":true');
		expect(pin.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
