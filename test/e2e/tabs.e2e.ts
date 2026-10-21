import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

describe('saved Base view tabs', function () {
 it('switches the core view and rows without changing Base text', async function () {
  await obsidianPage.openFile('Bases View Tabs/Tasks.base');
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bvt-tab').length === 3, {timeout:15000});
  const before = await browser.executeObsidian(async ({app}) => app.vault.cachedRead(app.vault.getFileByPath('Bases View Tabs/Tasks.base')!));
  const buttons = await browser.$$('.workspace-leaf.mod-active .bvt-tab');
  await buttons[1]!.click();
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .bvt-tab[aria-selected="true"]').getText()) === 'In progress', {timeout:10000});
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bases-tbody .bases-tr').length === 2, {timeout:10000});
  const after = await browser.executeObsidian(async ({app}) => app.vault.cachedRead(app.vault.getFileByPath('Bases View Tabs/Tasks.base')!));
  expect(after).toBe(before);
 });
 it('follows the native view menu and connects tabs to the view panel', async function () {
  const menu = await browser.$('.workspace-leaf.mod-active .bases-toolbar-views-menu');
  await menu.click();
  const option = await browser.$('//*[normalize-space(text())="All tasks" and not(ancestor::*[contains(@class,"bvt-strip")])]');
  await option.waitForDisplayed({timeout:5000});
  await option.click();
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .bvt-tab[aria-selected="true"]').getText()) === 'All tasks', {timeout:10000});
  expect(await browser.execute(() => {
   const tab = document.querySelector('.workspace-leaf.mod-active .bvt-tab[aria-selected="true"]');
   const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
   return panel?.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab?.id;
  })).toBe(true);
 });
 it('focuses tabs from the command and changes focus with End', async function () {
  await browser.executeObsidianCommand('bases-view-tabs:focus-view-tabs');
  await browser.keys(['End']);
  expect(await browser.execute(() => (document.activeElement as HTMLElement).dataset.view)).toBe('Done');
  await browser.keys(['Enter']);
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .bvt-tab[aria-selected="true"]').getText()) === 'Done', {timeout:10000});
 });
});

describe('Base tab lifecycle', function () {
 it('removes controls after navigating away and restores them when returning', async function () {
  await obsidianPage.openFile('Bases View Tabs/Tasks.base');
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bvt-tab').length === 3, {timeout:15000});
  await obsidianPage.openFile('Bases View Tabs/Welcome.md');
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bvt-strip').length === 0, {timeout:10000});
  await obsidianPage.openFile('Bases View Tabs/Tasks.base');
  await browser.waitUntil(async () => await browser.$$('.workspace-leaf.mod-active .bvt-tab').length === 3, {timeout:15000});
 });
});
