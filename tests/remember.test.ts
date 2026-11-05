import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, FileView } from 'obsidian-test-mocks/obsidian';
import BasesViewTabsPlugin from '../src/main';
import { normalizeSettings } from '../src/model';
import { REMEMBER_LIMIT, dropLastViews, moveLastViews, normalizeLastViews, rememberView, restoreTarget } from '../src/remember';
import manifest from '../manifest.json';

afterEach(() => { vi.restoreAllMocks(); });

const VIEWS = ['All', 'Done', 'Later'];

describe('last view store', () => {
 it('stores the newest entry last and keeps one entry per base', () => {
  let views = rememberView({}, 'A.base', 'All');
  views = rememberView(views, 'B.base', 'Done');
  views = rememberView(views, 'A.base', 'Later');
  expect(Object.entries(views)).toEqual([['B.base', 'Done'], ['A.base', 'Later']]);
 });
 it('keeps only the newest 200 entries', () => {
  let views = {};
  for (let i = 0; i < REMEMBER_LIMIT + 25; i++) views = rememberView(views, `B${i}.base`, 'All');
  const keys = Object.keys(views);
  expect(keys).toHaveLength(REMEMBER_LIMIT);
  expect(keys[0]).toBe('B25.base');
  expect(keys.at(-1)).toBe(`B${REMEMBER_LIMIT + 24}.base`);
 });
 it('does not change the input object', () => {
  const views = { 'A.base': 'All' };
  rememberView(views, 'A.base', 'Done');
  expect(views).toEqual({ 'A.base': 'All' });
 });
 it('ignores an empty path or view name', () => {
  expect(rememberView({}, '', 'All')).toEqual({});
  expect(rememberView({}, 'A.base', '')).toEqual({});
 });
 it.each([null, 5, 'x', [], [['A.base', 'All']]])('repairs malformed data %j', (raw) => expect(normalizeLastViews(raw)).toEqual({}));
 it('drops corrupt entries and trims old data', () => {
  const raw = Object.fromEntries([...Array.from({ length: 250 }, (_, i) => [`B${i}.base`, 'All']), ['bad.base', 4], ['empty.base', '']]);
  const views = normalizeLastViews(raw);
  expect(Object.keys(views)).toHaveLength(REMEMBER_LIMIT);
  expect(views).not.toHaveProperty('bad.base');
  expect(views).toHaveProperty('B249.base', 'All');
  expect(views).not.toHaveProperty('B49.base');
 });
 it('moves the entry of a renamed base and keeps the age order', () => {
  const views = { 'A.base': 'All', 'B.base': 'Done' };
  expect(Object.entries(moveLastViews(views, 'A.base', 'C.base'))).toEqual([['C.base', 'All'], ['B.base', 'Done']]);
 });
 it('moves the entries of a renamed folder only', () => {
  const views = { 'Old/A.base': 'All', 'Older/B.base': 'Done', 'Old/Sub/C.base': 'Later' };
  expect(moveLastViews(views, 'Old', 'New')).toEqual({ 'New/A.base': 'All', 'Older/B.base': 'Done', 'New/Sub/C.base': 'Later' });
 });
 it('drops the entry of a deleted base or folder only', () => {
  const views = { 'Old/A.base': 'All', 'Older/B.base': 'Done', 'C.base': 'Later' };
  expect(dropLastViews(views, 'C.base')).toEqual({ 'Old/A.base': 'All', 'Older/B.base': 'Done' });
  expect(dropLastViews(views, 'Old')).toEqual({ 'Older/B.base': 'Done', 'C.base': 'Later' });
 });
 it('keeps the setting on by default and reads it from saved data', () => {
  expect(normalizeSettings({}).rememberView).toBe(true);
  expect(normalizeSettings({ rememberView: false }).rememberView).toBe(false);
  expect(normalizeSettings({ lastViews: { 'A.base': 'Done' } }).lastViews).toEqual({ 'A.base': 'Done' });
 });
});

describe('restore decision', () => {
 const base = { enabled: true, stored: 'Done', views: VIEWS };
 it('restores when the open names no view', () => expect(restoreTarget({ ...base, current: '' })).toBe('Done'));
 it('restores over the default first view', () => expect(restoreTarget({ ...base, current: 'All' })).toBe('Done'));
 it('does not override a view that a link or the user selected', () => expect(restoreTarget({ ...base, current: 'Later' })).toBeNull());
 it('does nothing when the stored view is already selected', () => expect(restoreTarget({ ...base, stored: 'All', current: '' })).toBeNull());
 it('does nothing when the setting is off', () => expect(restoreTarget({ ...base, enabled: false, current: 'All' })).toBeNull());
 it('does nothing without a stored view', () => expect(restoreTarget({ ...base, stored: undefined, current: 'All' })).toBeNull());
 it('does nothing when the stored view was removed from the base', () => expect(restoreTarget({ ...base, stored: 'Gone', current: 'All' })).toBeNull());
 it('does nothing for a base with no readable views', () => expect(restoreTarget({ ...base, views: [], current: '' })).toBeNull());
});

