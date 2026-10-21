import { Component, Menu, Notice, setIcon, setTooltip, type TFile, type WorkspaceLeaf } from 'obsidian';
import { ICONS, keyTarget, planTabs, readViews, type TabInfo } from './model';
import type BasesViewTabsPlugin from './main';

/** Core DOM attachment is isolated here; switching uses WorkspaceLeaf.setViewState. */
export class TabStrip extends Component {
 readonly el: HTMLElement;
 private signature = '';
 private revision = 0;
 private disposed = false;
 private switching = false;
 private disabled = false;
 private panel: HTMLElement | null = null;
 private restorePanel: (() => void) | null = null;
 private static nextId = 0;
 private tabs: TabInfo[] = [];
 private openMenu: Menu | null = null;

 constructor(readonly owner: BasesViewTabsPlugin, readonly leaf: WorkspaceLeaf, readonly file: TFile, readonly header: HTMLElement) {
  super();
  this.el = header.createDiv({ cls: 'bvt-strip' });
  this.el.setAttribute('role', 'tablist');
  this.el.setAttribute('aria-label', `${file.basename} views`);
  this.el.setAttribute('aria-orientation', 'horizontal');
  this.mount();
 }

 onload(): void {
  this.registerDomEvent(this.el, 'click', (event) => {
   const button = (event.target as Element).closest<HTMLButtonElement>('button[data-view]');
   if (button) void this.select(button.dataset.view ?? '');
  });
  this.registerDomEvent(this.el, 'keydown', (event) => {
   const buttons = Array.from(this.el.querySelectorAll<HTMLButtonElement>('button[data-view]'));
   const index = buttons.findIndex((b) => b === event.target);
   if (index < 0) return;
   const rtl = this.el.ownerDocument.defaultView?.getComputedStyle(this.el).direction === 'rtl';
   const next = keyTarget(event.key, index, buttons.length, rtl);
   if (next === null) return;
   event.preventDefault();
   buttons[next]?.focus();
   // Manual activation: Enter or Space activates the focused native button.
  });
  this.registerDomEvent(this.el, 'contextmenu', (event) => {
   const button = (event.target as Element).closest<HTMLButtonElement>('button[data-view]');
   const tab = this.tabs.find((t) => t.name === button?.dataset.view);
   if (!tab) return;
   event.preventDefault();
   this.menu(tab).showAtMouseEvent(event);
  });
 }

 /** Shared NoteMods mount: append controls; never compete for the next sibling. */
 private mount(): void {
  const parent = this.header.parentElement;
  if (!parent || !this.header.isConnected) return;
  let slot = Array.from(parent.children).find((el) => el.classList.contains('notemods-bases-controls'));
  if (!slot) {
   slot = this.header.createDiv({ cls: 'notemods-bases-controls' });
   this.header.insertAdjacentElement('afterend', slot);
  }
  if (!this.el.isConnected || this.el.parentElement !== slot) slot.appendChild(this.el);
 }

 private bindPanel(): void {
  const panel = this.header.parentElement?.querySelector<HTMLElement>('.bases-view') ?? null;
  if (panel === this.panel) return;
  this.restorePanel?.();
  this.panel = panel;
  this.signature = '';
  if (!panel) return;
  const attributes = ['id', 'role', 'aria-labelledby'];
  const previous = attributes.map((key) => panel.getAttribute(key));
  if (!panel.id) panel.id = `bvt-panel-${++TabStrip.nextId}`;
  panel.setAttribute('role', 'tabpanel');
  this.restorePanel = () => attributes.forEach((key, i) => {
   const value = previous[i];
   if (value == null) panel.removeAttribute(key); else panel.setAttribute(key, value);
  });
 }

