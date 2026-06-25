/**
 * Unit tests for lib/messaging.js
 *
 * Covers: safePostMessage, isFromExtension, getExtensionOrigin,
 *         invalidateAIOriginsCache.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Setup environment to simulate extension page ---
function setupExtensionEnv() {
  global.location = { origin: 'chrome-extension://abcdef123456' };
  global.window = global;
  global.self = global;

  // Reset MessagingSecurity by re-loading the module
  delete require.cache[require.resolve('../lib/messaging.js')];
  require('../lib/messaging.js');
}

function setupThirdPartyEnv() {
  global.location = { origin: 'https://chat.openai.com' };
  global.window = global;
  global.window.parent = { postMessage: () => {} };
  global.self = global;

  delete require.cache[require.resolve('../lib/messaging.js')];
  require('../lib/messaging.js');
}

describe('MessagingSecurity (extension page context)', () => {
  beforeEach(() => {
    setupExtensionEnv();
  });

  describe('getExtensionOrigin', () => {
    it('returns the chrome-extension origin', () => {
      const origin = global.MessagingSecurity.getExtensionOrigin();
      assert.equal(origin, 'chrome-extension://abcdef123456');
    });
  });

  describe('isFromExtension', () => {
    it('returns true for events from extension origin', () => {
      const event = { origin: 'chrome-extension://abcdef123456', source: {} };
      assert.equal(global.MessagingSecurity.isFromExtension(event), true);
    });

    it('returns false for events from other origins', () => {
      const event = { origin: 'https://evil.com', source: {} };
      assert.equal(global.MessagingSecurity.isFromExtension(event), false);
    });

    it('returns false for null event', () => {
      assert.equal(global.MessagingSecurity.isFromExtension(null), false);
    });

    it('returns false for event without origin string', () => {
      assert.equal(global.MessagingSecurity.isFromExtension({ origin: 123 }), false);
    });
  });

  describe('safePostMessage', () => {
    it('sends message when targetOrigin is provided', () => {
      let sentOrigin = null;
      let sentMessage = null;
      const targetWindow = {
        postMessage: (msg, origin) => { sentMessage = msg; sentOrigin = origin; }
      };
      const result = global.MessagingSecurity.safePostMessage(
        targetWindow, { type: 'TEST' }, 'https://chat.openai.com'
      );
      assert.equal(result, true);
      assert.deepEqual(sentMessage, { type: 'TEST' });
      assert.equal(sentOrigin, 'https://chat.openai.com');
    });

    it('infers origin from same-origin target window', () => {
      let sentOrigin = null;
      const targetWindow = {
        location: { origin: 'chrome-extension://abcdef123456' },
        postMessage: (msg, origin) => { sentOrigin = origin; }
      };
      const result = global.MessagingSecurity.safePostMessage(targetWindow, { type: 'TEST' });
      assert.equal(result, true);
      assert.equal(sentOrigin, 'chrome-extension://abcdef123456');
    });

    it('refuses to send when origin cannot be determined', () => {
      const targetWindow = {
        get location() { throw new Error('cross-origin'); },
        postMessage: () => {}
      };
      const result = global.MessagingSecurity.safePostMessage(targetWindow, { type: 'TEST' });
      assert.equal(result, false);
    });

    it('returns false for null target window', () => {
      const result = global.MessagingSecurity.safePostMessage(null, { type: 'TEST' });
      assert.equal(result, false);
    });

    it('returns false for target without postMessage', () => {
      const result = global.MessagingSecurity.safePostMessage({}, { type: 'TEST' });
      assert.equal(result, false);
    });
  });

  describe('invalidateAIOriginsCache', () => {
    it('does not throw when called', () => {
      assert.doesNotThrow(() => {
        global.MessagingSecurity.invalidateAIOriginsCache();
      });
    });
  });

  describe('isTrustedMessage', () => {
    it('trusts messages from extension origin', async () => {
      const event = { origin: 'chrome-extension://abcdef123456', source: {} };
      const result = await global.MessagingSecurity.isTrustedMessage(event);
      assert.equal(result, true);
    });

    it('rejects messages from unknown origin', async () => {
      const event = { origin: 'https://evil.com', source: {} };
      const result = await global.MessagingSecurity.isTrustedMessage(event);
      assert.equal(result, false);
    });

    it('rejects null event', async () => {
      const result = await global.MessagingSecurity.isTrustedMessage(null);
      assert.equal(result, false);
    });

    it('respects expectedSource option', async () => {
      const source = {};
      const wrongSource = {};
      const event = { origin: 'chrome-extension://abcdef123456', source: wrongSource };
      const result = await global.MessagingSecurity.isTrustedMessage(event, { expectedSource: source });
      assert.equal(result, false);
    });

    it('trusts additionalTrustedOrigins', async () => {
      const event = { origin: 'https://custom-redirect.com', source: {} };
      const result = await global.MessagingSecurity.isTrustedMessage(event, {
        additionalTrustedOrigins: ['https://custom-redirect.com']
      });
      assert.equal(result, true);
    });
  });
});

describe('MessagingSecurity (third-party page context)', () => {
  beforeEach(() => {
    setupThirdPartyEnv();
  });

  describe('isFromExtension (inject.js scenario)', () => {
    it('trusts parent window with chrome-extension origin', () => {
      const event = {
        origin: 'chrome-extension://someid',
        source: global.window.parent
      };
      const result = global.MessagingSecurity.isFromExtension(event);
      assert.equal(result, true);
    });

    it('rejects parent window with non-extension origin', () => {
      const event = {
        origin: 'https://evil.com',
        source: global.window.parent
      };
      const result = global.MessagingSecurity.isFromExtension(event);
      assert.equal(result, false);
    });
  });
});
