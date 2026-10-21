import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, FileView } from 'obsidian-test-mocks/obsidian';
import BasesViewTabsPlugin from '../src/main';
import { DEFAULT_SETTINGS, preferenceKey } from '../src/model';
import manifest from '../manifest.json';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('plugin preferences and Pro boundaries', () => {
 function plugin() { return new BasesViewTabsPlugin(App.createConfigured__({ files: {} }) as never, manifest as never); }
 it('loads safe defaults', async () => { const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); });
 it('does not save Pro appearance for a free account', async () => {
  const p = plugin(); const save = vi.spyOn(p, 'saveSettings').mockResolvedValue();
  await p.customize('A.base', 'All', { pinned: true });
  expect(save).not.toHaveBeenCalled(); expect(p.settings.appearances).toEqual({});
 });
 it('saves Pro convenience only with a verified manager', async () => {
  const p = plugin(); p.pro = { isPro: () => true } as never;
  vi.spyOn(p, 'saveSettings').mockResolvedValue(); vi.spyOn(p, 'refresh').mockImplementation(() => {});
  await p.customize('A.base', 'All', { pinned: true });
  await p.customize('A.base', 'All', { icon: 'star' });
  expect(p.settings.appearances[preferenceKey('A.base', 'All')]).toEqual({ pinned: true, icon: 'star' });
 });
 it('stopped plugins cannot scan or add strips', () => { const p = plugin(); p.onunload(); expect(() => p.scan()).not.toThrow(); });
 it('observes only Base containers and removes strips on close or disable', async () => {
  const app = App.createConfigured__({files:{'A.base':'views: [{name: All, type: table}]'}});
  const p = new BasesViewTabsPlugin(app as never, manifest as never);
  const container = document.createElement('div'); document.body.append(container);
  container.createDiv({cls:'bases-header'}); container.createDiv({cls:'bases-view'});
  const file = app.vault.getAbstractFileByPath('A.base');
  const view = Object.assign(Object.create(FileView.prototype), {containerEl:container,file});
  const leaf = {view,getViewState:()=>({type:'bases',state:{file:'A.base',viewName:'All'}})};
  const leaves = vi.spyOn(app.workspace,'getLeavesOfType').mockReturnValue([leaf] as never);
  const observe = vi.spyOn(MutationObserver.prototype,'observe');
  const disconnect = vi.spyOn(MutationObserver.prototype,'disconnect');
  // Load real child components without starting the Sponsors service in this focused test.
  vi.spyOn(p,'addChild').mockImplementation((child) => { child.load(); return child; });
  p.scan(); await new Promise(r=>setTimeout(r,0));
  expect(observe).toHaveBeenCalledWith(container,{childList:true,subtree:true});
  expect(observe).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.bvt-strip')).not.toBeNull();
  leaves.mockReturnValue([]); p.scan();
  expect(document.querySelector('.bvt-strip')).toBeNull(); expect(disconnect).toHaveBeenCalled();
  leaves.mockReturnValue([leaf] as never); p.scan(); await new Promise(r=>setTimeout(r,0));
  expect(document.querySelector('.bvt-strip')).not.toBeNull();
  p.onunload(); expect(document.querySelector('.bvt-strip')).toBeNull();
 });

});
