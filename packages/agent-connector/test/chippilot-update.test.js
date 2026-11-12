'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareForkVersions } = require('../src/update-check');
test('fork updates compare the distribution revision rather than the official core version only', () => {
  assert.equal(compareForkVersions('0.2.226-chippilot.10', '0.2.226-chippilot.2'), 1);
  assert.equal(compareForkVersions('0.2.226-chippilot.1', '0.2.226-chippilot.2'), -1);
  assert.equal(compareForkVersions('0.2.227-chippilot.1', '0.2.226-chippilot.10'), 1);
  assert.equal(compareForkVersions('0.2.226-chippilot.2', '0.2.226-chippilot.2'), 0);
  assert.throws(() => compareForkVersions('0.2.227', '0.2.226-chippilot.2'));
});
