/**
 * Unit tests for config/baseConfig.js
 *
 * Covers: compareVersions() — the pure version comparison utility.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal browser/extension environment shims ---
global.self = global;
global.window = global;
global.navigator = { language: 'en-US' };
global.chrome = {
  runtime: { getURL: (p) => `chrome-extension://fakeid/${p}` },
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    sync: { get: async () => ({}) },
    onChanged: { addListener: () => {} }
  }
};
global.fetch = async () => ({ ok: false });
global.console = console;

// Load the module (it attaches compareVersions via the else-block to window)
require('../config/baseConfig.js');

// compareVersions is available on the global scope after loading
const { compareVersions } = (() => {
  // It was defined as a plain function inside the else block.
  // Since we are in the window branch, it is not explicitly exported,
  // but we can extract it from the source by re-evaluating just that function.
  // Actually, let's extract it directly from the file via a helper module.
  return { compareVersions: global.compareVersions || eval(extractCompareVersions()) };
})();

function extractCompareVersions() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'config', 'baseConfig.js'), 'utf8');
  // The function starts at "function compareVersions" and ends before "// 远程配置更新功能"
  const startMarker = 'function compareVersions(version1, version2)';
  const startIdx = src.indexOf(startMarker);
  // Find the closing brace by counting braces
  let braceCount = 0;
  let endIdx = startIdx;
  let started = false;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') { braceCount++; started = true; }
    if (src[i] === '}') { braceCount--; }
    if (started && braceCount === 0) { endIdx = i + 1; break; }
  }
  return src.slice(startIdx, endIdx);
}

// Since compareVersions is defined inside an if/else block and not exported,
// we extract and eval it for testing.
let compareVersionsFn;
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'config', 'baseConfig.js'), 'utf8');
  const startMarker = 'function compareVersions(version1, version2)';
  const startIdx = src.indexOf(startMarker);
  let braceCount = 0, endIdx = startIdx, started = false;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') { braceCount++; started = true; }
    if (src[i] === '}') { braceCount--; }
    if (started && braceCount === 0) { endIdx = i + 1; break; }
  }
  const fnSource = src.slice(startIdx, endIdx);
  compareVersionsFn = new Function('return ' + fnSource)();
}

describe('compareVersions', () => {
  it('returns 0 for identical string versions', () => {
    assert.equal(compareVersionsFn('1.2.3', '1.2.3'), 0);
  });

  it('returns 0 for identical numeric timestamps', () => {
    assert.equal(compareVersionsFn(1700000000, 1700000000), 0);
  });

  it('returns 1 when first numeric timestamp is greater', () => {
    assert.equal(compareVersionsFn(1700000001, 1700000000), 1);
  });

  it('returns -1 when first numeric timestamp is smaller', () => {
    assert.equal(compareVersionsFn(1700000000, 1700000001), -1);
  });

  it('compares simple semantic versions correctly', () => {
    assert.equal(compareVersionsFn('2.0.0', '1.0.0'), 1);
    assert.equal(compareVersionsFn('1.0.0', '2.0.0'), -1);
    assert.equal(compareVersionsFn('1.1.0', '1.0.0'), 1);
    assert.equal(compareVersionsFn('1.0.1', '1.0.0'), 1);
  });

  it('handles versions with different segment counts', () => {
    assert.equal(compareVersionsFn('1.0.0', '1.0'), 0);
    assert.equal(compareVersionsFn('1.0.1', '1.0'), 1);
    assert.equal(compareVersionsFn('1', '1.0.0'), 0);
  });

  it('handles v prefix', () => {
    assert.equal(compareVersionsFn('v1.2.3', '1.2.3'), 0);
    assert.equal(compareVersionsFn('v2.0.0', 'v1.9.9'), 1);
  });

  it('pre-release version is less than release version', () => {
    assert.equal(compareVersionsFn('1.0.0-beta', '1.0.0'), -1);
    assert.equal(compareVersionsFn('1.0.0', '1.0.0-alpha'), 1);
  });

  it('compares pre-release suffixes alphabetically', () => {
    assert.equal(compareVersionsFn('1.0.0-beta', '1.0.0-alpha'), 1);
    assert.equal(compareVersionsFn('1.0.0-alpha', '1.0.0-beta'), -1);
  });

  it('handles edge case of empty/zero versions', () => {
    assert.equal(compareVersionsFn('0.0.0', '0.0.0'), 0);
    assert.equal(compareVersionsFn('0.0.1', '0.0.0'), 1);
  });
});
