import { Plugin, FileView, debounce, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, movePreferences, preferenceKey, readViews, type Appearance, type TabSettings } from './model';
import { dropLastViews, moveLastViews, movedPath, rememberView, restoreTarget } from './remember';
import { BasesViewTabsSettingTab } from './settings';
import { SPONSORS } from './pro';
import { TabStrip } from './strip';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** One open of a .base file in a leaf. `view` is the last view seen in that leaf; `ready` is false until the restore step ends. */
interface BaseOpen { path: string; view: string; ready: boolean }

/** The .base path and the selected view in the leaf state (`viewName` is the core Bases state key, see BRIEF.md). */
function baseState(leaf: WorkspaceLeaf): { path: string; view: string } {
 const state = leaf.getViewState();
 if (state.type !== 'bases') return { path: '', view: '' };
 const path = typeof state.state?.file === 'string' ? state.state.file : '';
 const view = typeof state.state?.viewName === 'string' ? state.state.viewName : '';
 return { path: path.endsWith('.base') ? path : '', view };
}

export default class BasesViewTabsPlugin extends Plugin {
 settings: TabSettings = { ...DEFAULT_SETTINGS, appearances: {}, lastViews: {} };
 pro: SponsorsManager | null = null;
 private stopped = false;
 private strips = new Map<WorkspaceLeaf, TabStrip>();
 private observers = new Map<WorkspaceLeaf, { container: HTMLElement; observer: MutationObserver }>();
 private settingTab: BasesViewTabsSettingTab | null = null;
 private opens = new Map<WorkspaceLeaf, BaseOpen>();

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
  // Leaves of the saved layout keep their saved view. Only later opens get the remembered view.
  for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
   const { path, view } = baseState(leaf);
   if (path) this.opens.set(leaf, { path, view, ready: true });
  }
  this.registerEvent(this.app.workspace.on('layout-change', () => { this.trackOpens(); scan(); }));
  this.registerEvent(this.app.workspace.on('active-leaf-change', () => scan()));
  this.registerEvent(this.app.vault.on('modify', (file) => {
   for (const strip of this.strips.values()) if (strip.file === file) void strip.refresh();
  }));
  this.registerEvent(this.app.vault.on('rename', (file, old) => {
   for (const open of this.opens.values()) open.path = movedPath(open.path, old, file.path);
   const next = { ...movePreferences(this.settings, old, file.path), lastViews: moveLastViews(this.settings.lastViews, old, file.path) };
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
   const lastViews = dropLastViews(this.settings.lastViews, file.path);
   const dropped = Object.keys(lastViews).length !== Object.keys(this.settings.lastViews).length;
   if (keys.length || dropped) {
    for (const key of keys) delete this.settings.appearances[key];
    this.settings.lastViews = lastViews;
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
  this.trackOpens();
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
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-view-name'] });
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

 /** Finds new opens of .base files (restore step) and view changes in open leaves (record step). */
 trackOpens(): void {
  if (this.stopped) return;
  const live = new Set<WorkspaceLeaf>();
  for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
   const { path, view } = baseState(leaf);
   if (!path) continue;
   const open = this.opens.get(leaf);
   if (!open || open.path !== path) {
    // A background leaf of the layout loads later; it is a new open only when its view exists.
    if (leaf.isDeferred || !(leaf.view instanceof FileView)) continue;
    live.add(leaf);
    const next: BaseOpen = { path, view: '', ready: false };
    this.opens.set(leaf, next);
    void this.restoreView(leaf, next);
    continue;
   }
   live.add(leaf);
   if (open.ready && view && view !== open.view) {
    open.view = view;
    this.recordView(path, view);
   }
  }
  for (const leaf of this.opens.keys()) if (!live.has(leaf)) this.opens.delete(leaf);
 }

 /** Selects the remembered view after a new open, when the open did not name another view. */
 async restoreView(leaf: WorkspaceLeaf, open: BaseOpen): Promise<void> {
  try {
   const stored = this.settings.lastViews[open.path];
   const file = this.app.vault.getFileByPath(open.path);
   if (!this.settings.rememberView || !stored || !file) return;
   const views = readViews(await this.app.vault.cachedRead(file)).map((v) => v.name);
   if (this.stopped || this.opens.get(leaf) !== open) return;
   const state = leaf.getViewState();
   const { path, view } = baseState(leaf);
   if (path !== open.path) return;
   const target = restoreTarget({ enabled: this.settings.rememberView, stored, current: view, views });
   if (target) await leaf.setViewState({ ...state, state: { ...state.state, viewName: target } });
  } catch { /* Core Bases keeps the view that it selected. */ }
  finally {
   if (this.opens.get(leaf) === open) { open.view = baseState(leaf).view; open.ready = true; }
  }
 }

 private recordView(path: string, view: string): void {
  if (!this.settings.rememberView || this.settings.lastViews[path] === view) return;
  this.settings.lastViews = rememberView(this.settings.lastViews, path, view);
  void this.saveSettings();
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
  this.opens.clear();
  for (const entry of this.observers.values()) entry.observer.disconnect();
  this.observers.clear();
  for (const strip of this.strips.values()) this.removeChild(strip);
  this.strips.clear();
 }
}
