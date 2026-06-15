// ==================== AI 总结功能实现 ====================

// 状态常量定义
const STATE_IDLE = 'idle';
const STATE_GENERATING = 'generating';
const STATE_SUCCESS = 'success';
const STATE_ERROR = 'error';

// 全局状态跟踪
let summaryState = STATE_IDLE;
let cachedSummaryText = '';
let cachedSummaryQuery = '';
let activeModalElement = null;

// 安全的国际化函数
function getSummaryI18nMessage(key, fallback) {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(key);
      return message || fallback;
    }
  } catch (error) {
    console.warn('国际化函数调用失败:', error);
  }
  return fallback;
}

// 显示未读小绿点
function showSummaryUnreadDot() {
  const dot = document.getElementById('summaryUnreadDot');
  if (dot) {
    dot.style.display = 'block';
  }
}

// 隐藏未读小绿点
function hideSummaryUnreadDot() {
  const dot = document.getElementById('summaryUnreadDot');
  if (dot) {
    dot.style.display = 'none';
  }
}

// 在外部暴露给 iframe.js 调用的接口
window.showSummaryUnreadDot = showSummaryUnreadDot;
window.hideSummaryUnreadDot = hideSummaryUnreadDot;

// 清理总结缓存（通常在发送新问题时触发）
function clearSummaryCache() {
  cachedSummaryText = '';
  cachedSummaryQuery = '';
  summaryState = STATE_IDLE;
  
  // 隐藏未读小绿点
  hideSummaryUnreadDot();
  
  // 移除按钮 loading 状态
  const summaryBtn = document.getElementById('summaryToggleBtn');
  if (summaryBtn) {
    summaryBtn.classList.remove('loading');
  }
}
window.clearSummaryCache = clearSummaryCache;

