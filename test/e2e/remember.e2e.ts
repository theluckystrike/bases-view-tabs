// "Remember the last view" (1.3.0) in a real Obsidian: restore, link, Back, restart, rename, delete, setting off, errors.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

const BASE = 'Bases View Tabs/Tasks.base';
const COPY = 'Bases View Tabs/Copy.base';
const RENAMED = 'Bases View Tabs/Renamed.base';

/** The selected tab of the most recent base leaf (strip text), or '' when no base leaf has a strip. */
async function selectedView(): Promise<string> {
 return browser.executeObsidian(({ app }) => {
  const leaves = app.workspace.getLeavesOfType('bases');
  const recent = app.workspace.getMostRecentLeaf();
  const leaf = leaves.find((l) => l === recent) ?? leaves[leaves.length - 1];
  return leaf?.view.containerEl.closest('.workspace-leaf')?.querySelector('.bvt-tab[aria-selected="true"]')?.textContent ?? '';
 });
}
async function waitView(name: string): Promise<void> {
 await browser.waitUntil(async () => (await selectedView()) === name, { timeout: 15000, timeoutMsg: `expected view "${name}", got "${await selectedView()}"` });
}
async function lastViews(): Promise<Record<string, string>> {
 return browser.executeObsidian(({ app }, id) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { lastViews: Record<string, string> } }> } }).plugins.plugins[id]!;
  return { ...p.settings.lastViews };
 }, pluginId);
}
async function closeBases(): Promise<void> {
 await browser.executeObsidian(({ app }) => { for (const leaf of app.workspace.getLeavesOfType('bases')) leaf.detach(); });
}
async function setRemember(on: boolean): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, value) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { rememberView: boolean }; saveSettings(): Promise<void> }> } }).plugins.plugins[id]!;
  p.settings.rememberView = value;
  await p.saveSettings();
 }, pluginId, on);
}
async function watchErrors(): Promise<void> {
 await browser.execute(() => {
  const w = window as unknown as { __bvtErrors?: string[] };
  if (w.__bvtErrors) return;
  const errors: string[] = (w.__bvtErrors = []);
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); original(...args); };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
 });
}
async function errors(): Promise<string[]> {
 return browser.execute(() => (window as unknown as { __bvtErrors?: string[] }).__bvtErrors ?? []);
}
async function clickTab(name: string): Promise<void> {
 const tabs = await browser.$$('.workspace-leaf.mod-active .bvt-tab');
 for (const tab of tabs) if ((await tab.getText()) === name) { await tab.click(); break; }
 await waitView(name);
}
async function settle(): Promise<void> { await browser.pause(800); }

