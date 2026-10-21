import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, Notice } from 'obsidian-test-mocks/obsidian';
import { TabStrip } from '../src/strip';
import type BasesViewTabsPlugin from '../src/main';
import type { WorkspaceLeaf } from 'obsidian';

const source = 'views: [{name: All, type: table}, {name: Done, type: table}, {name: "<b>Text</b>", type: cards}]';
const cleanup: TabStrip[] = [];
afterEach(() => { for (const s of cleanup.splice(0)) s.unload(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup(text = source) {
 const app = App.createConfigured__({files: {'Tasks.base': text}});
 const file = app.vault.getAbstractFileByPath('Tasks.base') as TFile;
 const host = document.createElement('div'); document.body.append(host);
 const header = host.createDiv({cls: 'bases-header'});
 host.createDiv({cls: 'bases-view'});
 let state = {type:'bases',state:{file:'Tasks.base',viewName:'All', untouched:42},pinned:true};
 const setViewState = vi.fn(async (next) => { state = next; });
 const leaf = {getViewState: () => state, setViewState} as unknown as WorkspaceLeaf;
 const owner = {app, settings:{wrap:false,appearances:{}}, pro:null, customize:vi.fn()} as unknown as BasesViewTabsPlugin;
 const strip = new TabStrip(owner, leaf, file as never, header); strip.load(); cleanup.push(strip);
 return {app,file,owner,strip,leaf,setViewState,getState:() => state};
}

describe('tab strip integration', () => {
 it('shows free tabs and one keyboard entry point', async () => {
  const {strip} = setup(); await strip.refresh();
  expect(strip.el.getAttribute('role')).toBe('tablist');
  expect(strip.el.querySelectorAll('button')).toHaveLength(3);
  expect(strip.el.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
 });
 it('renders user labels as text without HTML injection', async () => {
  const {strip} = setup(); await strip.refresh();
  expect(strip.el.querySelector('b')).toBeNull(); expect(strip.el.textContent).toContain('<b>Text</b>');
 });
 it('switches only this pane and keeps state fields and Base text', async () => {
  const {strip,app,file,setViewState,getState} = setup(); await strip.refresh();
  const before = await app.vault.cachedRead(file);
  await strip.select('Done');
  expect(setViewState).toHaveBeenCalledTimes(1);
  expect(getState()).toEqual({type:'bases',state:{file:'Tasks.base',viewName:'Done',untouched:42},pinned:true});
  expect(await app.vault.cachedRead(file)).toBe(before);
  expect(strip.el.querySelector('[aria-selected="true"]')?.textContent).toBe('Done');
 });
 it('does not select deleted or unknown views', async () => { const {strip,setViewState} = setup(); await strip.select('Deleted'); expect(setViewState).not.toHaveBeenCalled(); });
 it('does not change a pane that navigated to a different file', async () => {
  const {strip,leaf,setViewState} = setup(); vi.spyOn(leaf,'getViewState').mockReturnValue({type:'bases',state:{file:'Other.base',viewName:'All'}});
  await strip.select('Done'); expect(setViewState).not.toHaveBeenCalled();
 });
 it('ignores repeated activation while a switch is pending', async () => {
  const {strip,setViewState} = setup(); await Promise.all([strip.select('Done'),strip.select('All')]); expect(setViewState).toHaveBeenCalledTimes(1);
 });
 it('hides the strip for malformed Base data', async () => { const {strip} = setup('views: ['); await strip.refresh(); expect(strip.el.hidden).toBe(true); });
 it('keeps focus on the named button after a redraw', async () => {
  const {strip,owner} = setup(); await strip.refresh();
  strip.el.querySelector<HTMLButtonElement>('[data-view="Done"]')?.focus(); owner.settings.wrap = true; await strip.refresh();
  expect((document.activeElement as HTMLElement).dataset.view).toBe('Done');
 });
 it('moves focus with arrows without changing the selected view', async () => {
  const {strip,setViewState} = setup(); await strip.refresh(); strip.focus();
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  expect((document.activeElement as HTMLElement).dataset.view).toBe('Done'); expect(setViewState).not.toHaveBeenCalled();
 });
 it('keeps two panes independent', async () => {
  const a = setup(), b = setup(); await a.strip.refresh(); await b.strip.refresh(); await a.strip.select('Done');
  expect(b.getState().state.viewName).toBe('All'); expect(b.setViewState).not.toHaveBeenCalled();
 });
 it('unloads its DOM and rejects late file reads', async () => {
  const {strip,app} = setup(); let resolve!: (text: string) => void;
  vi.spyOn(app.vault,'cachedRead').mockImplementation(() => new Promise(r => {resolve=r;}));
  const pending = strip.refresh(); strip.unload(); resolve(source); await pending;
  expect(document.querySelector('.bvt-strip')).toBeNull(); expect(strip.el.childElementCount).toBe(0);
 });
 it('does not rebuild identical data', async () => {
  const {strip} = setup(); await strip.refresh(); const button = strip.el.firstElementChild; await strip.refresh(); expect(strip.el.firstElementChild).toBe(button);
 });
 it('reattaches a strip removed during a core redraw', async () => {
  const {strip} = setup(); await strip.refresh(); strip.el.remove(); await strip.refresh(); expect(strip.el.isConnected).toBe(true);
 });
 it('tracks a view selected through the native menu', async () => {
  const {strip,leaf} = setup(); await strip.refresh();
  vi.spyOn(leaf,'getViewState').mockReturnValue({type:'bases',state:{file:'Tasks.base',viewName:'Done'}});
  await strip.refresh(); expect(strip.el.querySelector('[aria-selected="true"]')?.textContent).toBe('Done');
 });
 it('leaves native selection alone if the file cannot be read', async () => {
  const {strip,app,setViewState} = setup(); await strip.refresh();
  vi.spyOn(app.vault,'cachedRead').mockRejectedValue(new Error('gone'));
  await strip.refresh(); expect(strip.el.hidden).toBe(true); expect(setViewState).not.toHaveBeenCalled();
 });
 it('does not switch a pane after unload during a file read', async () => {
  const {strip,app,setViewState} = setup(); let resolve!: (text: string) => void;
  vi.spyOn(app.vault,'cachedRead').mockImplementation(() => new Promise(r => {resolve=r;}));
  const pending = strip.select('Done'); strip.unload(); resolve(source); await pending;
  expect(setViewState).not.toHaveBeenCalled();
 });
 it('closes its open context menu on unload', async () => {
  const {strip} = setup(); const menu = strip.menu({name:'All',type:'table',active:true,pinned:false,icon:''});
  const hide = vi.spyOn(menu,'hide'); strip.unload(); expect(hide).toHaveBeenCalled();
 });
 it('settles with a legacy filter-switches inserter instead of competing for the next sibling', async () => {
  const {strip} = setup(); await strip.refresh();
  const header = strip.header;
  let bar = document.createElement('div'); bar.className = 'fsw-bar';
  let rebuilds = 0;
  const observer = new MutationObserver(() => {
   if (header.nextElementSibling !== bar) {
    bar.remove(); bar = document.createElement('div'); bar.className = 'fsw-bar';
    header.insertAdjacentElement('afterend', bar); rebuilds++;
   }
  });
  observer.observe(header.parentElement!, {childList:true,subtree:true});
  try {
   header.insertAdjacentElement('afterend', bar);
   for (let i=0;i<5;i++) { await strip.refresh(); await new Promise(r=>setTimeout(r,5)); }
   expect(header.nextElementSibling).toBe(bar);
   expect(rebuilds).toBe(0);
   expect(strip.el.parentElement?.className).toBe('notemods-bases-controls');
   const mutations = observer.takeRecords(); expect(mutations).toHaveLength(0);
  } finally { observer.disconnect(); }
 });
 it('reuses the shared control slot without moving other controls', async () => {
  const {strip} = setup(); await strip.refresh();
  const slot = strip.el.parentElement!;
  const other = slot.createDiv({cls:'other-control'});
  await strip.refresh(); expect(other.parentElement).toBe(slot);
  strip.unload(); expect(slot.isConnected).toBe(true); expect(other.isConnected).toBe(true);
 });
 it('hides incompatible switching and warns only once even when setViewState resolves', async () => {
  const notice = vi.spyOn(Notice.prototype, 'constructor__');
  const {strip,setViewState} = setup(); await strip.refresh();
  setViewState.mockImplementation(async () => {});
  await strip.select('Done');
  expect(strip.el.hidden).toBe(true);
  await strip.refresh(); await strip.select('Done');
  expect(strip.el.hidden).toBe(true);
  expect(setViewState).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledWith('Could not switch this base view. Use the native view menu.', undefined);
 });
 it('connects every tab to the core panel and restores panel attributes on unload', async () => {
  const {strip} = setup(); const panel = strip.header.parentElement!.querySelector('.bases-view')!;
  await strip.refresh();
  expect(panel.getAttribute('role')).toBe('tabpanel');
  for (const tab of strip.el.querySelectorAll('button')) expect(tab.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(strip.el.querySelector('[aria-selected="true"]')?.id);
  strip.unload(); expect(panel.hasAttribute('role')).toBe(false); expect(panel.hasAttribute('id')).toBe(false);
 });

});
