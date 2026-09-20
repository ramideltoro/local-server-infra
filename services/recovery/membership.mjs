import assert from 'node:assert/strict';
// Check identities, not a historical fleet size. Missing, duplicate or retired
// systems must fail even when the number of restored records happens to match.
export function recoveryMembership(config, inventory, restoredHealth) {
  const retired = new Set(inventory.retired.map(s => s.id));
  const expected = [...inventory.servers.filter(s => s.id !== 'external'), ...inventory.applications].map(s => s.id).sort();
  assert(expected.length > 0, 'Archived inventory must not be empty');
  assert.equal(new Set(expected).size, expected.length, 'Duplicate archived identity');
  assert(!expected.some(id => retired.has(id)), 'Retired identity in active inventory');
  const configured = config.systems.map(s => s.id).sort();
  assert.deepEqual(configured, expected, 'Operational configuration must match archived inventory');
  if (restoredHealth) assert.deepEqual(restoredHealth.systems.map(s => s.id).sort(), expected, 'Restored application must return every archived active identity');
  return expected;
}