 async refresh(): Promise<void> {
  if (this.disposed || this.disabled) return;
  const revision = ++this.revision;
  try {
   const text = await this.owner.app.vault.cachedRead(this.file);
   if (this.disposed || revision !== this.revision) return;
   const state = this.leaf.getViewState();
   const selected = typeof state.state?.viewName === 'string' ? state.state.viewName : '';
   this.tabs = planTabs(readViews(text), selected, this.owner.settings.appearances, this.file.path, this.owner.pro?.isPro() ?? false);
   const signature = JSON.stringify([this.tabs, this.owner.settings.wrap]);
   this.mount();
   this.bindPanel();
   if (signature === this.signature && this.el.isConnected) return;
   this.signature = signature;
   this.render();
  } catch {
   if (!this.disposed && revision === this.revision) { this.tabs = []; this.signature = ''; this.render(); }
  }
 }

 private render(): void {
  const focused = this.el.contains(this.el.ownerDocument.activeElement) ? (this.el.ownerDocument.activeElement as HTMLElement).dataset.view : null;
  this.el.empty();
  this.el.toggleClass('bvt-wrap', this.owner.settings.wrap);
  this.el.hidden = this.tabs.length === 0;
  for (const tab of this.tabs) {
   const button = this.el.createEl('button', { cls: 'bvt-tab', attr: { type: 'button', role: 'tab', 'data-view': tab.name, 'aria-selected': String(tab.active), 'aria-label': tab.name, tabindex: tab.active ? '0' : '-1' } });
   if (tab.pinned) setIcon(button.createSpan({ cls: 'bvt-icon', attr: { 'aria-hidden': 'true' } }), 'pin');
   if (tab.icon) setIcon(button.createSpan({ cls: 'bvt-icon', attr: { 'aria-hidden': 'true' } }), tab.icon);
   button.createSpan({ text: tab.name });
   setTooltip(button, `${tab.name} (${tab.type})`);
   if (this.panel) {
    button.id = `${this.panel.id}-tab-${this.tabs.indexOf(tab)}`;
    button.setAttribute('aria-controls', this.panel.id);
    if (tab.active) this.panel.setAttribute('aria-labelledby', button.id);
   }
   if (focused === tab.name) button.focus();
  }
 }

 async select(name: string): Promise<void> {
  if (this.disposed || this.disabled || this.switching) return;
  this.switching = true;
  try {
   if (!readViews(await this.owner.app.vault.cachedRead(this.file)).some((v) => v.name === name) || this.disposed) return;
   const state = this.leaf.getViewState();
   if (state.type !== 'bases' || state.state?.file !== this.file.path) return;
   await this.leaf.setViewState({ ...state, state: { ...state.state, viewName: name } });
   if (this.disposed) return;
   if (this.leaf.getViewState().state?.viewName !== name) {
    this.disabled = true;
    this.revision++;
    this.el.hidden = true;
    new Notice('Could not switch this base view. Use the native view menu.');
    return;
   }
   await this.refresh();
  } catch { new Notice('Could not switch this base view. Use the native view menu.'); }
  finally { this.switching = false; }
 }

 menu(tab: TabInfo): Menu {
  this.openMenu?.hide();
  const menu = new Menu();
  this.openMenu = menu;
  menu.onHide(() => { if (this.openMenu === menu) this.openMenu = null; });
  const pro = this.owner.pro?.isPro() ?? false;
  menu.addItem((item) => item.setTitle(tab.pinned ? 'Unpin view' : pro ? 'Pin view' : 'Pin view (Pro)').setIcon('pin').setDisabled(!pro).onClick(() => this.owner.customize(this.file.path, tab.name, { pinned: !tab.pinned })));
  for (const icon of ICONS) menu.addItem((item) => item.setTitle(icon ? `Icon: ${icon}` : 'No icon').setChecked(tab.icon === icon).setDisabled(!pro).onClick(() => this.owner.customize(this.file.path, tab.name, { icon })));
  return menu;
 }

 focus(): void { this.el.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); }
 onunload(): void { this.disposed = true; this.revision++; this.openMenu?.hide(); this.openMenu = null; this.restorePanel?.(); this.restorePanel = null; const slot = this.el.parentElement; this.el.remove(); if (slot?.classList.contains('notemods-bases-controls') && !slot.childElementCount) slot.remove(); }
}