describe('plugin restore and record', () => {
 const TEXT = 'views: [{name: All, type: table}, {name: Done, type: table}, {name: Later, type: cards}]';
 function setup(viewName: string, lastViews: Record<string, string> = { 'A.base': 'Done' }) {
  const app = App.createConfigured__({ files: { 'A.base': TEXT } });
  const p = new BasesViewTabsPlugin(app as never, manifest as never);
  p.settings = { ...normalizeSettings({}), lastViews: { ...lastViews } };
  const save = vi.spyOn(p, 'saveSettings').mockResolvedValue();
  const view = Object.assign(Object.create(FileView.prototype), { containerEl: document.createElement('div'), file: app.vault.getAbstractFileByPath('A.base') });
  let state = { type: 'bases', state: { file: 'A.base', viewName, other: 1 } };
  const setViewState = vi.fn(async (next: typeof state) => { state = next; });
  const leaf = { view, isDeferred: false, getViewState: () => state, setViewState };
  vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([leaf] as never);
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  // The restore step waits OPEN_SETTLE_MS (150 ms) after a new open.
  const settle = async () => { await new Promise((r) => setTimeout(r, 200)); await flush(); };
  return {
   p, app, leaf, save, setViewState, settle, flush,
   setView: (name: string) => { state = { ...state, state: { ...state.state, viewName: name } }; },
   setFile: (path: string) => { state = { ...state, state: { ...state.state, file: path } }; },
  };
 }
 const start = (p: BasesViewTabsPlugin) => (p as unknown as { start(): void }).start();
 it('restores the stored view on a new open with the default view', async () => {
  const { p, setViewState, settle } = setup('All');
  p.trackOpens(); await settle();
  expect(setViewState).toHaveBeenCalledTimes(1);
  expect(setViewState.mock.calls[0]?.[0]).toEqual({ type: 'bases', state: { file: 'A.base', viewName: 'Done', other: 1 } });
 });
 it('does not override a link or explicit view in the same open', async () => {
  const { p, setViewState, settle, save } = setup('Later');
  p.trackOpens(); await settle(); p.trackOpens();
  expect(setViewState).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
 });
 it('keeps a link view that arrives just after the open, and does not store it', async () => {
  const { p, setViewState, settle, flush, setView, save } = setup('All');
  p.trackOpens(); await flush();
  setView('Later'); p.trackOpens(); await settle(); p.trackOpens();
  expect(setViewState).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(p.settings.lastViews).toEqual({ 'A.base': 'Done' });
 });
 it('restores one time per open, not on each scan', async () => {
  const { p, setViewState, settle, setView } = setup('All');
  p.trackOpens(); await settle();
  setView('All'); p.trackOpens(); await settle();
  expect(setViewState).toHaveBeenCalledTimes(1);
 });
 it('records a view change after the open and saves it', async () => {
  const { p, settle, setView, save } = setup('All', {});
  p.trackOpens(); await settle();
  setView('Later'); p.trackOpens();
  expect(p.settings.lastViews).toEqual({ 'A.base': 'Later' });
  expect(save).toHaveBeenCalledTimes(1);
 });
 it('does not restore or record when the setting is off', async () => {
  const { p, setViewState, settle, setView, save } = setup('All');
  p.settings.rememberView = false;
  p.trackOpens(); await settle();
  setView('Later'); p.trackOpens();
  expect(setViewState).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(p.settings.lastViews).toEqual({ 'A.base': 'Done' });
 });
 it('keeps the saved view of leaves from the saved layout', async () => {
  const { p, setViewState, settle } = setup('All');
  (p as unknown as { start(): void }).start(); await settle(); p.trackOpens(); await settle();
  expect(setViewState).not.toHaveBeenCalled();
  p.onunload();
 });
 it('does not record the default view while a restore runs', async () => {
  const { p, settle } = setup('All');
  p.trackOpens(); p.trackOpens(); await settle(); p.trackOpens();
  expect(p.settings.lastViews).toEqual({ 'A.base': 'Done' });
 });
 it('waits until a background tab has loaded before the restore', async () => {
  const { p, leaf, setViewState, settle } = setup('All');
  leaf.isDeferred = true;
  p.trackOpens(); await settle();
  expect(setViewState).not.toHaveBeenCalled();
  leaf.isDeferred = false;
  p.trackOpens(); await settle();
  expect(setViewState).toHaveBeenCalledTimes(1);
 });
 it('treats a rename of an open base as the same open and moves its stored view', async () => {
  const { p, app, setFile, setViewState, settle, save } = setup('All');
  start(p); await settle();
  await app.vault.rename(app.vault.getAbstractFileByPath('A.base')!, 'B.base');
  setFile('B.base'); p.trackOpens(); await settle();
  expect(setViewState).not.toHaveBeenCalled();
  expect(p.settings.lastViews).toEqual({ 'B.base': 'Done' });
  expect(save).toHaveBeenCalled();
  p.onunload();
 });
 it('saves the store after the delete of a remembered base', async () => {
  const { p, app, save, settle } = setup('All');
  start(p); await settle();
  save.mockClear();
  await app.vault.delete(app.vault.getAbstractFileByPath('A.base')!);
  expect(p.settings.lastViews).toEqual({});
  expect(save).toHaveBeenCalledTimes(1);
  p.onunload();
 });
 it('does not restore after unload', async () => {
  const { p, setViewState, settle } = setup('All');
  p.onunload(); p.trackOpens(); await settle();
  expect(setViewState).not.toHaveBeenCalled();
 });
});
