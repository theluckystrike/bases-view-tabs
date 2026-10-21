import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_ONCE_URL, PRO_UI } from './pro';
import type BasesViewTabsPlugin from './main';
import { helloSettingItems } from './hello/settings';
export { DEFAULT_SETTINGS, normalizeSettings } from './model';

export class BasesViewTabsSettingTab extends PluginSettingTab {
 constructor(app: App, private readonly owner: BasesViewTabsPlugin) { super(app, owner); }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Wrap tabs', desc: 'Use more than one line when the views do not fit. Off keeps a horizontally scrolling strip.', control: { type: 'toggle', key: 'wrap', defaultValue: false } },
   ...(this.owner.pro?.isPro() ? [] : [{ name: 'Pinned views and icons', render: (setting) => {
    setting.descEl.createEl('a', { text: '$15 one time or $5 a month', href: PRO_ONCE_URL });
   } } satisfies SettingDefinitionItem]),
   ...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  await super.setControlValue(key, value);
  this.owner.refresh();
 }
}