// 使用 marked.js 渲染 Markdown（所有输出经 DOMPurify 清理，防 XSS - S5）
function renderSummaryMarkdown(text) {
  if (!text) return '';
  let html = '';
  try {
    if (typeof marked !== 'undefined' && marked.parse) {
      html = marked.parse(text);
    }
  } catch (error) {
    console.error('marked.js 渲染 Markdown 失败，使用简易渲染器降级:', error);
    // 简易降级渲染器（防 XSS 且保留代码块和换行）
    html = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
  }
  // 统一用 DOMPurify 清理 HTML 输出，剥离事件处理器/脚本等危险节点
  if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
    try {
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch (e) {
      console.error('DOMPurify 清理失败，拒绝渲染:', e);
      return '';
    }
  }
  // DOMPurify 不可用时，降级为完全转义的纯文本（宁可丢失格式也不注入）
  console.warn('DOMPurify 不可用，summary 以纯文本形式渲染');
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 触发后台生成，展示按钮 loading 动画
function startBackgroundSummary(query) {
  summaryState = STATE_GENERATING;
  cachedSummaryQuery = query;
  
  const summaryBtn = document.getElementById('summaryToggleBtn');
  if (summaryBtn) {
    summaryBtn.classList.add('loading');
  }
  
  generateSummaryBackground(query);
}

// 渲染模态框骨架屏
function showModalSkeleton(modal) {
  const body = modal.querySelector('#summaryModalBody');
  body.innerHTML = `
    <div style="font-size: 14px; color: #666; margin-bottom: 12px;">
      ${getSummaryI18nMessage('summaryGenerating', '正在提取网页内容并生成 AI 总结中，请稍候...')}
    </div>
    <div class="summary-skeleton-container">
      <div class="summary-skeleton-line header"></div>
      <div class="summary-skeleton-line p1"></div>
      <div class="summary-skeleton-line p2"></div>
      <div class="summary-skeleton-line p3"></div>
      <div class="summary-skeleton-line p4"></div>
    </div>
  `;
  
  // 隐藏操作按钮
  modal.querySelector('#summaryCopyBtn').style.display = 'none';
  modal.querySelector('#summaryExportBtn').style.display = 'none';
  modal.querySelector('#summaryRegenerateBtn').style.display = 'none';
}

// 渲染未配置接口错误界面
function showNoConfigError(modal) {
  const body = modal.querySelector('#summaryModalBody');
  body.innerHTML = `
    <div class="summary-error-container">
      <div style="font-size: 40px; margin-bottom: 16px;">⚙️</div>
      <div class="summary-error-text">
        ${getSummaryI18nMessage('summaryNoConfig', '⚠️ 您尚未配置 AI 总结接口。请前往插件设置页面配置 API 参数。')}
      </div>
      <button id="goToSettingsBtn" class="export-btn export-btn-primary">
        ${getSummaryI18nMessage('summaryGoToSettings', '前往设置')}
      </button>
    </div>
  `;
  
  // 隐藏操作按钮
  modal.querySelector('#summaryCopyBtn').style.display = 'none';
  modal.querySelector('#summaryExportBtn').style.display = 'none';
  modal.querySelector('#summaryRegenerateBtn').style.display = 'none';

  const goToSettingsBtn = body.querySelector('#goToSettingsBtn');
  if (goToSettingsBtn) {
    goToSettingsBtn.onclick = () => {
      chrome.runtime.openOptionsPage();
    };
  }
}

// 渲染请求失败重试界面
function showModalError(modal, query) {
  const body = modal.querySelector('#summaryModalBody');
  body.innerHTML = `
    <div class="summary-error-container">
      <div style="font-size: 40px; margin-bottom: 16px;">❌</div>
      <div class="summary-error-text">API 总结生成失败，请检查 API 配置或网络连接。</div>
      <button id="summaryRetryBtn" class="export-btn export-btn-primary">🔄 重试</button>
    </div>
  `;
  
  // 隐藏操作按钮
  modal.querySelector('#summaryCopyBtn').style.display = 'none';
  modal.querySelector('#summaryExportBtn').style.display = 'none';
  modal.querySelector('#summaryRegenerateBtn').style.display = 'none';

  const retryBtn = body.querySelector('#summaryRetryBtn');
  if (retryBtn) {
    retryBtn.onclick = () => {
      startBackgroundSummary(query);
      showModalSkeleton(modal);
    };
  }
}

// 显示总结弹窗
function showSummaryModal() {
  console.log('🎯 开始显示总结弹窗');
  
  // 已读，清除小绿点
  hideSummaryUnreadDot();

  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'summary-modal';
  modal.innerHTML = `
    <div class="summary-modal-content">
      <div class="summary-modal-header">
        <h3 class="summary-modal-title"> ${getSummaryI18nMessage('summaryModalTitle', 'AI 智能总结')}</h3>
        <button class="summary-close-btn" id="summaryCloseBtn">×</button>
      </div>
      
      <div class="summary-modal-body" id="summaryModalBody">
        <!-- 内容动态加载 -->
      </div>
      
      <div class="summary-modal-footer">
        <button class="export-btn export-btn-secondary" id="summaryCopyBtn" style="display:none;">${getSummaryI18nMessage('summaryCopy', '📋 复制总结')}</button>
        <button class="export-btn export-btn-primary" id="summaryExportBtn" style="display:none;">${getSummaryI18nMessage('summaryExport', '💾 导出 Markdown')}</button>
        <button class="export-btn export-btn-secondary" id="summaryRegenerateBtn" style="display:none;">${getSummaryI18nMessage('summaryRegenerate', '🔄 重新总结')}</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  activeModalElement = modal;

  // 初始化弹窗关闭事件
  const closeBtn = modal.querySelector('#summaryCloseBtn');
  const closeModal = () => {
    modal.style.animation = 'fadeIn 0.3s ease-out reverse';
    setTimeout(() => {
      if (modal.parentElement) {
        modal.remove();
      }
      if (activeModalElement === modal) {
        activeModalElement = null;
      }
    }, 300);
  };
  
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // 获取当前查询 query
  const query = window._lastQuery;

  if (!query) {
    // 渲染提示未开始对话的错误视图
    const body = modal.querySelector('#summaryModalBody');
    body.innerHTML = `
      <div class="summary-error-container">
        <div style="font-size: 40px; margin-bottom: 16px;">💬</div>
        <div class="summary-error-text">
          您尚未开始提问。请先在上方输入框输入问题并点击「一键发送」开始对话后，再使用总结功能。
        </div>
      </div>
    `;
    return;
  }

  // 根据当前生成状态填充 modal 内部
  if (summaryState === STATE_SUCCESS && cachedSummaryQuery === query) {
    displaySummaryResult(modal, cachedSummaryText);
  } else if (summaryState === STATE_GENERATING) {
    showModalSkeleton(modal);
  } else if (summaryState === STATE_ERROR) {
    showModalError(modal, query);
  } else {
    // idle 状态，但弹窗打开（防防御），直接触发后台生成并展示骨架屏
    startBackgroundSummary(query);
    showModalSkeleton(modal);
  }
}

// 安全的 Toast 提示函数
function showSummaryToast(message) {
  if (typeof showToast === 'function') {
    showToast(message);
  } else {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.style.display = 'block';
      toast.style.opacity = '1';
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
          toast.style.display = 'none';
        }, 300);
      }, 2000);
    } else {
      console.log('Toast message:', message);
    }
  }
}

// 显示总结结果到弹窗中，并启用底部操作按钮
function displaySummaryResult(modal, summaryText) {
  const body = modal.querySelector('#summaryModalBody');
  body.innerHTML = `<div class="summary-markdown-body">${renderSummaryMarkdown(summaryText)}</div>`;
  
  const copyBtn = modal.querySelector('#summaryCopyBtn');
  const exportBtn = modal.querySelector('#summaryExportBtn');
  const regenerateBtn = modal.querySelector('#summaryRegenerateBtn');

  if (copyBtn) {
    copyBtn.style.display = 'inline-flex';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(summaryText).then(() => {
        showSummaryToast(getSummaryI18nMessage('summaryCopied', '已复制到剪贴板'));
      }).catch(err => {
        console.error('复制失败:', err);
      });
    };
  }

  if (exportBtn) {
    exportBtn.style.display = 'inline-flex';
    exportBtn.onclick = () => {
      try {
        const query = window._lastQuery || 'query';
        const safeQuery = query.substring(0, 15).replace(/[\\/:*?"<>|]/g, '_');
        const blob = new Blob([summaryText], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `summary_${safeQuery}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('导出失败:', err);
      }
    };
  }

  if (regenerateBtn) {
    regenerateBtn.style.display = 'inline-flex';
    regenerateBtn.onclick = () => {
      const query = window._lastQuery || document.getElementById('searchInput').value.trim();
      startBackgroundSummary(query);
      showModalSkeleton(modal);
    };
  }
}

