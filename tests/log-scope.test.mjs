import test from 'node:test';
import assert from 'node:assert/strict';
import { logSelector } from '../services/workspace/log-scope.mjs';
test('inspection uses real Loki host labels and preserves Raspberry project isolation', () => {
  assert.equal(logSelector('backend-vps', 'backend.nutsnews.com'), '{host="backend.nutsnews.com"}');
  assert.equal(logSelector('nutsnews-vps', 'vps.nutsnews.com'), '{host="vps.nutsnews.com"}');
  assert.equal(logSelector('local', 'chingadera'), '{instance="chingadera"}');
  assert.equal(logSelector('mookie', 'mookie'), '{instance="mookie"}');
  assert.equal(logSelector('raspberry', 'rpi4'), '{instance="rpi4",project="raspberry"}');
});
