import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-view-tabs.json';
import { tabModel, readViews, keyTarget, normalizeSettings, preferenceKey, movePreferences, planTabs } from '../src/model';

describe('acceptance vectors', () => {
 for (const c of vectors.cases) it(c.name, () => {
  const [text, active, raw, path, pro] = c.args as [string, string?, unknown?, string?, boolean?];
  expect(tabModel(text, active, raw, path, pro)).toEqual(c.expected);
 });
});

describe('safe Base parsing', () => {
 it.each(['', 'null', '42', '[]', 'views: null', 'views: {}', 'views: []', 'views: [null, 4, {}]', 'views: [{name: "", type: table}]', 'views: [{name: All, type: 4}]', 'views: [{name: All}]', 'views: [{name: 5, type: table}]'])('has no phantom tab for %s', (text) => expect(readViews(text)).toEqual([]));
 it('preserves whitespace and Unicode in names', () => expect(readViews('views: [{name: "  日本語  ", type: table}]')[0]?.name).toBe('  日本語  '));
 it('keeps the original text and view options untouched', () => {
  const text = '# comment\nfilters: status != "done"\nviews: [{name: All, type: table, order: [file.name]}]\n';
  tabModel(text); expect(text).toContain('# comment\nfilters: status != "done"');
 });
 it('handles a legal YAML alias', () => expect(readViews('label: &n All\nviews: [{name: *n, type: table}]')).toEqual([{ name: 'All', type: 'table' }]));
});

describe('keyboard navigation', () => {
 it.each([
  ['ArrowRight', 0, 3, false, 1], ['ArrowRight', 2, 3, false, 0],
  ['ArrowLeft', 0, 3, false, 2], ['ArrowLeft', 1, 3, false, 0],
  ['Home', 2, 3, false, 0], ['End', 0, 3, false, 2],
  ['ArrowRight', 0, 3, true, 2], ['ArrowLeft', 2, 3, true, 0],
  ['Tab', 0, 3, false, null], ['Enter', 0, 3, false, null],
  ['ArrowDown', 0, 3, false, null], ['Home', 0, 0, false, null],
  ['ArrowRight', 0, 1, false, 0],
 ] as const)('%s at %s of %s (RTL %s)', (key, at, size, rtl, expected) => expect(keyTarget(key, at, size, rtl)).toBe(expected));
});

describe('appearance persistence', () => {
 it.each([null, undefined, 5, [], {wrap: 'true'}, {appearances: []}])('repairs malformed settings %j', (raw) => expect(normalizeSettings(raw)).toEqual({wrap: false, appearances: {}}));
 it('keeps valid wrap and sanitizes individual entries', () => {
  const key = preferenceKey('A.base', 'All');
  expect(normalizeSettings({wrap: true, appearances: {bad: {}, '[1,2]': {}, [key]: {pinned: 'yes', icon: 'script'}}})).toEqual({wrap: true, appearances: {[key]: {pinned: false, icon: ''}}});
 });
 it('separates paths and names that contain slashes', () => expect(preferenceKey('A/base', 'C')).not.toBe(preferenceKey('A', 'base/C')));
 it('moves preferences with a folder and leaves other paths intact', () => {
  const style = {pinned: true, icon: 'star'};
  const settings = {wrap: true, appearances: {[preferenceKey('Old/A.base', 'All')]: style, [preferenceKey('Older/B.base', 'All')]: style}};
  expect(movePreferences(settings, 'Old', 'New').appearances).toEqual({[preferenceKey('New/A.base', 'All')]: style, [preferenceKey('Older/B.base', 'All')]: style});
  expect(settings.appearances).toHaveProperty(preferenceKey('Old/A.base', 'All'));
 });
 it('moves a single base preference', () => {
  const style = {pinned: true, icon: ''};
  expect(movePreferences({wrap: false, appearances: {[preferenceKey('A.base', 'All')]: style}}, 'A.base', 'B.base').appearances).toEqual({[preferenceKey('B.base', 'All')]: style});
 });
 it('keeps the order of multiple pins and never mutates view input', () => {
  const views = [{name: 'A',type:'table'},{name:'B',type:'cards'},{name:'C',type:'table'}];
  const appearances = Object.fromEntries(['B','C'].map((n) => [preferenceKey('X', n), {pinned: true, icon: ''}]));
  expect(planTabs(views, 'A', appearances, 'X', true).map(t => t.name)).toEqual(['B','C','A']);
  expect(views.map(v => v.name)).toEqual(['A','B','C']);
 });
});