describe('Remember the last view', function () {
 before(async function () { await watchErrors(); await setRemember(true); });

 it('1 reopens a closed base in the view selected last', async function () {
  await obsidianPage.openFile(BASE);
  await waitView('All tasks');
  await settle();
  await clickTab('Done');
  await settle();
  expect((await lastViews())[BASE]).toBe('Done');
  await closeBases();
  await obsidianPage.openFile(BASE);
  await waitView('Done');
  await settle();
  expect(await selectedView()).toBe('Done');
 });

 it('2 a link to another view opens that view and does not change the store', async function () {
  await closeBases();
  await browser.executeObsidian(async ({ app }, path) => { await app.workspace.openLinkText(`${path}#In progress`, '', true); }, BASE);
  await waitView('In progress');
  await settle();
  expect(await selectedView()).toBe('In progress');
  expect((await lastViews())[BASE]).toBe('Done');
 });

 it('6 Back after a restore does not show the first view', async function () {
  await closeBases();
  const back = await browser.executeObsidian(async ({ app }, path) => {
   const leaf = app.workspace.getLeaf('tab');
   app.workspace.setActiveLeaf(leaf, { focus: true });
   await leaf.openFile(app.vault.getFileByPath('Bases View Tabs/Welcome.md')!);
   await leaf.openFile(app.vault.getFileByPath(path)!);
   await new Promise((r) => setTimeout(r, 2500));
   const before = String((leaf.getViewState().state as { viewName?: string }).viewName ?? '');
   const steps = ((leaf as unknown as { history?: { backHistory: unknown[] } }).history?.backHistory ?? []).length;
   app.workspace.setActiveLeaf(leaf, { focus: true });
   (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('app:go-back');
   await new Promise((r) => setTimeout(r, 1500));
   const st = leaf.getViewState();
   return { before, steps, type: st.type, file: String((st.state as { file?: string }).file ?? '') };
  }, BASE);
  console.log(`BACK ${JSON.stringify(back)}`);
  expect(back.before).toBe('Done');
  expect(back.steps).toBe(1);
  expect(back.file).toBe('Bases View Tabs/Welcome.md');
 });

 it('3 after a restart a saved-layout pane keeps its view, and a background tab keeps its view', async function () {
  // Links name views 2 and 3 only: a link to view 1 looks like a plain open (known limit, src/remember.ts).
  await closeBases();
  await obsidianPage.openFile(BASE);
  await waitView((await lastViews())[BASE]!);
  await settle();
  await clickTab('All tasks');
  await settle();
  expect((await lastViews())[BASE]).toBe('All tasks');
  await closeBases();
  await browser.executeObsidian(async ({ app }, path) => {
   type Linker = { openLinkText(link: string, source: string): Promise<void> };
   const bg = app.workspace.getLeaf('tab') as unknown as Linker;
   await bg.openLinkText(`${path}#Done`, '');
   const fg = app.workspace.getLeaf('tab');
   await (fg as unknown as Linker).openLinkText(`${path}#In progress`, '');
   app.workspace.setActiveLeaf(fg, { focus: true });
  }, BASE);
  await waitView('In progress');
  await settle();
  expect(await browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('bases').map((l) => String((l.getViewState().state as { viewName?: string }).viewName)))).toEqual(['Done', 'In progress']);
  expect((await lastViews())[BASE]).toBe('All tasks');
  await browser.executeObsidian(async ({ app }) => { await (app.workspace as unknown as { saveLayout(): Promise<void> }).saveLayout(); });
  await browser.reloadObsidian();
  await watchErrors();
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bvt-tab').length === 3, { timeout: 30000 });
  await settle();
  expect(await selectedView()).toBe('In progress');
  const views = await browser.executeObsidian(async ({ app }) => {
   const out: string[] = [];
   for (const leaf of app.workspace.getLeavesOfType('bases')) {
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await (leaf as unknown as { loadIfDeferred?(): Promise<void> }).loadIfDeferred?.();
    await new Promise((r) => setTimeout(r, 1500));
    out.push(String((leaf.getViewState().state as { viewName?: string }).viewName ?? ''));
   }
   return out;
  });
  expect(views).toEqual(['Done', 'In progress']);
  console.log(`RESTART-STORE ${JSON.stringify(await lastViews())}`);
 });

 it('4 rename and delete of a base update the store', async function () {
  await closeBases();
  const baseBefore = (await lastViews())[BASE];
  await browser.executeObsidian(async ({ app }, from, to) => {
   const text = await app.vault.cachedRead(app.vault.getFileByPath(from)!);
   if (!app.vault.getFileByPath(to)) await app.vault.create(to, text);
  }, BASE, COPY);
  await obsidianPage.openFile(COPY);
  await waitView('All tasks');
  await settle();
  await clickTab('In progress');
  await settle();
  expect((await lastViews())[COPY]).toBe('In progress');
  await closeBases();
  await browser.executeObsidian(async ({ app }, from, to) => { await app.fileManager.renameFile(app.vault.getFileByPath(from)!, to); }, COPY, RENAMED);
  await settle();
  let store = await lastViews();
  expect(store[COPY]).toBeUndefined();
  expect(store[RENAMED]).toBe('In progress');
  await obsidianPage.openFile(RENAMED);
  await waitView('In progress');
  await closeBases();
  await browser.executeObsidian(async ({ app }, path) => { await app.vault.delete(app.vault.getFileByPath(path)!); }, RENAMED);
  await settle();
  store = await lastViews();
  expect(store[RENAMED]).toBeUndefined();
  expect(store[BASE]).toBe(baseBefore);
  const disk = await browser.executeObsidian(async ({ app }, id) => JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/${id}/data.json`)) as { lastViews: Record<string, string> }, pluginId);
  expect(disk.lastViews).toEqual(store);
 });

 it('5 with the setting off a reopen shows the first view', async function () {
  await setRemember(false);
  await closeBases();
  await obsidianPage.openFile(BASE);
  await waitView('All tasks');
  await settle();
  await settle();
  expect(await selectedView()).toBe('All tasks');
  await setRemember(true);
  const stored = (await lastViews())[BASE]!;
  await closeBases();
  await obsidianPage.openFile(BASE);
  await waitView(stored);
 });

 it('7 logs no errors', async function () {
  expect(await errors()).toEqual([]);
 });
});
