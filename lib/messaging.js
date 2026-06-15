/**
 * 统一的消息安全工具
 *
 * 解决审查发现的安全问题：
 * - S1: postMessage 接收端无 origin 校验，任意网页可伪造消息
 * - S2: 出站 postMessage 使用 '*' 作为 targetOrigin
 *
 * 设计要点：
 * - 父页面 (iframe.html) 的消息只信任扩展自身 origin 与已加载的 AI 站点 origin
 * - inject.js 注入到第三方 AI 站点，其父页面就是扩展页面，只信任扩展 origin
 * - 发送消息时使用具体的 targetOrigin，避免 '*'
 *
 * 用法：
 *   接收端：  if (!isTrustedMessage(event)) return;
 *   发送端：  safePostMessage(targetWindow, msg, targetOrigin)
 */

(function (global) {
  'use strict';

  // 扩展自身 origin（chrome-extension://<id>），运行时确定一次
  let _extensionOrigin = null;
  function getExtensionOrigin() {
    if (_extensionOrigin) return _extensionOrigin;
    try {
      // 在扩展页面上下文中 location.origin 即为 chrome-extension://<id>
      if (typeof location !== 'undefined' && location.origin && location.origin.startsWith('chrome-extension://')) {
        _extensionOrigin = location.origin;
        return _extensionOrigin;
      }
    } catch (e) {}
    // inject.js 运行在第三方页面，自身 location.origin 是 AI 站点；
    // 此时其父页面（postMessage 的接收方）是扩展页面，无法直接拿到扩展 origin，
    // 由父页面侧校验即可。这里返回 null 表示"当前不在扩展页"。
    return null;
  }

  // AI 站点 origin 集合缓存（从 siteHandlers 配置派生）
  // 注意：同时加入 www 和非 www 变体，因为部分站点（如 doubao.com → www.doubao.com）
  // 会自动重定向，导致 iframe 的真实 origin 与配置 URL 的 origin 不一致。
  let _aiOriginsCache = null;
  async function getAIOrigins() {
    if (_aiOriginsCache) return _aiOriginsCache;
    const origins = new Set();
    try {
      let sites = [];
      if (global.siteDetector && typeof global.siteDetector.getSites === 'function') {
        sites = await global.siteDetector.getSites();
      } else if (typeof global.getDefaultSites === 'function') {
        sites = await global.getDefaultSites();
      }
      for (const site of sites) {
        if (site && site.url) {
          try {
            const parsedUrl = new URL(site.url);
            origins.add(parsedUrl.origin);
            // 同时加入 www/non-www 变体，解决域名重定向导致的 origin 不匹配
            if (parsedUrl.hostname.startsWith('www.')) {
              origins.add(parsedUrl.origin.replace('//www.', '//'));
            } else {
              origins.add(parsedUrl.origin.replace('//', '//www.'));
            }
          } catch (e) {
            // 忽略非法 URL
          }
        }
      }
    } catch (e) {
      // 配置加载失败，返回空集合（接收端会拒绝所有 AI 站点消息，但不影响扩展自身消息）
    }
    _aiOriginsCache = origins;
    return origins;
  }

  // 当站点配置变化时清空缓存（由调用方在 storage.onChanged 时触发）
  function invalidateAIOriginsCache() {
    _aiOriginsCache = null;
  }

  /**
   * 判断收到的 message 事件是否可信
   *
   * 信任规则（满足任一）：
   *  1. event.origin === 扩展自身 origin（扩展页之间通信，或 inject.js 收到来自扩展父页面的消息）
   *  2. event.origin ∈ 已知 AI 站点 origin 集合（扩展页收到来自 AI 站点 iframe 的消息）
   *
   * 注意：调用此函数前应已确认 event.data 是对象。
   *
   * @param {MessageEvent} event
   * @param {Object} [opts]
   * @param {Window} [opts.expectedSource] - 可选，进一步校验 event.source 必须等于某个 window
   * @param {string[]} [opts.additionalTrustedOrigins] - 可选，额外信任的 origin 列表
   *   用于处理站点域名重定向（如 kimi.moonshot.cn → www.kimi.com）导致 iframe 实际 origin
   *   不在配置 URL 推导的集合中的情况。调用方应仅传入已通过 event.source 匹配验证
   *   的 iframe 缓存的实际 origin。
   * @returns {Promise<boolean>}
   */
  async function isTrustedMessage(event, opts = {}) {
    if (!event || typeof event.origin !== 'string') return false;

    // 可选的 source 精确匹配（最强校验，用于已知单个 iframe 的场景）
    if (opts.expectedSource && event.source !== opts.expectedSource) return false;

    const extOrigin = getExtensionOrigin();

    // 规则 1：来自扩展自身
    if (extOrigin && event.origin === extOrigin) return true;

    // inject.js 运行在第三方 AI 站点，其父页面就是扩展页面。
    // 此时 event.origin 应为扩展 origin —— 但 inject.js 无法直接拿到扩展 origin，
    // 因此它收到的"来自父页面"的消息，origin 就是 chrome-extension://<id>。
    // 我们通过 "event.source === window.parent" 来确认消息确实来自父页面，
    // 再配合 origin 形如 chrome-extension:// 前缀即可信任。
    if (!extOrigin && global.window && global.window.parent && event.source === global.window.parent) {
      if (event.origin.startsWith('chrome-extension://')) return true;
    }

    // 规则 2：来自已知 AI 站点（仅扩展页面场景有意义）
    if (extOrigin) {
      const aiOrigins = await getAIOrigins();
      if (aiOrigins.has(event.origin)) return true;
    }

    // 规则 3：来自调用方提供的额外信任 origin（处理域名重定向场景）
    // 前提：调用方已通过 expectedSource 确认 event.source 匹配已知 iframe，
    // 此处仅补充校验 origin 是否为该 iframe 曾经发送过消息的实际 origin。
    if (opts.additionalTrustedOrigins && opts.additionalTrustedOrigins.length > 0) {
      if (opts.additionalTrustedOrigins.includes(event.origin)) return true;
    }

    return false;
  }

  /**
   * 同步快速校验（不查 AI 站点集合）
   * 用于只需校验"扩展自身 origin"的场景，避免异步开销。
   * @param {MessageEvent} event
   * @returns {boolean}
   */
  function isFromExtension(event) {
    if (!event || typeof event.origin !== 'string') return false;
    const extOrigin = getExtensionOrigin();
    if (extOrigin && event.origin === extOrigin) return true;
    // inject.js 场景：父页面是扩展页
    if (!extOrigin && global.window && global.window.parent && event.source === global.window.parent) {
      return event.origin.startsWith('chrome-extension://');
    }
    return false;
  }

  /**
   * 安全发送 postMessage（避免使用 '*'）
   *
   * @param {Window} targetWindow - 接收方 window
   * @param {*} message - 消息体
   * @param {string} [targetOrigin] - 目标 origin；不提供时尝试自动推断
   * @returns {boolean} 是否成功发送（origin 未知时拒绝发送，返回 false）
   */
  function safePostMessage(targetWindow, message, targetOrigin) {
    if (!targetWindow || typeof targetWindow.postMessage !== 'function') return false;

    let origin = targetOrigin;

    // 未显式指定 targetOrigin 时，尝试从目标 window 推断
    if (!origin) {
      try {
        // 同源 iframe：可直接读取 location.origin
        if (targetWindow.location && targetWindow.location.origin && targetWindow.location.origin !== 'null') {
          origin = targetWindow.location.origin;
        }
      } catch (e) {
        // 跨域，无法直接读取
      }
    }

    // 父→子（扩展页→AI 站点 iframe）：若仍未知，查询 AI 站点集合
    // 这一步需要异步，safePostMessage 为同步函数，因此调用方应在已知 origin 时直接传入。
    // 若确实未知，为安全起见拒绝发送（返回 false），由调用方降级处理。

    if (!origin || origin === 'null') {
      // 无法确定目标 origin，拒绝以 '*' 广播，避免信息泄露
      console.warn('[messaging] safePostMessage: 无法确定 targetOrigin，已拒绝发送消息');
      return false;
    }

    try {
      targetWindow.postMessage(message, origin);
      return true;
    } catch (e) {
      console.error('[messaging] postMessage 发送失败:', e);
      return false;
    }
  }

  global.MessagingSecurity = {
    getExtensionOrigin,
    getAIOrigins,
    invalidateAIOriginsCache,
    isTrustedMessage,
    isFromExtension,
    safePostMessage,
  };
})((typeof window !== 'undefined') ? window : self);
