/**
 * Unit tests for config/siteDetector.js
 *
 * Covers: SiteDetector class — normalizeDomain, isDomainMatch,
 *         updateAverageResponseTime, adjustCacheTimeout, clearCache,
 *         getCacheStatus, getPerformanceStats.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal environment shims ---
global.performance = { now: () => Date.now() };
global.chrome = {
  storage: {
    local: { get: async () => ({}) },
    onChanged: { addListener: () => {} }
  }
};
global.self = global;

// Load the module — it exports via module.exports at the bottom
const { SiteDetector } = require('../config/siteDetector.js');

describe('SiteDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new SiteDetector();
  });

  describe('normalizeDomain', () => {
    it('removes www. prefix', () => {
      assert.equal(detector.normalizeDomain('www.google.com'), 'google.com');
    });

    it('converts to lowercase', () => {
      assert.equal(detector.normalizeDomain('Google.COM'), 'google.com');
    });

    it('handles www. + mixed case (lowercase www. is stripped first)', () => {
      // www. removal only triggers on lowercase 'www.' prefix
      assert.equal(detector.normalizeDomain('www.ChatGPT.com'), 'chatgpt.com');
      // uppercase WWW. is NOT stripped (becomes www.chatgpt.com after toLower)
      assert.equal(detector.normalizeDomain('WWW.ChatGPT.com'), 'www.chatgpt.com');
    });

    it('returns empty string for falsy input', () => {
      assert.equal(detector.normalizeDomain(''), '');
      assert.equal(detector.normalizeDomain(null), '');
      assert.equal(detector.normalizeDomain(undefined), '');
    });

    it('leaves domains without www. intact (aside from lowercase)', () => {
      assert.equal(detector.normalizeDomain('chat.openai.com'), 'chat.openai.com');
    });
  });

  describe('isDomainMatch', () => {
    it('exact match returns type "exact"', () => {
      const result = detector.isDomainMatch('google.com', 'google.com');
      assert.equal(result.match, true);
      assert.equal(result.type, 'exact');
    });

    it('exact match ignores www. prefix', () => {
      const result = detector.isDomainMatch('www.google.com', 'google.com');
      assert.equal(result.match, true);
      assert.equal(result.type, 'exact');
    });

    it('exact match is case-insensitive', () => {
      const result = detector.isDomainMatch('Google.COM', 'google.com');
      assert.equal(result.match, true);
      assert.equal(result.type, 'exact');
    });

    it('contains match returns type "contains"', () => {
      const result = detector.isDomainMatch('chat.deepseek.com', 'deepseek.com');
      assert.equal(result.match, true);
      assert.equal(result.type, 'contains');
    });

    it('does not match short target domains (<=3 chars) via contains', () => {
      const result = detector.isDomainMatch('example.com', 'com');
      assert.equal(result.match, false);
      assert.equal(result.type, 'none');
    });

    it('returns no match for unrelated domains', () => {
      const result = detector.isDomainMatch('google.com', 'bing.com');
      assert.equal(result.match, false);
      assert.equal(result.type, 'none');
    });
  });

  describe('updateAverageResponseTime', () => {
    it('sets average to first response time when totalRequests is 1', () => {
      detector.performanceStats.totalRequests = 1;
      detector.updateAverageResponseTime(50);
      assert.equal(detector.performanceStats.averageResponseTime, 50);
    });

    it('calculates running average correctly', () => {
      detector.performanceStats.totalRequests = 1;
      detector.updateAverageResponseTime(100);

      detector.performanceStats.totalRequests = 2;
      detector.updateAverageResponseTime(200);
      // (100 * 1 + 200) / 2 = 150
      assert.equal(detector.performanceStats.averageResponseTime, 150);
    });
  });

  describe('adjustCacheTimeout', () => {
    it('increases cache timeout when hit rate > 80%', () => {
      detector.performanceStats.cacheHits = 9;
      detector.performanceStats.totalRequests = 10;
      const original = detector.adaptiveCacheTimeout;
      detector.adjustCacheTimeout();
      assert.ok(detector.adaptiveCacheTimeout > original);
    });

    it('caps increased timeout at 30 minutes', () => {
      detector.performanceStats.cacheHits = 9;
      detector.performanceStats.totalRequests = 10;
      detector.adaptiveCacheTimeout = 25 * 60 * 1000;
      detector.adjustCacheTimeout();
      assert.ok(detector.adaptiveCacheTimeout <= 30 * 60 * 1000);
    });

    it('decreases cache timeout when hit rate < 30%', () => {
      detector.performanceStats.cacheHits = 1;
      detector.performanceStats.totalRequests = 10;
      const original = detector.adaptiveCacheTimeout;
      detector.adjustCacheTimeout();
      assert.ok(detector.adaptiveCacheTimeout < original);
    });

    it('does not go below 1 minute', () => {
      detector.performanceStats.cacheHits = 1;
      detector.performanceStats.totalRequests = 10;
      detector.adaptiveCacheTimeout = 1.5 * 60 * 1000;
      detector.adjustCacheTimeout();
      assert.ok(detector.adaptiveCacheTimeout >= 60 * 1000);
    });
  });

  describe('clearCache', () => {
    it('resets all cache state', () => {
      detector.sitesCache = [{ name: 'test' }];
      detector.domainMappingsCache = { 'test.com': 'Test' };
      detector.cacheTimestamp = 12345;
      detector.lastUpdateTime = 12345;
      detector.adaptiveCacheTimeout = 999;

      detector.clearCache();

      assert.equal(detector.sitesCache, null);
      assert.equal(detector.domainMappingsCache, null);
      assert.equal(detector.cacheTimestamp, 0);
      assert.equal(detector.lastUpdateTime, 0);
      assert.equal(detector.adaptiveCacheTimeout, detector.cacheTimeout);
    });
  });

  describe('getCacheStatus', () => {
    it('reports no cache when sitesCache is null', () => {
      const status = detector.getCacheStatus();
      assert.equal(status.hasCache, false);
    });

    it('reports cache present when sitesCache exists', () => {
      detector.sitesCache = [{ name: 'test' }];
      detector.cacheTimestamp = Date.now();
      const status = detector.getCacheStatus();
      assert.equal(status.hasCache, true);
      assert.equal(status.isExpired, false);
    });

    it('detects expired cache', () => {
      detector.sitesCache = [{ name: 'test' }];
      detector.cacheTimestamp = Date.now() - 10 * 60 * 1000; // 10 min ago
      const status = detector.getCacheStatus();
      assert.equal(status.isExpired, true);
    });
  });

  describe('getPerformanceStats', () => {
    it('calculates cache hit rate', () => {
      detector.performanceStats.cacheHits = 8;
      detector.performanceStats.totalRequests = 10;
      const stats = detector.getPerformanceStats();
      assert.equal(stats.cacheHitRate, '80.00%');
    });

    it('returns 0% when no requests', () => {
      const stats = detector.getPerformanceStats();
      assert.equal(stats.cacheHitRate, '0%');
    });
  });

  describe('resetPerformanceStats', () => {
    it('zeroes all counters', () => {
      detector.performanceStats.cacheHits = 5;
      detector.performanceStats.totalRequests = 10;
      detector.resetPerformanceStats();
      assert.equal(detector.performanceStats.cacheHits, 0);
      assert.equal(detector.performanceStats.totalRequests, 0);
      assert.equal(detector.performanceStats.averageResponseTime, 0);
    });
  });
});
