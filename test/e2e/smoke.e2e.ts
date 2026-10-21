import { expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
describe(`${pluginId} smoke test`, function () {
 it('is enabled and reloads with no errors', async function () {
  expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]});
 });
});