// 核心的后台请求 API 生成总结逻辑
async function generateSummaryBackground(query) {
  try {
    // 1. 检查配置信息
    let config = {};
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        config = await chrome.storage.sync.get([
          'summaryApiUrl',
          'summaryApiKey',
          'summaryApiModel',
          'summaryApiPrompt'
        ]);
      }
    } catch (error) {
      console.error('读取总结设置失败:', error);
    }

    const apiUrl = config.summaryApiUrl;
    const apiKey = config.summaryApiKey;
    const modelName = config.summaryApiModel;

    if (!apiUrl || !apiKey || !modelName) {
      throw new Error('summary-no-config');
    }

    // 2. 提取所有打开的 iframe 内容
    const iframes = document.querySelectorAll('iframe[data-site]');
    const activeSites = new Set(Array.from(iframes).map(f => f.getAttribute('data-site')).filter(Boolean));

    if (activeSites.size === 0) {
      throw new Error('未检测到任何活动的 AI 对比站点回答内容。');
    }

    let responses = [];
    try {
      responses = await collectResponses(activeSites);
    } catch (err) {
      console.error('抓取 iframes 内容失败:', err);
      throw new Error(`内容提取失败: ${err.message}`);
    }

    // 过滤出有内容的回答
    const validResponses = responses.filter(r => r.content && r.content.trim() && !r.content.includes('无法自动提取'));

    if (validResponses.length === 0) {
      throw new Error('未检测到任何有效的 AI 回答内容，请确保 AI 已经完成输出。');
    }

    // 3. 组装 prompt
    let responsesContent = '';
    validResponses.forEach(r => {
      responsesContent += `### ${r.siteName} 的回答：\n${r.content}\n\n---\n\n`;
    });

    const systemPrompt = config.summaryApiPrompt || "你是一个优秀的AI总结和对比助手。请总结以下所有 AI 的回答要点，对比它们的分歧与共识，提取出核心结论，并输出一份精美的 Markdown 报告。";
    const userPrompt = `我们针对以下问题，向多个不同的 AI 进行了提问：
问题："${query || '未知问题'}"

以下是各个 AI 的回答内容：
${responsesContent}

请总结它们的回答，找出共识与分歧，并以清晰、精美的 Markdown 格式输出总结报告。`;

    // 4. 请求 API
    let cleanUrl = apiUrl.trim();
    if (!cleanUrl.endsWith('/chat/completions')) {
      cleanUrl = cleanUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const response = await fetch(cleanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName.trim(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 接口错误 (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const summaryText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!summaryText) {
      throw new Error('API 返回的数据中未包含生成的文本内容');
    }

    // 缓存数据并标记为成功
    cachedSummaryText = summaryText;
    cachedSummaryQuery = query;
    summaryState = STATE_SUCCESS;

    // 恢复按钮状态
    const summaryBtn = document.getElementById('summaryToggleBtn');
    if (summaryBtn) {
      summaryBtn.classList.remove('loading');
    }

    // 更新 UI：若当前弹窗处于打开状态，直接填充结果；否则显示未读绿点提醒
    if (activeModalElement && document.body.contains(activeModalElement)) {
      displaySummaryResult(activeModalElement, cachedSummaryText);
    } else {
      showSummaryUnreadDot();
    }

  } catch (err) {
    console.error('AI 总结生成失败:', err);
    summaryState = STATE_ERROR;

    // 恢复按钮状态
    const summaryBtn = document.getElementById('summaryToggleBtn');
    if (summaryBtn) {
      summaryBtn.classList.remove('loading');
    }

    // 更新 UI
    if (activeModalElement && document.body.contains(activeModalElement)) {
      if (err.message === 'summary-no-config') {
        showNoConfigError(activeModalElement);
      } else {
        showModalError(activeModalElement, query);
      }
    } else {
      // 弹窗未打开，提供 toast 提示
      if (err.message === 'summary-no-config') {
        showSummaryToast(getSummaryI18nMessage('summaryNoConfig', '⚠️ 您尚未配置 AI 总结接口。请前往插件设置页面配置 API 参数。'));
      } else {
        showSummaryToast(`AI 总结生成失败: ${err.message}`);
      }
    }
  }
}

// 统一控制总结按钮的点击逻辑
function handleSummaryBtnClick() {
  const query = window._lastQuery;
  
  if (!query) {
    // 尚未提问，直接弹出空模态框提示
    showSummaryModal();
    return;
  }

  // 状态机分流处理
  if (summaryState === STATE_IDLE || (summaryState === STATE_ERROR && cachedSummaryQuery !== query)) {
    // 首次触发总结，只触发后台计算，不打开弹窗，由加载状态取代
    startBackgroundSummary(query);
  } else if (summaryState === STATE_GENERATING) {
    // 生成中再次点击：不打开弹窗，仅进行 Toast 提示
    showSummaryToast(getSummaryI18nMessage('summaryGeneratingToast', '智能总结正在后台生成，生成完毕后会有绿点提示，请稍候...'));
  } else if (summaryState === STATE_SUCCESS && cachedSummaryQuery === query) {
    // 生成完毕：打开弹窗展示，并清除未读小绿点
    showSummaryModal();
  } else if (summaryState === STATE_ERROR) {
    // 生成失败：打开弹窗显示错误和重试按钮
    showSummaryModal();
  } else {
    // 防御逻辑：查询不一致重新触发
    startBackgroundSummary(query);
  }
}

// 绑定总结按钮点击事件
document.addEventListener('DOMContentLoaded', () => {
  const summaryBtn = document.getElementById('summaryToggleBtn');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', handleSummaryBtnClick);
  }
});
