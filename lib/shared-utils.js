/**
 * Shared utility functions used across multiple extension pages.
 * Include this script before page-specific scripts in HTML files.
 */

// ==================== Analytics ====================

/**
 * Track an analytics event via the global AIShortcutsAnalytics instance.
 */
function trackEvent(name, params = {}) {
  const analytics = window.AIShortcutsAnalytics;
  if (analytics && typeof analytics.logEvent === 'function') {
    analytics.logEvent(name, params);
  }
}

// ==================== i18n ====================

/**
 * Get an i18n message by key, with optional substitutions.
 */
function getMessage(key, substitutions = null) {
  return chrome.i18n.getMessage(key, substitutions);
}

/**
 * Initialize internationalization for the page.
 * Translates elements with data-i18n (textContent), data-i18n-placeholder (placeholder),
 * and handles special cases for input/textarea/button/img elements.
 *
 * @param {Object} [options]
 * @param {boolean} [options.updateTitle] - Whether to update document.title
 * @param {string} [options.titleKey='appName'] - i18n key for the page title (with fallback to 'appName')
 * @param {boolean} [options.smartElements] - Use tag-aware translation (placeholder for inputs, title for buttons/imgs)
 * @param {string} [options.searchInputId] - ID of search input to manually set 'inputPlaceholder'
 */
function initializeI18n(options = {}) {
  const { updateTitle = false, titleKey = 'appName', smartElements = false, searchInputId = null } = options;

  if (updateTitle) {
    const title = chrome.i18n.getMessage(titleKey) || chrome.i18n.getMessage('appName');
    if (title) {
      document.title = title;
    }
  }

  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (!message) return;

    if (smartElements) {
      const tag = element.tagName.toLowerCase();
      if ((tag === 'input' && element.type === 'text') || tag === 'textarea') {
        element.placeholder = message;
      } else if (tag === 'button' || tag === 'img') {
        element.title = message;
      } else {
        element.textContent = message;
      }
    } else {
      element.textContent = message;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.placeholder = message;
    }
  });

  if (searchInputId) {
    const searchInput = document.getElementById(searchInputId);
    if (searchInput) {
      const placeholderMessage = chrome.i18n.getMessage('inputPlaceholder');
      if (placeholderMessage) {
        searchInput.placeholder = placeholderMessage;
      }
    }
  }
}

// ==================== Toast Notifications ====================

/**
 * Show a toast notification.
 * Uses an existing #toast element if present (adds/removes .show class),
 * otherwise creates a temporary floating element.
 *
 * @param {string} message - The message to display
 * @param {number} [duration=2000] - Display duration in milliseconds
 */
function showToast(message, duration = 2000) {
  const existingToast = document.getElementById('toast');

  if (existingToast) {
    existingToast.classList.remove('show');
    void existingToast.offsetWidth;
    existingToast.textContent = message;
    existingToast.classList.add('show');

    if (existingToast.timeoutId) {
      clearTimeout(existingToast.timeoutId);
    }
    existingToast.timeoutId = setTimeout(() => {
      existingToast.classList.remove('show');
    }, duration);
  } else {
    const prev = document.querySelector('.toast');
    if (prev) prev.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 10000;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(toast);

    setTimeout(() => { toast.style.opacity = '1'; }, 10);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, duration);
  }
}

// ==================== IME Composition ====================

/**
 * Track IME composition state on a given element (or document).
 * Prevents premature form submission during CJK input.
 *
 * @param {EventTarget} [target=document] - The element to listen on
 * @returns {{ isComposing: () => boolean }} Accessor for current state
 */
function createCompositionTracker(target = document) {
  let composing = false;
  target.addEventListener('compositionstart', () => { composing = true; });
  target.addEventListener('compositionend', () => { composing = false; });
  return { isComposing: () => composing };
}

// ==================== Query Suggestions ====================

/**
 * Load and display query suggestions from prompt templates.
 * Used by both iframe.js and homepage.js.
 *
 * @param {string} query - Current input value
 * @param {Object} [options]
 * @param {string} [options.containerId='querySuggestions'] - ID of the suggestions container
 * @param {string} [options.inputId='searchInput'] - ID of the search input
 * @param {number} [options.maxItems=5] - Maximum suggestions to show
 * @param {boolean} [options.showMoreBtn=true] - Show the "edit templates" button
 * @param {boolean} [options.hideOnEmpty=true] - Hide container when query is empty (false shows all)
 * @param {Function} [options.onSelect] - Callback after a suggestion is selected
 */
async function showQuerySuggestions(query, options = {}) {
  const {
    containerId = 'querySuggestions',
    inputId = 'searchInput',
    maxItems = 5,
    showMoreBtn = true,
    hideOnEmpty = true,
    onSelect = null
  } = options;

  const container = document.getElementById(containerId);
  if (!container) return;

  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed && hideOnEmpty) {
    container.style.display = 'none';
    return;
  }

  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');

    const sortedTemplates = promptTemplates
      .filter(t => t.name && t.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const matched = trimmed
      ? sortedTemplates.filter(t =>
          t.name.toLowerCase().includes(trimmed) ||
          t.query.toLowerCase().includes(trimmed))
      : sortedTemplates;

    const top = matched.slice(0, maxItems);

    container.innerHTML = '';

    top.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'query-suggestion-item';
      chip.textContent = t.name;
      chip.addEventListener('click', () => {
        const input = document.getElementById(inputId);
        if (input) {
          input.value = t.query.replace('{query}', input.value.trim());
          if (onSelect) onSelect(input.value);
        }
      });
      container.appendChild(chip);
    });

    if (showMoreBtn) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'query-suggestion-item query-suggestion-more-btn';
      moreBtn.title = chrome.i18n.getMessage('editTemplateTitle') || '编辑提示词模板';
      moreBtn.setAttribute('aria-label', moreBtn.title);
      moreBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="19" cy="12" r="2"/>
        </svg>
      `;
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(chrome.runtime.getURL('options/options.html#prompt-templates'), '_blank');
      });
      container.appendChild(moreBtn);
    }

    container.style.display = 'flex';
  } catch (error) {
    console.error('加载提示词模板失败:', error);
    container.style.display = 'none';
  }
}
