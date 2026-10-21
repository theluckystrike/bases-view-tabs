import { Plugin, FileView, debounce, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, movePreferences, preferenceKey, type Appearance, type TabSettings } from './model';
import { BasesViewTabsSettingTab } from './settings';
import { SPONSORS } from './pro';
import { TabStrip } from './strip';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class BasesViewTabsPlugin extends Plugin {
 settings: TabSettings = { ...DEFAULT_SETTINGS, appearances: {} };
 pro: SponsorsManager | null = null;
 private stopped = false;
 private strips = new Map<WorkspaceLeaf, TabStrip>();
 private observers = new Map<WorkspaceLeaf, { container: HTMLElement; observer: MutationObserver }>();
 private settingTab: BasesViewTabsSettingTab | null = null;

 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  await this.loadSettings();
  this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  this.pro.init();
  this.settingTab = new BasesViewTabsSettingTab(this.app, this);
  this.addSettingTab(this.settingTab);
  this.register(this.pro.onChange(() => { this.settingTab?.update(); this.refresh(); }));
  this.addCommand({ id: 'focus-view-tabs', name: 'Focus the view tabs', checkCallback: (checking) => {
   const leaf = this.app.workspace.getActiveViewOfType(FileView)?.leaf;
   const strip = leaf ? this.strips.get(leaf) : undefined;
   if (!strip || strip.el.hidden) return false;
   if (!checking) strip.focus();
   return true;
  } });
  this.app.workspace.onLayoutReady(() => this.start());
 }

 private start(): void {
  if (this.stopped) return;
  const scan = debounce(() => this.scan(), 100, true);
  this.registerEvent(this.app.workspace.on('layout-change', () => scan()));
  this.registerEvent(this.app.workspace.on('active-leaf-change', () => scan()));
  this.registerEvent(this.app.vault.on('modify', (file) => {
   for (const strip of this.strips.values()) if (strip.file === file) void strip.refresh();
  }));
  this.registerEvent(this.app.vault.on('rename', (file, old) => {
   const next = movePreferences(this.settings, old, file.path);
   if (JSON.stringify(next) !== JSON.stringify(this.settings)) {
    this.settings = next;
    void this.saveSettings();
   }
   scan();
  }));
  this.registerEvent(this.app.vault.on('delete', (file) => {
   const keys = Object.keys(this.settings.appearances).filter((key) => {
    const [path] = JSON.parse(key) as [string, string];
    return path === file.path || path.startsWith(`${file.path}/`);
   });
   if (keys.length) {
    for (const key of keys) delete this.settings.appearances[key];
    void this.saveSettings();
   }
   scan();
  }));
  this.scan();
  void this.pro?.refresh();
  this.registerInterval(window.setInterval(() => void this.pro?.refresh(), 6 * 60 * 60 * 1000));
 }

 scan(): void {
  if (this.stopped) return;
  const seen = new Set<WorkspaceLeaf>();
  const baseLeaves = new Set<WorkspaceLeaf>();
  for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
   if (!(leaf.view instanceof FileView) || leaf.view.file?.extension !== 'base') continue;
   baseLeaves.add(leaf);
   const container = leaf.view.containerEl;
   if (this.observers.get(leaf)?.container !== container) {
    this.observers.get(leaf)?.observer.disconnect();
    const scan = debounce(() => this.scan(), 100, true);
    const observer = new MutationObserver((records) => {
     if (records.some((r) => !(r.target.instanceOf(Element) && r.target.closest('.bvt-strip')))) scan();
    });
    observer.observe(container, { childList: true, subtree: true });
    this.observers.set(leaf, { container, observer });
   }
   const header = leaf.view.containerEl.querySelector<HTMLElement>('.bases-header');
   if (!header) continue;
   seen.add(leaf);
   let strip = this.strips.get(leaf);
   if (strip && (strip.file !== leaf.view.file || strip.header !== header)) {
    this.removeChild(strip);
    this.strips.delete(leaf);
    strip = undefined;
   }
   if (!strip) {
    strip = this.addChild(new TabStrip(this, leaf, leaf.view.file, header));
    this.strips.set(leaf, strip);
   }
   void strip.refresh();
  }
  for (const [leaf, entry] of this.observers) if (!baseLeaves.has(leaf)) {
   entry.observer.disconnect();
   this.observers.delete(leaf);
  }
  for (const [leaf, strip] of this.strips) if (!seen.has(leaf)) {
   this.removeChild(strip);
   this.strips.delete(leaf);
  }
 }

 refresh(): void { for (const strip of this.strips.values()) void strip.refresh(); }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 async customize(path: string, name: string, change: Partial<Appearance>): Promise<void> {
  if (!this.pro?.isPro()) return;
  const key = preferenceKey(path, name);
  this.settings.appearances[key] = { pinned: false, icon: '', ...this.settings.appearances[key], ...change };
  await this.saveSettings();
  this.refresh();
 }
 onunload(): void {
  this.stopped = true;
  for (const entry of this.observers.values()) entry.observer.disconnect();
  this.observers.clear();
  for (const strip of this.strips.values()) this.removeChild(strip);
  this.strips.clear();
 }
}
