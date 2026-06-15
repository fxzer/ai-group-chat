// 控制调试日志输出，生产模式下屏蔽普通的 console.log 以优化性能
const DEBUG_MODE = false;
if (!DEBUG_MODE) {
  console.log = function() {};
}

// 重写 HTMLElement.prototype.focus 阻止自动滚动父页面（解决多 iframe 环境下的滚动抖动问题）
// 注意：仅在扩展自身的 iframe.html 页面内生效，不影响第三方 AI 站点
if (typeof HTMLElement !== 'undefined' && HTMLElement.prototype.focus) {
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(options) {
    if (options && typeof options === 'object') {
      options.preventScroll = true;
    } else {
      options = { preventScroll: true };
    }
    return originalFocus.call(this, options);
  };
}

// 全局文件粘贴检测和处理
let filePasteHandlerAdded = false;

// 跟踪输入法组合输入状态（用于中文输入法）
let isComposing = false;

function trackEvent(name, params = {}) {
  const analytics = window.AIShortcutsAnalytics;
  if (analytics && typeof analytics.logEvent === 'function') {
    analytics.logEvent(name, params);
  }
}

function getOpenedSites() {
  return Array.from(document.querySelectorAll('.ai-iframe'))
    .map(iframe => iframe.getAttribute('data-site'))
    .filter(Boolean);
}

// ========== iframe 实际 origin 缓存 ==========
// 一些站点（如 kimi.moonshot.cn）会重定向到不同的域名（如 www.kimi.com），
// 导致 iframe.src 推导的 origin 与 iframe 当前页面的实际 origin 不匹配，
// postMessage 被浏览器静默丢弃。我们通过监听 iframe 发送到父页面的消息，
// 从 event.origin 获取其实际 origin 并缓存，供后续出站消息使用。
const iframeActualOriginMap = new WeakMap();
// 暴露到 window 供 export-responses.js 等同页面脚本访问
window.iframeActualOriginMap = iframeActualOriginMap;

// 向 AI 站点 iframe 安全发送消息（S2：用具体 origin 取代 '*'）
// 优先使用缓存的实际 origin（来自 iframe 之前发送的消息中的 event.origin），
// 若不可用则从 iframe.src 推导并尝试 www/non-www 变体。
function postToIframe(iframe, message) {
  if (!iframe || !iframe.contentWindow) return false;
  let origins = [];
  
  // 方法1（最佳）：使用缓存的实际 origin（从 iframe 此前发来的消息中获取）
  const cachedOrigin = iframeActualOriginMap.get(iframe);
  if (cachedOrigin) {
    origins.push(cachedOrigin);
  }
  
  // 方法2：尝试同源读取（仅同源 iframe 生效）
  try {
    const o = iframe.contentWindow.location.origin;
    if (o && o !== 'null' && o !== 'about:blank') origins.push(o);
  } catch (e) { /* 跨域，无法直接读取 */ }
  
  // 方法3：从 iframe.src 推导 origin，同时生成 www/non-www 变体
  if (iframe.src) {
    try {
      const parsed = new URL(iframe.src);
      const primaryOrigin = parsed.origin;
      origins.push(primaryOrigin);
      // 生成 www/non-www 变体：对于重定向到 www 前缀的站点（如 doubao.com → www.doubao.com）
      if (parsed.hostname.startsWith('www.')) {
        origins.push(primaryOrigin.replace('//www.', '//'));
      } else {
        origins.push(primaryOrigin.replace('//', '//www.'));
      }
    } catch (e2) { /* ignore */ }
  }
  
  // 去重
  origins = [...new Set(origins)];
  
  if (origins.length === 0) {
    console.warn('[iframe] postToIframe: 无法确定 targetOrigin，已拒绝发送', message && message.type);
    return false;
  }
  
  // 向所有候选 origin 发送消息——浏览器仅会送达与 iframe 当前页面 origin 匹配的那个。
  // 不匹配的将被静默丢弃，不会产生副作用。
  let sentAny = false;
  for (const origin of origins) {
    try {
      iframe.contentWindow.postMessage(message, origin);
      sentAny = true;
    } catch (e) {
      console.error('[iframe] postToIframe 发送失败, origin:', origin, e);
    }
  }
  return sentAny;
}

// 统一的文件扩展名检测
const SUPPORTED_FILE_EXTENSIONS = [
  // Office文档类型
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key',
  'wps', 'et', 'dps', 'vsd', 'vsdx', 'pub', 'one', 'msg', 'eml', 'mpp',
  // 文本和数据文件
  'txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'md', 'yaml', 'yml',
  // 图片格式
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico', 'avif',
  // 音视频格式
  'mp4', 'avi', 'mov', 'wmv', 'webm', 'mp3', 'wav', 'ogg', 'flac', 'm4a',
  // 代码文件
  'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'ts',
  // 压缩文件
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'
];

const FILE_EXTENSION_REGEX = new RegExp(`\\.(${SUPPORTED_FILE_EXTENSIONS.join('|')})$`, 'i');

// 检测是否具有有效的文件扩展名
function hasValidFileExtension(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const firstLine = text.trim().split('\n')[0];
  
  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }
  
  // 排除包含域名模式的内容（如www.xxx.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }
  
  return FILE_EXTENSION_REGEX.test(firstLine) && firstLine.length < 100;
}

// 通用的站点过滤函数
function getFilteredAvailableSites(sites, selectedSiteNames = null) {
  if (selectedSiteNames && selectedSiteNames.length > 0) {
    return sites.filter(site => 
      selectedSiteNames.includes(site.name) &&
      site.supportIframe !== false && 
      !site.hidden
    );
  }
  return sites.filter(site => 
    site.enabled && 
    site.supportIframe !== false && 
    !site.hidden
  );
}

// 请求剪贴板权限的函数
async function requestClipboardPermission() {
  try {
    console.log('🔍 开始请求剪贴板权限...');
    
    // 检查权限状态
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('当前剪贴板权限状态:', permissionStatus.state);
    console.log('权限对象详情:', permissionStatus);
    
    if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
      return true;
    } else if (permissionStatus.state === 'prompt') {
      console.log('🔄 需要用户授权剪贴板权限');
      console.log('📋 尝试读取剪贴板来触发权限请求...');
      
      // 尝试读取剪贴板来触发权限请求
      try {
        const clipboardData = await navigator.clipboard.read();
        console.log('✅ 剪贴板权限请求成功');
        console.log('剪贴板内容:', clipboardData);
        return true;
      } catch (error) {
        console.log('❌ 剪贴板权限请求失败:', error);
        console.log('错误名称:', error.name);
        console.log('错误消息:', error.message);
        console.log('错误堆栈:', error.stack);
        return false;
      }
    } else {
      console.log('❌ 剪贴板权限被拒绝');
      console.log('💡 建议: 请检查浏览器设置中的剪贴板权限');
      return false;
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
    console.log('错误详情:', error);
    return false;
  }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化自动调整高度的输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // 输入时显隐清空按钮
        searchInput.addEventListener('input', () => {
            const btn = document.getElementById('clearInputBtn');
            if (btn) {
                btn.style.display = searchInput.value ? 'flex' : 'none';
            }
        });
        
        // 清空按钮点击处理
        const clearBtn = document.getElementById('clearInputBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                searchInput.value = '';
                searchInput.focus();
                clearBtn.style.display = 'none';
            });
        }
    }
    
    // 初始化列数选择
    const columnOptionBtns = document.querySelectorAll('.column-option-btn');
    const iframesContainer = document.getElementById('iframes-container');

    // 检测是否在侧边栏中打开
    const isSidePanel = window.location.href.includes('side_panel') || 
                       window.location.search.includes('side_panel') ||
                       (window.top !== window); // 如果被嵌入，可能是在侧边栏中

    // 从存储中获取列数设置
    let { preferredColumns = '3' } = await chrome.storage.sync.get('preferredColumns');
    
    // 如果在侧边栏中打开，临时使用1列
    if (isSidePanel || window.innerWidth < 500) {
       preferredColumns = '1';
    }
    
    // 设置默认激活状态并更新布局
    setActiveColumnOption(preferredColumns);
    updateColumns(preferredColumns);

    // 检查 URL 参数，判断打开方式
    const urlParams = new URLSearchParams(window.location.search);
    const hasQueryParam = urlParams.has('query');
    const hasSitesParam = urlParams.has('sites');
    const historyId = urlParams.get('historyId');
    
    // 获取指定的站点列表（如果存在）
    let selectedSiteNames = null;
    if (hasSitesParam) {
        const sitesParam = urlParams.get('sites');
        if (sitesParam) {
            selectedSiteNames = sitesParam.split(',').map(name => name.trim()).filter(name => name);
            console.log('从 URL 参数获取指定的站点列表:', selectedSiteNames);
        }
    }
    
    // 默认加载函数
    function initializeDefaultLoad() {
        if (hasQueryParam) {
            // 从 URL 参数中获取查询内容
            const query = urlParams.get('query');
            console.log('从 URL 参数获取查询内容:', query);
            
            if (query && query !== 'true') {
                // 将查询内容填入搜索框
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.value = query;
                }
                
                // 获取站点配置并创建 iframes
                getDefaultSites().then((sites) => {
                    const availableSites = getFilteredAvailableSites(sites || [], selectedSiteNames);
                    createIframes(query, availableSites);
                    if (availableSites.length > 0) {
                        // 清理 URL 参数，防止刷新时自动重发
                        const cleanUrl = window.location.pathname + window.location.hash;
                        window.history.replaceState({}, '', cleanUrl);
                    }
                });
            } else {
                // 如果查询参数是 'true' 或空，按直接打开处理
                console.log('URL 参数 query=true，按直接打开处理');
                getDefaultSites().then((sites) => {
                    const availableSites = getFilteredAvailableSites(sites || [], selectedSiteNames);
                    createIframes('', availableSites);
                });
            }
        } else {
            // 直接打开（方式1）
            getDefaultSites().then((sites) => {
                const availableSites = getFilteredAvailableSites(sites || [], selectedSiteNames);
                createIframes('', availableSites);
            });
        }
    }

    if (historyId) {
        console.log('从 URL 参数检测到历史记录 ID:', historyId);
        chrome.storage.local.get('pkHistory').then(({ pkHistory = [] }) => {
            const historyItem = pkHistory.find(item => item.id === historyId);
            if (historyItem) {
                console.log('找到匹配的历史记录项:', historyItem);
                const searchInput = document.getElementById('searchInput');
                if (searchInput && historyItem.query) {
                    searchInput.value = historyItem.query;
                    window._lastQuery = historyItem.query;
                }
                window._currentHistoryId = historyItem.id;
                loadHistoryIframes(historyItem.sites);
                
                // 清理 URL 参数，防止刷新时自动重发
                const cleanUrl = window.location.pathname + window.location.hash;
                window.history.replaceState({}, '', cleanUrl);
            } else {
                console.warn('未找到匹配的历史记录项:', historyId);
                initializeDefaultLoad();
            }
        }).catch(err => {
            console.error('读取历史记录失败:', err);
            initializeDefaultLoad();
        });
    } else {
        initializeDefaultLoad();
    }

    // 列数选项点击监听器
    columnOptionBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const columns = e.currentTarget.getAttribute('data-columns');
            selectColumnOption(columns);
        });
    });

    // 统一的文件粘贴处理 - 只添加一次监听器
    if (!filePasteHandlerAdded) {
        document.addEventListener('paste', handleUnifiedFilePaste);
        filePasteHandlerAdded = true;
        console.log('🎯 统一文件粘贴监听器已添加');
    }

    // 添加文件上传功能的事件监听器
    initializeFileUpload();
    
    // 添加导出回答功能的事件监听器
    initializeExportResponses();
    
    // 检查 URL 参数，如果 upload=true，显示提示信息
    if (urlParams.get('upload') === 'true') {
        // 立即显示提示，停留时间更长
        showToast('页面加载后，点击输入框的🔗图标', 8000); // 显示 8 秒
    }

    // ========== 浮动 UI 交互 ==========
    initFloatingUI();

    // 如果是从扩展图标打开的（无 query 参数），且启用了至少一个站点，自动弹出输入抽屉
    if (!hasQueryParam) {
        // 等 iframe 创建完毕后再弹，以避免初始化时序问题
        setTimeout(() => {
            const iframeCount = document.querySelectorAll('.ai-iframe').length;
            if (iframeCount === 0) {
                console.log('检测到没有启用的 AI 站点，不自动弹出输入抽屉');
                return;
            }
            const inputToggle = document.getElementById('inputToggleBtn');
            if (inputToggle) {
                inputToggle.click();
            }
        }, 800);
    }

});

// 浮动 UI 面板切换
function initFloatingUI() {
    const inputToggle = document.getElementById('inputToggleBtn');
    const settingsToggle = document.getElementById('settingsToggleBtn');
    const historyToggle = document.getElementById('historyToggleBtn');
    const inputPanel = document.getElementById('inputPanel');
    const settingsPanel = document.getElementById('settingsPanel');
    const historyPanel = document.getElementById('historyPanel');
    const floatUi = document.getElementById('floatUi');

    if (!inputToggle || !settingsToggle || !historyToggle) return;

    // 创建抽屉遮罩层
    let drawerOverlay = document.getElementById('drawerOverlay');
    if (!drawerOverlay) {
        drawerOverlay = document.createElement('div');
        drawerOverlay.id = 'drawerOverlay';
        drawerOverlay.className = 'drawer-overlay';
        document.body.appendChild(drawerOverlay);
        drawerOverlay.addEventListener('click', closeInputDrawer);
    }

    function closeInputDrawer() {
        if (inputPanel) {
            inputPanel.style.display = 'none';
            drawerOverlay.classList.remove('visible');
        }
    }

    function openInputDrawer() {
        closeAllPanels();
        inputPanel.style.display = 'flex';
        drawerOverlay.classList.add('visible');
        document.body.classList.add('has-drawer-open');
        // 更新标题和站点图标
        const iframeCount = document.querySelectorAll('.ai-iframe').length;
        const siteCount = document.getElementById('drawerSiteCount');
        if (siteCount) {
            siteCount.textContent = `${iframeCount}个`;
        }
        // 渲染当前打开的 AI 站点图标
        renderDrawerSiteIcons();
        // 打开抽屉时清空输入框
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        // 隐藏清空按钮
        const clearBtn = document.getElementById('clearInputBtn');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
        // 打开抽屉时默认展示前5个提示词模板
        showQuerySuggestions('');
    }

    // 关闭所有面板
    function closeAllPanels() {
        if (inputPanel) {
            inputPanel.style.display = 'none';
            if (drawerOverlay) drawerOverlay.classList.remove('visible');
            document.body.classList.remove('has-drawer-open');
        }
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (historyPanel) historyPanel.style.display = 'none';
    }

    // 切换面板
    function togglePanel(panel) {
        if (!panel) return;
        const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
        closeAllPanels();
        if (!isOpen) {
            panel.style.display = 'flex';
        }
    }

    // 输入按钮 - 抽屉式打开
    inputToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '';
        if (isOpen) {
            closeInputDrawer();
        } else {
            openInputDrawer();
        }
    });

    // 设置按钮
    settingsToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wasOpen = settingsPanel && settingsPanel.style.display !== 'none' && settingsPanel.style.display !== '';
        if (!wasOpen) {
            closeAllPanels();
            settingsPanel.style.display = 'flex';
            await initializeSiteSettings();
        } else {
            settingsPanel.style.display = 'none';
        }
    });

    // 历史按钮
    historyToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wasOpen = historyPanel && historyPanel.style.display !== 'none' && historyPanel.style.display !== '';
        if (!wasOpen) {
            closeAllPanels();
            historyPanel.style.display = 'flex';
            await loadHistoryList();
        } else {
            historyPanel.style.display = 'none';
        }
    });

    // 查看所有历史记录按钮
    const viewAllHistoryBtn = document.getElementById('viewAllHistoryBtn');
    if (viewAllHistoryBtn) {
        viewAllHistoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
        });
    }

    // 面板关闭按钮
    document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            if (panelId === 'inputPanel') {
                closeInputDrawer();
            } else {
                const panel = document.getElementById(panelId);
                if (panel) panel.style.display = 'none';
            }
        });
    });

    // 遮罩层 + 点击浮层外部关闭所有面板
    document.addEventListener('click', (e) => {
        if (floatUi && !floatUi.contains(e.target) && 
            inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '') {
            // 如果抽屉开着，点击外部不要关闭（由遮罩层控制）
            return;
        }
        if (floatUi && !floatUi.contains(e.target)) {
            closeAllPanels();
        }
    });

    // 阻止面板内点击事件冒泡到文档，且点击遮罩层外部关闭
    [inputPanel, settingsPanel, historyPanel].forEach(panel => {
        if (panel) {
            panel.addEventListener('click', (e) => {
                e.stopPropagation();
                if ((panel === settingsPanel || panel === historyPanel) && e.target === panel) {
                    panel.style.display = 'none';
                }
            });
        }
    });

    // ===== 新建会话按钮 =====
    const newSessionBtn = document.getElementById('newSessionBtn');
    if (newSessionBtn) {
        newSessionBtn.addEventListener('click', async () => {
            // 清空输入框
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = '';
                // 触发输入事件以重置高度
                searchInput.dispatchEvent(new Event('input'));
                searchInput.focus();
            }
            // 关闭当前历史记录上下文
            window._currentHistoryId = null;
            window._lastQuery = '';
            // 清空 iframe 容器
            const container = document.getElementById('iframes-container');
            if (container) {
                container.innerHTML = '';
            }
            // 重新加载已启用的站点
            try {
                const sites = await getDefaultSites();
                const availableSites = (sites || []).filter(site => 
                    site.enabled && 
                    site.supportIframe !== false && 
                    !site.hidden
                );
                createIframes('', availableSites);
            } catch (error) {
                console.error('新建会话失败:', error);
            }
            // 记录埋点
            trackEvent('iframe_new_session', {});
        });
    }
}

// 从存储中加载历史列表并渲染到 historyPanel
async function loadHistoryList() {
    const listBody = document.getElementById('historyListBody');
    if (!listBody) return;

    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');

        if (pkHistory.length === 0) {
            listBody.innerHTML = '<div class="history-empty">暂无历史记录</div>';
            return;
        }

        listBody.innerHTML = '';
        pkHistory.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'history-item';
            
            const queryLine = document.createElement('div');
            queryLine.className = 'history-query';
            queryLine.textContent = item.query || '(空查询)';
            
            const metaLine = document.createElement('div');
            metaLine.className = 'history-meta';
            metaLine.textContent = `${item.date || ''} · ${item.sites ? item.sites.length : 0} 个站点`;
            
            div.appendChild(queryLine);
            div.appendChild(metaLine);
            
            // 点击恢复历史记录
            div.addEventListener('click', () => {
                if (item.sites && item.sites.length > 0) {
                    // 关闭历史面板
                    const historyPanel = document.getElementById('historyPanel');
                    if (historyPanel) historyPanel.style.display = 'none';
                    
                    // 填充搜索框
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput && item.query) {
                        searchInput.value = item.query;
                        window._lastQuery = item.query;
                    }
                    
                    // 加载 iframe
                    loadHistoryIframes(item.sites);
                    
                    // 设置当前历史记录 ID
                    if (item.id) {
                        window._currentHistoryId = item.id;
                    }
                }
            });
            
            listBody.appendChild(div);
        });
    } catch (error) {
        console.error('加载历史记录失败:', error);
        listBody.innerHTML = '<div class="history-empty">加载历史记录失败</div>';
    }
}

// 显示本地文件限制警告
function showLocalFileWarning(fileName, fileExtension) {
  const warning = document.createElement('div');
  warning.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 480px;
    width: 90%;
    text-align: left;
    line-height: 1.6;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.2);
    animation: slideInScale 0.3s ease-out;
  `;
  
  // 使用通用的文件图标
  const icon = '📁';
  
  // 获取国际化消息
  const localFileDetected = chrome.i18n.getMessage('localFileDetected');
  const browserSecurityRestriction = chrome.i18n.getMessage('browserSecurityRestriction');
  const localFileSecurityMessage = chrome.i18n.getMessage('localFileSecurityMessage');
  const suggestedActions = chrome.i18n.getMessage('suggestedActions');
  const uploadFileAction = chrome.i18n.getMessage('uploadFileAction');
  const dismissWarning = chrome.i18n.getMessage('dismissWarning');
  
  warning.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <span style="font-size: 32px;">${icon}</span>
      <div>
        <div style="font-weight: 600; font-size: 16px;">${localFileDetected}</div>
        <div style="font-size: 12px; opacity: 0.9;">${fileName}</div>
      </div>
    </div>
    
    <div style="background: rgba(238, 199, 199, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
      <div style="font-size: 13px; margin-bottom: 8px;">🚫 <strong>${browserSecurityRestriction}</strong></div>
      <div style="font-size: 12px; opacity: 0.9;">
        ${localFileSecurityMessage}
      </div>
    </div>
    
    <div style="font-size: 13px; margin-bottom: 16px;">
      <div style="font-weight: 600; margin-bottom: 8px;">💡 ${suggestedActions}</div>
      <div style="margin-left: 16px;">
        <div style="margin-bottom: 4px;">• ${uploadFileAction}</div>
      </div>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="dismissWarning" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      ">${dismissWarning}</button>
    </div>
  `;
  
  // 添加 CSS 动画
  // 添加 CSS 动画 (使用 ID 校验复用，避免重复注入和频繁重绘)
  let style = document.getElementById('ai-local-file-warning-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ai-local-file-warning-style';
    style.textContent = `
      @keyframes slideInScale {
        from { 
          transform: translate(-50%, -50%) scale(0.8); 
          opacity: 0; 
        }
        to { 
          transform: translate(-50%, -50%) scale(1); 
          opacity: 1; 
        }
      }
      #dismissWarning:hover {
        background: rgba(255,255,255,0.3) !important;
        transform: translateY(-1px);
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(warning);
  
  // 点击关闭
  const dismissBtn = warning.querySelector('#dismissWarning');
  dismissBtn.addEventListener('click', () => {
    warning.style.animation = 'slideInScale 0.3s ease-out reverse';
    setTimeout(() => {
      if (warning.parentElement) {
        warning.remove();
      }
    }, 300);
  });
  
  // 8秒后自动关闭
  setTimeout(() => {
    if (warning.parentElement) {
      dismissBtn.click();
    }
  }, 8000);
}

// 检测文本内容是否为本地文件路径（真正的路径，不是简单文件名）
function isLocalFile(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const firstLine = text.trim().split('\n')[0];
  
  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }
  
  // 排除包含域名模式的内容（如www.xxx.com或domain.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }
  
  // 检测真正的文件路径模式（必须包含路径分隔符）
  const filePathPatterns = [
    // Windows 路径: C:\Users\... 或 D:\...
    /^[A-Za-z]:\\[^<>:"|?*\n]+\.[a-zA-Z0-9]+$/,
    // Unix/Linux/Mac 路径: /Users/... 或 ~/...
    /^[~\/][^<>:"|?*\n]*\.[a-zA-Z0-9]+$/,
    // UNC 路径: \\server\share\...
    /^\\\\[^<>:"|?*\n]+\\[^<>:"|?*\n]*\.[a-zA-Z0-9]+$/
  ];
  
  // 检查是否包含路径分隔符（真正的文件路径特征）
  const hasPathSeparator = firstLine.includes('/') || firstLine.includes('\\');
  const matchesPattern = filePathPatterns.some(pattern => pattern.test(firstLine));
  
  // 排除自动生成的文件名
  const isAutoGeneratedName = /^(clipboard|screenshot|download|image|file)-\d+\./i.test(firstLine);
  
  const isRealFilePath = (matchesPattern || hasPathSeparator) && !isAutoGeneratedName;
  
  if (isRealFilePath) {
    console.log('🎯 检测到真正的文件路径:', firstLine);
  }
  
  return isRealFilePath;
}

// 统一的文件粘贴处理函数
async function handleUnifiedFilePaste(event) {
  console.log('🎯 检测到粘贴事件，开始处理');
  
  try {
    // 1. 首先请求剪贴板权限
    const hasPermission = await requestClipboardPermission();
    if (!hasPermission) {
      console.log('❌ 无法访问剪贴板，权限不足，允许默认行为');
      return;
    }
    
    // 2. 检查剪贴板内容
    const clipboardData = await navigator.clipboard.read();
    console.log('剪贴板内容:', clipboardData);
    
    let hasImage = false;
    let hasText = false;
    
    for (const item of clipboardData) {
      console.log('剪贴板项目类型:', item.types);
      console.log('剪贴板项目详情:', item);
      
      // 检查是否有图片
      if (item.types.some(type => type.startsWith('image/'))) {
        hasImage = true;
        console.log('🎯 检测到图片内容');
      }
      
      // 检查是否有纯文字
      if (item.types.includes('text/plain')) {
        hasText = true;
        console.log('🎯 检测到纯文字内容');
      }
    }
    
    console.log('🎯 内容分析结果:', {
      hasText,
      hasImage
    });
    
    // 采用排除法：只允许纯文本和图片，其他都阻止
    // 1. 纯文字内容 - 直接粘贴（允许默认行为）
    if (hasText && !hasImage) {
      console.log('🎯 纯文字内容，允许默认粘贴行为');
      return;
    }
    
    // 2. 检测到图片 - 处理图片并阻止默认行为
    if (hasImage) {
      console.log('🎯 检测到图片，开始处理图片数据');
      
      for (const item of clipboardData) {
        if (item.types.some(type => type.startsWith('image/'))) {
          try {
            // 获取图片数据
            const imageType = item.types.find(type => type.startsWith('image/'));
            const imageData = await item.getType(imageType);
            
            console.log('🎯 图片数据获取成功:', {
              type: imageType,
              size: imageData.size
            });
            
            // 创建文件数据对象
            const fileObj = {
              name: `clipboard_image_${Date.now()}.${imageType.split('/')[1] || 'png'}`,
              type: imageType,
              size: imageData.size || 0,
              blob: imageData,
              data: imageData
            };
            
            // 发送到所有iframe
            await sendFileToAllIframes(fileObj);
            console.log('🎯 图片已发送到所有iframe');
            
          } catch (imageError) {
            console.log('🎯 处理图片失败:', imageError);
          }
        }
      }
      
      // 图片处理完成后，阻止默认粘贴行为
      console.log('🎯 图片处理完成，阻止默认粘贴行为');
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // 3. 其他所有情况 - 直接阻止粘贴行为（排除法）
    console.log('🎯 非纯文本非图片内容，阻止粘贴行为');
    event.preventDefault();
    event.stopPropagation();
    return;
  } catch (error) {
    console.error('🎯 粘贴处理出错:', error);
    // 出错时允许默认行为
  }
}

// 发送文件到所有iframe的简化函数
async function sendFileToAllIframes(fileObj) {
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`🎯 开始向 ${iframes.length} 个iframe发送文件`);
  console.log('🎯 文件对象详情:', {
    name: fileObj.name,
    type: fileObj.type,
    size: fileObj.size
  });
  
  // 使用逐个处理的方式，确保每个iframe有足够时间处理
  await executeFileUploadSequentially(iframes, fileObj);
  
  console.log('🎯 所有iframe文件发送完成');
}

// 逐个执行文件上传的函数
async function executeFileUploadSequentially(iframes, fileData, fallbackMode = false) {
  const totalIframes = iframes.length;
  let successCount = 0;
  let failureCount = 0;
  
  console.log(`开始逐个执行文件粘贴，共 ${totalIframes} 个 iframe`);
  
  // 显示进度提示
  showFileUploadProgress(0, totalIframes, 'starting');
  
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    
    try {
      const domain = new URL(iframe.src).hostname;
      const siteName = iframe.getAttribute('data-site');
      
      console.log(`🎯 处理第 ${i + 1}/${totalIframes} 个 iframe: ${siteName} (${domain})`);
      
      // 更新进度提示
      showFileUploadProgress(i + 1, totalIframes, 'processing', siteName);
      
      // 给 iframe 一些时间来准备接收
      await new Promise(resolve => setTimeout(resolve, 200));
      
      if (fallbackMode) {
        // 降级模式：让 iframe 自己尝试读取剪贴板
        postToIframe(iframe, {
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fallback: true,
          index: i + 1,
          total: totalIframes
        });
      } else {
        // 优先模式：使用站点特定的文件上传处理器
        postToIframe(iframe, {
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fileData: fileData, // 传递文件数据供站点处理器使用
          useSiteHandler: true, // 标记使用站点处理器
          index: i + 1,
          total: totalIframes
        });
      }
      
      // 等待一段时间让 iframe 处理完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      successCount++;
      console.log(`✅ 第 ${i + 1} 个 iframe 处理完成`);
      
    } catch (error) {
      console.error(`❌ 第 ${i + 1} 个 iframe 处理失败:`, error);
      failureCount++;
    }
    
    // 在处理间隔中等待，避免权限冲突
    if (i < iframes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.log(`🎯 逐个文件粘贴执行完成: 成功 ${successCount}/${totalIframes}, 失败 ${failureCount}`);
  
  // 显示完成状态
  showFileUploadProgress(totalIframes, totalIframes, 'completed', null, { successCount, failureCount });
  
  // 3秒后隐藏进度提示
  setTimeout(() => {
    hideFileUploadProgress();
  }, 3000);
}

// 显示文件上传进度提示
function showFileUploadProgress(current, total, status, siteName = null, result = null) {
  let progressElement = document.getElementById('file-upload-progress');
  
  if (!progressElement) {
    progressElement = document.createElement('div');
    progressElement.id = 'file-upload-progress';
    progressElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      min-width: 200px;
      animation: slideInRight 0.3s ease-out;
    `;
    
    // 添加CSS动画 (使用 ID 校验复用)
    let style = document.getElementById('ai-file-upload-progress-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ai-file-upload-progress-style';
      style.textContent = `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(progressElement);
  }
  
  let message = '';
  let emoji = '';
  
  switch (status) {
    case 'starting':
      emoji = '🚀';
      message = '开始文件粘贴...';
      break;
    case 'processing':
      emoji = '⏳';
      message = `正在处理 ${current}/${total}`;
      if (siteName) {
        message += `<br><small style="opacity: 0.8;">${siteName}</small>`;
      }
      break;
    case 'completed':
      emoji = '✅';
      if (result) {
        if (result.failureCount === 0) {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}/${total}</small>`;
        } else {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}, 失败: ${result.failureCount}</small>`;
        }
      } else {
        message = '文件粘贴完成';
      }
      break;
  }
  
  progressElement.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">${emoji}</span>
      <div>${message}</div>
    </div>
  `;
}

// 隐藏文件上传进度提示
function hideFileUploadProgress() {
  const progressElement = document.getElementById('file-upload-progress');
  if (progressElement) {
    progressElement.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => {
      if (progressElement.parentElement) {
        progressElement.remove();
      }
    }, 300);
  }
}

// 选择列数选项
function selectColumnOption(columns) {
    // 更新激活状态
    setActiveColumnOption(columns);
    // 更新布局
    updateColumns(columns);
    // 保存到存储
    chrome.storage.sync.set({ 'preferredColumns': columns });
}

// 设置激活的列数选项
function setActiveColumnOption(columns) {
    const columnOptionBtns = document.querySelectorAll('.column-option-btn');
    columnOptionBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-columns') === columns) {
            btn.classList.add('active');
        }
    });
}

// 更新列数的辅助函数
function updateColumns(columns) {
    const iframesContainer = document.getElementById('iframes-container');
    if (iframesContainer) {
        iframesContainer.dataset.columns = columns;
        document.documentElement.style.setProperty('--columns', columns);
        updateIframeBorders();
    }
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('iframe.js 收到消息:', message);
  if (message.type === 'loadIframes') {
    console.log('开始加载 iframes, 查询词:', message.query);
    const searchInput = document.getElementById('searchInput');
    searchInput.value = message.query;
    createIframes(message.query, message.sites);
  } else if (message.type === 'loadHistoryIframes') {
    console.log('开始加载历史记录 iframes:', message.sites);
    // 设置当前历史记录 ID（如果提供了）
    if (message.historyId) {
      window._currentHistoryId = message.historyId;
      console.log('设置当前历史记录 ID:', message.historyId);
    }
    loadHistoryIframes(message.sites);
  }
});

// 渲染暂无启用站点提示
function renderNoSitesPlaceholder(container) {
  if (!container) return;
  if (container.querySelector('.no-sites-placeholder')) return;
  const placeholder = document.createElement('div');
  placeholder.className = 'no-sites-placeholder';
  placeholder.innerHTML = `
    <div class="placeholder-icon" style="font-size: 64px; margin-bottom: 20px; animation: bounce 2s infinite;">🧩</div>
    <h2>请在设置中启用 AI 站点</h2>
  `;
  container.appendChild(placeholder);
}

// 处理 iframe 的创建和加载
async function createIframes(query, sites) {
  const enabledSites = sites || [];
  console.log('过滤后的站点:', enabledSites);
    
  const container = document.getElementById('iframes-container');
  if (!container) {
    console.error('未找到 iframes 容器');
    return;
  }
  
  // 保持原有的grid布局，但确保支持order属性
  // 不覆盖CSS中定义的display: grid
    
  try {
    // 每次创建均清空容器内容，以便重新载入或渲染提示
    container.innerHTML = '';
    
    // 如果一个 AI 站点都没有启用，显示友好提示
    if (enabledSites.length === 0) {
      renderNoSitesPlaceholder(container);
      return;
    }

    // 为每个启用的站点创建 iframe，传入 query 参数
    enabledSites.forEach((site, index) => {
      // 如果 query 为空,使用 site.url 的 hostname
      let url;
      if (!query) {
        try {
          url = new URL(site.url).hostname;
          url = 'https://' + url;
        } catch (e) {
          console.error('URL解析失败:', site.url);
          url = site.url;
        }
      } else {
        url = site.supportUrlQuery 
        ? site.url.replace('{query}', encodeURIComponent(query))
        : site.url;
      }
        
      console.log("即将开始调用创建单个 iframe",site.name, url)
      const iframeContainer = createSingleIframe(site.name, url, container, query);
      if (iframeContainer) {
        iframeContainer.style.order = index;
      }
    });
    updateIframeBorders();
  } catch (error) {
    console.error('创建 iframes 失败:', error);
  }
 
  // 如果有查询词，保存历史记录（只保存 ID 和 query，URL 由各 iframe 内部脚本检测后更新）
  if (query && query.trim() !== '') {
    // 立即保存历史记录，不等待 iframe 加载
    savePKHistory(query);
  }
}


// 获取 iframe 的最新 URL
// @param {HTMLIFrameElement} iframe - iframe 元素
// @param {string} siteName - 站点名称
// @param {string|null} historyId - 可选的历史记录 ID，如果提供则从历史记录中查找
// @returns {Promise<string|null>} - 返回最新的 URL，如果无法获取则返回 null
async function getIframeLatestUrl(iframe, siteName, historyId = null) {
  try {
    // 方法1: 尝试从 iframe.contentWindow.location.href 获取（如果同源）
    try {
      const currentUrl = iframe.contentWindow.location.href;
      if (currentUrl && currentUrl !== 'about:blank') {
        console.log(`从 iframe.contentWindow 获取 ${siteName} 的 URL:`, currentUrl);
        return currentUrl;
      }
    } catch (e) {
      // 跨域限制，无法直接访问
      console.log(`无法直接访问 ${siteName} iframe 的 location（可能跨域）`);
    }
    
    // 方法2: 尝试通过 postMessage 从 iframe 内部获取实际 URL
    try {
      const urlFromMessage = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', messageHandler);
          reject(new Error('获取 URL 超时'));
        }, 1000); // 1秒超时
        
        const messageHandler = async (event) => {
          // 确保消息来自目标 iframe，且 origin 可信（S1）
          if (event.source === iframe.contentWindow &&
              event.data.type === 'GET_CURRENT_URL_RESPONSE' &&
              event.data.siteName === siteName) {
            // ★ 同样先缓存实际 origin
            if (event.origin && event.origin !== window.location.origin) {
              const cachedOrigin = iframeActualOriginMap.get(iframe);
              if (cachedOrigin !== event.origin) {
                iframeActualOriginMap.set(iframe, event.origin);
                console.log('[iframe] 缓存 iframe 实际 origin (getIframeLatestUrl):', siteName, event.origin);
              }
            }
            const cachedActualOrigin = iframeActualOriginMap.get(iframe);
            const trusted = await MessagingSecurity.isTrustedMessage(event, {
              expectedSource: iframe.contentWindow,
              additionalTrustedOrigins: cachedActualOrigin ? [cachedActualOrigin] : [],
            });
            if (!trusted) {
              console.warn(`[iframe] 拒绝 ${siteName} 的 GET_CURRENT_URL_RESPONSE：来源不可信`, event.origin);
              return;
            }
            clearTimeout(timeout);
            window.removeEventListener('message', messageHandler);
            resolve(event.data.url);
          }
        };

        window.addEventListener('message', messageHandler);

        // 发送请求到 iframe（S2：使用具体 origin）
        // 同时尝试 www/non-www 变体，解决站点重定向导致的 origin 不匹配
        try {
          // 推断 iframe 的 origin 列表（同源时可直接读取；跨域时用 src 推导）
          let origins = [];
          try {
            const o = iframe.contentWindow.location.origin;
            if (o && o !== 'null' && o !== 'about:blank') origins.push(o);
          } catch (e) { /* 跨域 */ }
          if (origins.length === 0 && iframe.src) {
            try {
              const parsed = new URL(iframe.src);
              origins.push(parsed.origin);
              // www/non-www 变体
              if (parsed.hostname.startsWith('www.')) {
                origins.push(parsed.origin.replace('//www.', '//'));
              } else {
                origins.push(parsed.origin.replace('//', '//www.'));
              }
            } catch (e2) { /* ignore */ }
          }
          origins = [...new Set(origins)];
          if (origins.length > 0) {
            for (const origin of origins) {
              try {
                iframe.contentWindow.postMessage({
                  type: 'GET_CURRENT_URL',
                  siteName: siteName
                }, origin);
              } catch (e) { /* ignore delivery errors for alternative origins */ }
            }
          }
        } catch (postError) {
          clearTimeout(timeout);
          window.removeEventListener('message', messageHandler);
          reject(postError);
        }
      });
      
      if (urlFromMessage && urlFromMessage !== 'about:blank') {
        console.log(`通过 postMessage 获取 ${siteName} 的 URL:`, urlFromMessage);
        return urlFromMessage;
      }
    } catch (e) {
      console.log(`无法通过 postMessage 获取 ${siteName} 的 URL:`, e.message);
    }
    
    // 方法3: 从历史记录中获取该站点的最新 URL（如果提供了 historyId 或存在当前历史记录 ID）
    const targetHistoryId = historyId || window._currentHistoryId;
    if (targetHistoryId) {
      const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
      const historyItem = pkHistory.find(item => item.id === targetHistoryId);
      if (historyItem && historyItem.sites) {
        const siteItem = historyItem.sites.find(s => s.name === siteName);
        if (siteItem && siteItem.url) {
          console.log(`从历史记录获取 ${siteName} 的 URL:`, siteItem.url);
          return siteItem.url;
        }
      }
    }
    
    // 方法4: 使用 iframe.src 作为后备
    const srcUrl = iframe.src;
    if (srcUrl && srcUrl !== 'about:blank') {
      console.log(`使用 iframe.src 作为 ${siteName} 的 URL:`, srcUrl);
      return srcUrl;
    }
    
    console.warn(`无法获取 ${siteName} 的 URL`);
    return null;
  } catch (error) {
    console.error(`获取 ${siteName} 的 URL 失败:`, error);
    // 出错时返回 iframe.src 作为后备
    return iframe.src || null;
  }
}

// 创建单个 iframe 时添加标识
function createSingleIframe(siteName, url, container, query, keepFullUrl = false) {
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'iframe-container';
  
  // 查找容器内已有的最大 order，为其分配 maxOrder + 1
  const maxOrder = Array.from(container.querySelectorAll('.iframe-container'))
      .reduce((max, child) => Math.max(max, parseInt(child.style.order) || 0), -1);
  iframeContainer.style.order = maxOrder + 1;
  
  const iframe = document.createElement('iframe');
  iframe.className = 'ai-iframe';
  iframe.setAttribute('data-site', siteName);
  
  // 必须移除 sandbox 属性：1. 解决沙箱环境下跨域 window.parent 访问受限导致消息校验失败的问题；2. 避免沙箱阻断剪贴板读取（Paste 功能所需）。
  // iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads allow-modals';
  
  iframe.allow = 'clipboard-read; clipboard-write; microphone; camera; geolocation; autoplay; fullscreen; picture-in-picture; storage-access; web-share';
  
  // 记录是否已经处理过点击事件
  let clickHandlerAdded = false;
  
  iframe.addEventListener('load', () => {
    // 1. 设置 iframe 为不可聚焦，并在可能时预防焦点
    iframe.setAttribute('tabindex', '-1');
    const searchInput = document.getElementById('searchInput');
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.documentElement.setAttribute('tabindex', '-1');
      doc.body.setAttribute('tabindex', '-1');
      
      // 只监听焦点事件，保持搜索框焦点
      doc.addEventListener('focus', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (searchInput) searchInput.focus();
      }, true);
    } catch (error) {
      console.log('无法直接访问 iframe 内容，将通过消息通信处理焦点');
      try {
        postToIframe(iframe, {
          type: 'PREVENT_FOCUS',
          source: 'iframe-parent'
        });
      } catch (postErr) {
        console.warn('焦点预防消息发送失败:', postErr);
      }
    }
    
    // 确保搜索输入框保持焦点（仅在输入面板打开时）
    if (searchInput) {
      const inputPanel = document.getElementById('inputPanel');
      const isDrawerOpen = inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '';
      if (isDrawerOpen) {
        setTimeout(() => {
          searchInput.focus();
        }, 30);
      }
    }
    
    // 2. 检测点击事件以关闭其他悬浮框
    if (!clickHandlerAdded) {
      try {
        // 添加点击事件监听器
        iframe.contentWindow.addEventListener('click', (e) => {
          const link = e.target.closest('a');
          if (link && link.href) {
            e.preventDefault();
            window.open(link.href, '_blank');
            console.log("iframe 内点击事件处理成功")
          }
        });
        clickHandlerAdded = true;
      } catch (error) {
        console.log('无法直接添加监听器，将通过 inject.js 处理');
        try {
          postToIframe(iframe, {
            type: 'INJECT_CLICK_HANDLER',
            source: 'iframe-parent'
          });
          clickHandlerAdded = true;
        } catch (postErr) {
          console.warn('点击处理器注入消息发送失败:', postErr);
        }
      }
    }
    
    // 3. 处理查询内容（如果有的话）
    if (query) {
      console.log("iframe onload 加载完成，查询内容:", query);
      (async () => {
        const sites = await window.getDefaultSites();
        const site = sites.find(s => s.url === url || url.startsWith(s.url));
        if (site && !site.supportUrlQuery) {
          // 使用动态处理函数
          const handler = await getIframeHandler(url);
          if (handler) {
            console.log('执行动态 iframe 处理函数:', site.name);
            await handler(iframe, query);
          } else {
            console.log('未找到对应的处理函数', site.name);
          }
        }
      })();
    }
  });


  // 如果参数为空,且不要求保留完整 URL,只使用 url 的 host 部分
  if (!query && !keepFullUrl) {
    try {
      const urlObj = new URL(url);
      url = 'https://' + urlObj.hostname;
    } catch (e) {
      console.error('URL解析失败:', url);
    }
  }
  iframe.src = url;

  // 在 iframe 加载完成后，将页面滚动回顶部
  /*
  iframe.addEventListener('load', () => {
    window.scrollTo(0, 0);
  });*/
  
  // 创建 header
  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <span class="site-name">${siteName}</span>
    <div class="iframe-controls">
      <button class="fullscreen-btn" title="填充可视区">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>
        </svg>
      </button>
      <button class="open-page-btn" title="在新标签页打开"></button>
      <button class="copy-link-btn" title="复制链接">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6.5 9.5a3.5 3.5 0 0 0 5.05.45l2-2a3.5 3.5 0 0 0-4.95-4.95l-1.2 1.2"/>
          <path d="M9.5 6.5a3.5 3.5 0 0 0-5.05-.45l-2 2a3.5 3.5 0 0 0 4.95 4.95l1.2-1.2"/>
        </svg>
      </button>
      <button class="refresh-btn" title="重新加载此站点">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-5.5-5.5m0 0h3v-3m-3 3l3 3"/>
        </svg>
      </button>
      <button class="close-btn"></button>
    </div>
  `;
  
  // 添加 Chrome 浏览器特征
  iframe.setAttribute('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  
  // 添加其他常见的 Chrome 浏览器头部信息
  iframe.setAttribute('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  iframe.setAttribute('sec-ch-ua', '"Chromium";v="122", "Google Chrome";v="122"');
  iframe.setAttribute('sec-ch-ua-mobile', '?0');
  iframe.setAttribute('sec-ch-ua-platform', '"Macintosh"');
  
  
  // 组装元素
  iframeContainer.appendChild(header);
  iframeContainer.appendChild(iframe);
  container.appendChild(iframeContainer);
  
  // 渲染完成后动态更新所有 iframe 边框
  updateIframeBorders();
  
  // 添加按钮事件处理
  const openPageBtn = header.querySelector('.open-page-btn');
  const copyLinkBtn = header.querySelector('.copy-link-btn');
  const refreshBtn = header.querySelector('.refresh-btn');
  const closeBtn = header.querySelector('.close-btn');
  
  // 设置按钮的国际化标题
  const openInNewTabTitle = chrome.i18n.getMessage('openInNewTab');
  if (openInNewTabTitle) {
    openPageBtn.title = openInNewTabTitle;
  }
  
  // 打开页面按钮点击事件
  openPageBtn.onclick = async (e) => {
    e.stopPropagation();
    // 获取 iframe 的最新 URL，传递历史记录 ID（如果存在）
    const historyId = window._currentHistoryId || null;
    const iframeUrl = await getIframeLatestUrl(iframe, siteName, historyId);
    if (iframeUrl) {
      // 在新标签页打开
      chrome.tabs.create({ url: iframeUrl });
    } else {
      console.warn(`无法获取 ${siteName} 的 URL，尝试使用 iframe.src`);
      // 如果无法获取 URL，至少尝试使用 iframe.src
      if (iframe.src && iframe.src !== 'about:blank') {
        chrome.tabs.create({ url: iframe.src });
      }
    }
  };
  
  // 复制链接按钮
  copyLinkBtn.onclick = async (e) => {
    e.stopPropagation();
    const historyId = window._currentHistoryId || null;
    const iframeUrl = await getIframeLatestUrl(iframe, siteName, historyId);
    const urlToCopy = iframeUrl || iframe.src;
    if (urlToCopy && urlToCopy !== 'about:blank') {
      try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast('链接已复制: ' + siteName);
      } catch (err) {
        console.error('复制链接失败:', err);
      }
    }
  };

  // 刷新单个 iframe 按钮点击事件
  if (refreshBtn) {
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      const historyId = window._currentHistoryId || null;
      const iframeUrl = await getIframeLatestUrl(iframe, siteName, historyId);
      const targetUrl = iframeUrl || iframe.src;
      if (targetUrl && targetUrl !== 'about:blank') {
        iframe.src = targetUrl;
      } else {
        try {
          iframe.contentWindow.location.reload();
        } catch (err) {
          iframe.src = iframe.src;
        }
      }
      showToast('已重新加载站点: ' + siteName);
    };
  }

  closeBtn.onclick = async () => {
    iframeContainer.remove();
    updateIframeBorders();
    
    // 如果没有 iframe 剩余了，显示占位提示
    const mainContainer = document.getElementById('iframes-container');
    if (mainContainer && mainContainer.querySelectorAll('.iframe-container').length === 0) {
      renderNoSitesPlaceholder(mainContainer);
    }
    
    // 自动更新 chrome.storage.sync，将其设为不启用
    try {
      const { sites: existingSettings = {} } = await chrome.storage.sync.get('sites');
      const updated = { ...existingSettings };
      if (!updated[siteName]) updated[siteName] = {};
      updated[siteName].enabled = false;
      await chrome.storage.sync.set({ sites: updated });
      
      // 如果设置抽屉正打开着，让其重新初始化以保持选中状态一致
      const settingsPanel = document.getElementById('settingsPanel');
      if (settingsPanel && settingsPanel.style.display !== 'none' && settingsPanel.style.display !== '') {
        await initializeSiteSettings();
      }
    } catch (err) {
      console.error('自动保存站点设置失败:', err);
    }
  };

  const fullscreenBtn = header.querySelector('.fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.onclick = (e) => {
      e.stopPropagation();
      toggleContainerFullscreen(iframeContainer);
    };
  }

  return iframeContainer;
}

// 导出函数供其他文件使用
export { createIframes }; 


// 根据 URL 获取处理函数
function getHandlerForUrl(url) {
    try {
      // 确保 URL 是有效的
      if (!url) {
        console.error('URL 为空');
        return null;
      }
  
      // 如果 URL 不包含协议，添加 https://
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      console.log('处理URL:', url);
      const hostname = new URL(url).hostname;
      console.log('当前网站:', hostname);
      
      // 遍历所有处理函数，找到匹配的
      for (const [domain, handler] of Object.entries(siteHandlers)) {
        if (hostname.includes(domain)) {
          console.log('找到处理函数:', domain);
          console.log('处理函数:', handler);
          return handler;
        }
      }
      
      console.log('未找到对应的处理函数');
      return null;
    } catch (error) {
      console.error('URL 解析失败:', error, 'URL:', url);
      return null;
    }
  }

// 简化的 iframe 处理函数 - 只负责消息发送
async function getIframeHandler(iframeUrl) {
  try {
    // 解析 iframe URL 获取域名
    let domain;
    try {
      const urlObj = new URL(iframeUrl);
      domain = urlObj.hostname;
    } catch (e) {
      console.error('URL解析失败:', iframeUrl);
      return null;
    }
    
    // 使用 getDefaultSites 获取合并后的站点配置
    let sites = [];
    try {
      sites = await getDefaultSites();
    } catch (error) {
      console.error('获取站点配置失败:', error);
    }
    
    if (!sites || sites.length === 0) {
      console.warn('没有找到站点配置');
      return null;
    }
    
    // 查找匹配的站点
    for (const site of sites) {
      if (!site.url) continue;
      
      try {
        const siteUrl = new URL(site.url);
        const siteDomain = siteUrl.hostname;
        
        // 匹配域名
        if (domain === siteDomain || domain.includes(siteDomain) || siteDomain.includes(domain)) {
          // 返回简化的处理函数
          return async function(iframe, query, historyId) {
            try {
              // 等待页面加载
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // 向 iframe 发送统一格式的消息
              postToIframe(iframe, {
                type: 'search',
                query: query,
                domain: domain,
                historyId: historyId || null
              });
              
              console.log(`已向 ${domain} 发送搜索消息`);
            } catch (error) {
              console.error(`${domain} iframe 处理失败:`, error);
            }
          };
        }
      } catch (urlError) {
        continue;
      }
    }
    
    console.warn('未找到匹配的站点配置:', domain);
    return null;
  } catch (error) {
    console.error('获取 iframe 处理函数失败:', error);
    return null;
  }
}
// 发送后关闭输入抽屉
function closeDrawerAfterSend() {
    const inputPanel = document.getElementById('inputPanel');
    const drawerOverlay = document.getElementById('drawerOverlay');
    if (inputPanel) {
        inputPanel.style.display = 'none';
    }
    if (drawerOverlay) {
        drawerOverlay.classList.remove('visible');
    }
    document.body.classList.remove('has-drawer-open');
}

// 添加搜索按钮
document.getElementById('searchButton').addEventListener('click', () => {
  const query = document.getElementById('searchInput').value.trim();
  if (query) {
    const openedSites = getOpenedSites();
    trackEvent('iframe_search_submit', {
      query_length: query.length,
      selected_sites_count: openedSites.length,
      selected_sites: openedSites,
      trigger: 'button'
    });
    shanshuo();
    iframeFresh(query);
    // 发送后自动关闭输入抽屉
    closeDrawerAfterSend();
  }
});

// 监听输入法组合输入事件
document.getElementById('searchInput').addEventListener('compositionstart', () => {
    isComposing = true;
    console.log('🎯 输入法组合输入开始');
});

document.getElementById('searchInput').addEventListener('compositionend', () => {
    isComposing = false;
    console.log('🎯 输入法组合输入结束');
});

// 处理回车键
document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        // 如果正在使用输入法组合输入，不触发查询操作
        if (isComposing) {
            console.log('🎯 输入法组合输入中，不触发查询');
            return; // 让输入法处理回车键
        }
        
        e.preventDefault();
        const query = document.getElementById('searchInput').value.trim();
        if (query) {
            const openedSites = getOpenedSites();
            trackEvent('iframe_search_submit', {
                query_length: query.length,
                selected_sites_count: openedSites.length,
                selected_sites: openedSites,
                trigger: 'enter'
            });
            shanshuo();
            iframeFresh(query);
            // 发送后自动关闭输入抽屉
            closeDrawerAfterSend();
        }
    }
});   

// 注意：不再监听 input/focus 重新渲染 chip，chip 只在抽屉打开时渲染一次，永不消失。
// 失焦事件监听器已合并到DOMContentLoaded中的自动调整高度功能中

// 在 DOMContentLoaded 时设置按钮文案（仅设置 span 文本）
document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        const btnText = searchButton.querySelector('span');
        if (btnText) {
            const buttonText = chrome.i18n.getMessage('startCompare');
            if (buttonText) {
                btnText.textContent = buttonText;
            }
        }
    }
});

// 初始化站点设置的函数
async function initializeSiteSettings() {    
    const siteList = document.getElementById('siteListContainer');
    siteList.innerHTML = '';
    
    // 获取当前已打开的 iframe 站点 ID 数组
    const openedSites = Array.from(document.querySelectorAll('.ai-iframe'))
        .map(iframe => iframe.getAttribute('data-site'));
    
    try {
        const sites = await getDefaultSites();
        const supportedSites = sites.filter(site => 
            site.supportIframe === true && !site.hidden
        );

        // 创建容器函数
        function createSiteItem(site, isEnabled) {
            const div = document.createElement('div');
            div.className = 'site-item';
            div.setAttribute('data-site-name', site.name);
            
            // 拖拽手柄（始终存在，CSS 控制 disabled 时隐藏）
            const dragHandle = document.createElement('span');
            dragHandle.className = 'drag-handle';
            dragHandle.title = '拖拽调整顺序';
            dragHandle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
            div.appendChild(dragHandle);
            
            // 站点图标
            const siteIcon = document.createElement('img');
            siteIcon.className = 'site-icon';
            siteIcon.src = chrome.runtime.getURL('icons/' + (site.icon || 'ai/other.svg'));
            siteIcon.alt = '';
            div.appendChild(siteIcon);
            
            // 站点名称
            const nameSpan = document.createElement('span');
            nameSpan.className = 'site-name-text';
            nameSpan.textContent = site.name;
            div.appendChild(nameSpan);
            
            // 复选框
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'site-checkbox';
            checkbox.checked = isEnabled;
            div.appendChild(checkbox);
            
            checkbox.addEventListener('change', async (e) => {
                const checked = e.target.checked;
                const enabledContainer = document.getElementById('enabledSitesList');
                const disabledContainer = document.getElementById('disabledSitesList');
                const item = e.target.closest('.site-item');
                const container = document.getElementById('iframes-container');

                if (checked) {
                    // 移到已启用列表末尾
                    enabledContainer.appendChild(item);
                    // 添加拖拽功能
                    addSiteDragFunctionality(item);
                    
                    trackEvent('iframe_site_toggle', { site_name: site.name, enabled: true });
                    if (container) {
                        // 移除占位提示
                        const placeholder = container.querySelector('.no-sites-placeholder');
                        if (placeholder) {
                            placeholder.remove();
                        }
                        
                        // 尝试获取当前搜索框的查询词并格式化 URL
                        const searchInput = document.getElementById('searchInput');
                        const query = searchInput ? searchInput.value.trim() : '';
                        let url;
                        if (!query) {
                            try {
                                url = new URL(site.url).hostname;
                                url = 'https://' + url;
                            } catch (e) {
                                console.error('URL解析失败:', site.url);
                                url = site.url;
                            }
                        } else {
                            url = site.supportUrlQuery 
                            ? site.url.replace('{query}', encodeURIComponent(query))
                            : site.url;
                        }
                        
                        createSingleIframe(site.name, url, container, query);
                    }
                } else {
                    // 移到未启用列表
                    disabledContainer.appendChild(item);
                    
                    trackEvent('iframe_site_toggle', { site_name: site.name, enabled: false });
                    const iframeToRemove = document.querySelector(`[data-site="${site.name}"]`);
                    if (iframeToRemove) {
                        iframeToRemove.closest('.iframe-container').remove();
                        updateIframeBorders();
                    }
                    if (container && container.querySelectorAll('.iframe-container').length === 0) {
                        renderNoSitesPlaceholder(container);
                    }
                }
                // 更新标签计数
                updateSiteListLabels();
                // 自动保存
                try {
                    const { sites: existingSettings = {} } = await chrome.storage.sync.get('sites');
                    const updated = { ...existingSettings };
                    if (!updated[site.name]) updated[site.name] = {};
                    updated[site.name].enabled = checked;
                    await chrome.storage.sync.set({ sites: updated });
                } catch (err) {
                    console.error('自动保存站点设置失败:', err);
                }
            });
            
            return div;
        }

        function updateSiteListLabels() {
            const enabledCount = document.getElementById('enabledSitesList')?.children.length || 0;
            const disabledCount = document.getElementById('disabledSitesList')?.children.length || 0;
            const el = document.getElementById('enabledListLabel');
            const dl = document.getElementById('disabledListLabel');
            if (el) el.textContent = `已启用 (${enabledCount})`;
            if (dl) dl.textContent = `未启用 (${disabledCount})`;
        }

        // 拆分为已启用和未启用
        const enabledSites = supportedSites.filter(s => openedSites.includes(s.name));
        const disabledSites = supportedSites.filter(s => !openedSites.includes(s.name));

        // 已启用区域
        const enabledSection = document.createElement('div');
        enabledSection.className = 'site-list-enabled';
        enabledSection.innerHTML = `<div class="site-list-label" id="enabledListLabel">已启用 (${enabledSites.length})</div>`;
        const enabledContainer = document.createElement('div');
        enabledContainer.id = 'enabledSitesList';
        enabledContainer.className = 'site-items-container';
        enabledSection.appendChild(enabledContainer);

        // 未启用区域
        const disabledSection = document.createElement('div');
        disabledSection.className = 'site-list-disabled';
        disabledSection.innerHTML = `<div class="site-list-label" id="disabledListLabel">未启用 (${disabledSites.length})</div>`;
        const disabledContainer = document.createElement('div');
        disabledContainer.id = 'disabledSitesList';
        disabledContainer.className = 'site-items-container';
        disabledSection.appendChild(disabledContainer);

        // 填充已启用站点
        enabledSites.forEach(site => {
            enabledContainer.appendChild(createSiteItem(site, true));
        });

        // 填充未启用站点
        disabledSites.forEach(site => {
            disabledContainer.appendChild(createSiteItem(site, false));
        });

        siteList.appendChild(enabledSection);
        siteList.appendChild(disabledSection);

        // 为已启用和未启用的站点都添加拖拽功能
        enabledContainer.querySelectorAll('.site-item').forEach(item => {
            addSiteDragFunctionality(item);
        });
        disabledContainer.querySelectorAll('.site-item').forEach(item => {
            addSiteDragFunctionality(item);
        });
        
    } catch (error) {
        console.error('获取站点配置失败:', error);
        if (siteList) {
            siteList.innerHTML = '<div class="error-message">加载站点配置失败，请刷新页面重试</div>';
        }
    }
}

// 站点拖拽排序功能
function addSiteDragFunctionality(siteItem) {
    const dragHandle = siteItem.querySelector('.drag-handle');
    if (!dragHandle || dragHandle._dragInitialized) return;
    dragHandle._dragInitialized = true;

    let isDragging = false;
    let placeholder = null;

    dragHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;

        const rect = siteItem.getBoundingClientRect();
        const originalWidth = rect.width;
        const offsetY = e.clientY - rect.top;
        // 动态检测所属容器（启用或未启用列表）
        const container = siteItem.closest('.site-items-container');
        if (!container) return;
        const isEnabled = container.id === 'enabledSitesList';

        siteItem.classList.add('dragging');
        dragHandle.style.cursor = 'grabbing';

        placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
        container.insertBefore(placeholder, siteItem.nextSibling);

        siteItem.style.position = 'fixed';
        siteItem.style.zIndex = '1000';
        siteItem.style.opacity = '0.8';
        siteItem.style.transform = 'rotate(2deg)';
        siteItem.style.pointerEvents = 'none';
        siteItem.style.width = originalWidth + 'px';
        siteItem.style.left = rect.left + 'px';
        siteItem.style.top = (e.clientY - offsetY) + 'px';
        siteItem.dataset.offsetY = offsetY;

        const handleDrag = (ev) => {
            if (!isDragging) return;
            const offY = parseFloat(siteItem.dataset.offsetY) || 0;
            siteItem.style.top = (ev.clientY - offY) + 'px';

            // 过滤出除了被拖拽元素和占位线以外的兄弟元素
            const siblings = Array.from(container.children).filter(
                item => item !== siteItem && item !== placeholder
            );

            // 寻找应该插入在哪一个兄弟元素之前
            let insertBeforeSibling = null;
            for (const sibling of siblings) {
                const r = sibling.getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) {
                    insertBeforeSibling = sibling;
                    break;
                }
            }

            // 执行插入或追加
            if (insertBeforeSibling) {
                if (placeholder.nextSibling !== insertBeforeSibling) {
                    container.insertBefore(placeholder, insertBeforeSibling);
                }
            } else {
                if (placeholder.nextSibling !== null) {
                    container.appendChild(placeholder);
                }
            }
        };

        const handleDragEnd = async () => {
            if (!isDragging) return;
            isDragging = false;

            siteItem.classList.remove('dragging');
            dragHandle.style.cursor = 'grab';

            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.insertBefore(siteItem, placeholder);
            }

            siteItem.style.position = '';
            siteItem.style.zIndex = '';
            siteItem.style.opacity = '';
            siteItem.style.transform = '';
            siteItem.style.pointerEvents = '';
            siteItem.style.left = '';
            siteItem.style.top = '';
            siteItem.style.width = '';
            delete siteItem.dataset.offsetY;

            if (placeholder) {
                placeholder.remove();
                placeholder = null;
            }

            if (isEnabled) {
                // 已启用列表：实时重排 iframe 布局并保存顺序
                reorderIframesFromSettings();
                await saveSiteOrderFromSettings();
            } else {
                // 未启用列表：只保存顺序
                await saveDisabledSiteOrderFromSettings();
            }

            document.removeEventListener('mousemove', handleDrag);
            document.removeEventListener('mouseup', handleDragEnd);
        };

        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleDragEnd);
    });
}

// 从未启用列表保存站点排序到 storage
async function saveDisabledSiteOrderFromSettings() {
    const disabledContainer = document.getElementById('disabledSitesList');
    if (!disabledContainer) return;
    const items = Array.from(disabledContainer.children);

    try {
        const { sites: existingSettings = {} } = await chrome.storage.sync.get('sites');
        const updated = { ...existingSettings };
        items.forEach((item, index) => {
            const siteName = item.getAttribute('data-site-name');
            if (siteName) {
                if (!updated[siteName]) updated[siteName] = {};
                updated[siteName].order = index;
            }
        });
        await chrome.storage.sync.set({ sites: updated });
        console.log('未启用站点排序已保存:', items.map(i => i.getAttribute('data-site-name')));
    } catch (err) {
        console.error('保存未启用站点排序失败:', err);
    }
}

// 动态更新 iframe 的边框，避免 nth-child 在使用 CSS order 时不正确
function updateIframeBorders() {
    const iframesContainer = document.getElementById('iframes-container');
    if (!iframesContainer) return;
    
    const containers = Array.from(iframesContainer.querySelectorAll('.iframe-container'));
    // 按 CSS order 排序
    containers.sort((a, b) => {
        const orderA = parseInt(a.style.order) || 0;
        const orderB = parseInt(b.style.order) || 0;
        return orderA - orderB;
    });

    const columns = parseInt(iframesContainer.dataset.columns) || 2;

    containers.forEach((container, i) => {
        const colIndex = i % columns;
        const rowIndex = Math.floor(i / columns);

        const isFirstColumn = colIndex === 0;
        const isFirstRow = rowIndex === 0;

        container.style.setProperty('border-left', isFirstColumn ? 'none' : '1px solid #ddd', 'important');
        container.style.setProperty('border-top', isFirstRow ? 'none' : '1px solid #ddd', 'important');
    });
}

// 根据已启用列表的顺序重排 iframe 布局 (只更新 order 属性，不移动 DOM 避免 iframe 刷新)
function reorderIframesFromSettings() {
    const enabledContainer = document.getElementById('enabledSitesList');
    if (!enabledContainer) return;
    const items = Array.from(enabledContainer.children);
    const iframesContainer = document.getElementById('iframes-container');
    if (!iframesContainer) return;

    items.forEach((item, index) => {
        const siteName = item.getAttribute('data-site-name');
        const iframeContainer = iframesContainer.querySelector(
            `.iframe-container > .ai-iframe[data-site="${siteName}"]`
        )?.parentElement;
        if (iframeContainer) {
            iframeContainer.style.order = index;
        }
    });

    updateIframeBorders();

    const siteCount = document.getElementById('drawerSiteCount');
    const iframeCount = document.querySelectorAll('.ai-iframe').length;
    if (siteCount) {
        siteCount.textContent = `${iframeCount}个`;
    }
}

// 从已启用列表保存站点排序到 storage
async function saveSiteOrderFromSettings() {
    const enabledContainer = document.getElementById('enabledSitesList');
    if (!enabledContainer) return;
    const items = Array.from(enabledContainer.children);

    try {
        const { sites: existingSettings = {} } = await chrome.storage.sync.get('sites');
        const updated = { ...existingSettings };
        items.forEach((item, index) => {
            const siteName = item.getAttribute('data-site-name');
            if (siteName) {
                if (!updated[siteName]) updated[siteName] = {};
                updated[siteName].order = index;
            }
        });
        await chrome.storage.sync.set({ sites: updated });
        console.log('已启用站点排序已保存:', items.map(i => i.getAttribute('data-site-name')));
    } catch (err) {
        console.error('保存站点排序失败:', err);
    }
}

// Toast 提示函数
function showToast(message, duration = 2000) {
    // 移除已存在的 Toast，避免堆叠
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // 添加显示类名触发动画
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 定时移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}



// 初始化国际化
function initializeI18n() {
    // 处理所有带有 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            if ((element.tagName.toLowerCase() === 'input' && 
                element.type === 'text') || 
                element.tagName.toLowerCase() === 'textarea') {
                // 对于输入框和文本域，设置 placeholder
                element.placeholder = message;
            } else if (element.tagName.toLowerCase() === 'button' || 
                       element.tagName.toLowerCase() === 'img') {
                // 对于按钮和图片，设置 title 属性
                element.title = message;
            } else {
                // 对于其他元素，设置文本内容
                element.textContent = message;
            }
        }
    });
    
    // 手动设置输入框的占位符
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const placeholderMessage = chrome.i18n.getMessage('inputPlaceholder');
        if (placeholderMessage) {
            searchInput.placeholder = placeholderMessage;
        }
    }
}



// 渲染抽屉标题旁的 AI 站点图标
async function renderDrawerSiteIcons() {
  const container = document.getElementById('drawerSiteIcons');
  if (!container) return;
  container.innerHTML = '';

  const openedIframes = document.querySelectorAll('.ai-iframe');
  if (openedIframes.length === 0) return;

  try {
    const sites = await getDefaultSites();
    openedIframes.forEach(iframe => {
      const siteName = iframe.getAttribute('data-site');
      const site = sites.find(s => s.name === siteName);
      const img = document.createElement('img');
      img.className = 'drawer-site-icon';
      img.src = chrome.runtime.getURL('icons/' + (site ? (site.icon || 'ai/other.svg') : 'ai/other.svg'));
      img.alt = siteName || '';
      img.title = siteName || '';
      container.appendChild(img);
    });
  } catch (error) {
    console.error('渲染站点图标失败:', error);
  }
}

// 显示查询建议 — 默认展示前5个模板，输入时过滤
async function showQuerySuggestions(query) {
  const querySuggestions = document.getElementById('querySuggestions');

  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');

    // 按 order 排序并过滤出有效的模板
    const sortedTemplates = promptTemplates
      .filter(t => t.name && t.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // 根据输入过滤
    const trimmed = (query || '').trim().toLowerCase();
    const matched = trimmed
      ? sortedTemplates.filter(t =>
          t.name.toLowerCase().includes(trimmed) ||
          t.query.toLowerCase().includes(trimmed))
      : sortedTemplates;

    // 取前5个
    const top = matched.slice(0, 5);

    querySuggestions.innerHTML = '';

    top.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'query-suggestion-item';
      chip.textContent = t.name;
      chip.addEventListener('click', () => {
        const input = document.getElementById('searchInput');
        input.value = t.query.replace('{query}', input.value.trim());
      });
      querySuggestions.appendChild(chip);
    });

    // 更多操作按钮（编辑提示词模板）
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
    querySuggestions.appendChild(moreBtn);

  } catch (error) {
    console.error('加载提示词模板失败:', error);
  }
}





// 创建闪烁效果函数
function shanshuo() {
  // 获取搜索按钮元素
  const searchButton = document.getElementById('searchButton');
      searchButton.classList.add('active');
      
      // 200ms后移除active效果
      setTimeout(() => {
          searchButton.classList.remove('active');
      }, 200);
}



async function iframeFresh(query) {    
      window._lastQuery = query;
      if (typeof window.clearSummaryCache === 'function') {
        window.clearSummaryCache();
      }

      // 立即记录历史：不需要等待 iframe 加载完成（sites 会由后续机制更新）
      // 并返回本次 PK 的 historyId，避免后续 iframe URL 更新“写错历史记录”
      let historyId = null;
      try {
        historyId = await savePKHistory(query);
      } catch (error) {
        console.error('立即保存 PK 历史记录失败（将继续执行 PK）:', error);
      }
        
      // 获取所有 iframe
      const iframes = document.querySelectorAll('iframe');
          // 使用 getDefaultSites 获取合并后的站点配置
     
      let sites = [];
      try {
        sites = await getDefaultSites();
      } catch (error) {
        console.error('getDefaultSites 获取失败（将继续执行 PK）:', error);
        sites = [];
      }

        // 遍历每个 iframe
      iframes.forEach(iframe => {
        try {
            // 从 src 中提取域名
            const url = new URL(iframe.src);
            const domain = url.hostname;
            console.log('当前iframe网站hostname:', domain);
            // 通过 data-site 属性获取站点名
            const siteName = iframe.getAttribute('data-site');

            const siteConfig = sites.find(site => site.name === siteName);
            // 如果站点配置存在并且支持 URL 查询
            if (siteConfig && siteConfig.supportUrlQuery) {
                // 获取 URL
                const url = siteConfig.url;
                // 根据 URL 和 query 拼接新的 URL
                const newUrl = url.replace('{query}', encodeURIComponent(query));
                console.log(`为 ${siteName} iframe 生成新的 URL: ${newUrl}`);
                // URL 查询站点会直接导航：在新页面 load 后再下发 history 上下文
                if (historyId) {
                  const onLoadSendHistoryContext = () => {
                    try {
                      iframe.removeEventListener('load', onLoadSendHistoryContext);
                      postToIframe(iframe, {
                        type: 'SET_HISTORY_CONTEXT',
                        historyId,
                        siteName
                      });
                    } catch (e) {
                      // ignore
                    }
                  };
                  iframe.addEventListener('load', onLoadSendHistoryContext);
                }
                // 让 iframe 访问新的 URL
                iframe.src = newUrl;
            }
            else{
              // 使用动态处理函数
              getIframeHandler(iframe.src).then(handler => {
                if (handler) {
                  console.log(`重新处理 ${domain} iframe`, {
                      时间: new Date().toISOString(),
                      query: query
                  });
                  // 下发 history 上下文（不依赖 inject 是否处理 search 携带的 historyId）
                  if (historyId) {
                    try {
                      postToIframe(iframe, {
                        type: 'SET_HISTORY_CONTEXT',
                        historyId,
                        siteName
                      });
                    } catch (e) {
                      // ignore
                    }
                  }
                  // 调用处理函数
                  handler(iframe, query, historyId);
                } else {
                  console.log('没有找到处理函数');
                }
              }).catch(error => {
                console.error('获取处理函数失败:', error);
              });
          }
        } catch (error) {
            console.error('处理 iframe 失败:', error);
        }
    });
}



// 从历史记录加载 iframe
async function loadHistoryIframes(sites) {
  try {
    const container = document.getElementById('iframes-container');
    if (!container) {
      console.error('未找到 iframes 容器');
      return;
    }
    
    // 清空现有 iframe
    container.innerHTML = '';
    
    // 如果没有站点，显示占位提示
    if (!sites || sites.length === 0) {
      renderNoSitesPlaceholder(container);
      return;
    }
    
    // 复用 createSingleIframe 统一创建，keepFullUrl=true 保留完整会话 URL
    sites.forEach((site, index) => {
      const siteName = site.name;
      const url = site.url;
      console.log('从历史记录创建 iframe:', siteName, url);
      const iframeContainer = createSingleIframe(siteName, url, container, null, true);
      if (iframeContainer) {
        iframeContainer.style.order = index;
      }
    });
    updateIframeBorders();
    
    // 设置搜索框的值（如果有的话）
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('query');
    if (query) {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = query;
        window._lastQuery = query;
      }
    }
    
  } catch (error) {
    console.error('加载历史记录 iframe 失败:', error);
  }
}

// 检查两个历史记录是否相同（基于 query 和 urlFeature）
async function isHistoryDuplicate(newItem, existingItem, preloadedSiteConfigs = null) {
  try {
    // 首先检查 query 是否相同
    if (newItem.query.trim() !== existingItem.query.trim()) {
      return false;
    }
    
    // 获取站点配置
    let siteConfigs = preloadedSiteConfigs;
    if (!siteConfigs) {
      try {
        if (window.getDefaultSites) {
          siteConfigs = await window.getDefaultSites();
        } else if (window.siteDetector) {
          // 如果使用 siteDetector，需要获取所有站点配置
          siteConfigs = await window.siteDetector.getSites();
        }
      } catch (error) {
        console.warn('获取站点配置失败，跳过 urlFeature 对比:', error);
        return false;
      }
    }
    
    // 检查每个站点是否匹配
    const newSites = newItem.sites || [];
    const existingSites = existingItem.sites || [];
    
    // 如果站点数量不同，认为不是重复
    if (newSites.length !== existingSites.length) {
      return false;
    }
    
    // 对每个站点进行匹配检查
    for (const newSite of newSites) {
      const existingSite = existingSites.find(s => s.name === newSite.name);
      if (!existingSite) {
        return false; // 站点名称不匹配
      }
      
      // 获取该站点的配置
      const siteConfig = siteConfigs.find(s => s.name === newSite.name);
      if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
        // 如果配置了 urlFeature，需要检查 URL 是否包含相同的 urlFeature
        const urlFeature = siteConfig.historyHandler.urlFeature;
        
        // 提取新站点和现有站点的 URL pathname
        let newPathname = '';
        let existingPathname = '';
        
        try {
          if (newSite.url) {
            const newUrlObj = new URL(newSite.url);
            newPathname = newUrlObj.pathname;
          }
        } catch (e) {
          // URL 可能为空或无效，继续处理
        }
        
        try {
          if (existingSite.url) {
            const existingUrlObj = new URL(existingSite.url);
            existingPathname = existingUrlObj.pathname;
          }
        } catch (e) {
          // URL 可能为空或无效，继续处理
        }
        
        // 如果两个 URL 都包含相同的 urlFeature，认为是重复
        if (newPathname && existingPathname) {
          const newHasFeature = newPathname.includes(urlFeature);
          const existingHasFeature = existingPathname.includes(urlFeature);
          
          // 如果都包含 urlFeature，认为是重复
          if (newHasFeature && existingHasFeature) {
            continue; // 这个站点匹配，继续检查下一个
          }
          
          // 如果都不包含 urlFeature，也认为可能匹配（URL 可能还未更新）
          if (!newHasFeature && !existingHasFeature) {
            continue; // 这个站点可能匹配，继续检查下一个
          }
          
          // 一个包含一个不包含，认为不匹配
          return false;
        } else if (!newPathname && !existingPathname) {
          // 两个 URL 都为空，认为可能匹配
          continue;
        } else {
          // 一个为空一个不为空，认为不匹配
          return false;
        }
      } else {
        // 如果没有配置 urlFeature，只检查站点名称是否相同
        // 站点名称已经匹配，继续检查下一个
        continue;
      }
    }
    
    // 所有站点都匹配，认为是重复记录
    return true;
  } catch (error) {
    console.error('检查历史记录重复失败:', error);
    return false;
  }
}

// 保存 PK 历史记录
async function savePKHistory(query) {
  try {
    if (!query || query.trim() === '') {
      return null; // 如果查询为空，不保存
    }
    
    // 获取所有 iframe
    const iframes = document.querySelectorAll('.ai-iframe');
    if (iframes.length === 0) {
      return null; // 如果没有 iframe，不保存
    }
    
    // 获取站点配置，用于检查 urlFeature
    let siteConfigs = [];
    try {
      if (window.getDefaultSites) {
        siteConfigs = await window.getDefaultSites();
      } else if (window.siteDetector) {
        siteConfigs = await window.siteDetector.getSites();
      }
    } catch (error) {
      console.warn('获取站点配置失败:', error);
    }
    
    // 并行获取所有 iframe 的最新 URL，避免串行等待超时
    const urlPromises = Array.from(iframes).map(async (iframe) => {
      const siteName = iframe.getAttribute('data-site');
      if (!siteName) return { siteName: null, url: '' };
      try {
        const url = await getIframeLatestUrl(iframe, siteName);
        return { siteName, url };
      } catch (error) {
        console.warn(`获取 ${siteName} 的最新 URL 失败:`, error);
        return { siteName, url: '' };
      }
    });
    
    const urlResults = await Promise.all(urlPromises);
    const urlMap = {};
    urlResults.forEach(res => {
      if (res.siteName) {
        urlMap[res.siteName] = res.url;
      }
    });

    // 收集所有站点的名称和 URL（尝试立即获取，如果获取不到则留空，由后续消息通信更新）
    // 如果配置了 urlFeature，只保存包含 urlFeature 的 URL
    const sites = [];
    for (const iframe of iframes) {
      const siteName = iframe.getAttribute('data-site');
      if (siteName) {
        // 从 urlMap 中直接读取已获取到的最新 URL
        const url = urlMap[siteName] || '';
        
        // 获取该站点的配置
        const siteConfig = siteConfigs.find(s => s.name === siteName);
        
        // 如果配置了 urlFeature，检查 URL 是否包含它
        if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
          const urlFeature = siteConfig.historyHandler.urlFeature;
          
          // 如果 URL 不为空，检查是否包含 urlFeature
          if (url) {
            try {
              const urlObj = new URL(url);
              const pathname = urlObj.pathname;
              
              // 如果 URL 不包含 urlFeature，不保存该 URL（留空，等待后续更新）
              if (!pathname.includes(urlFeature)) {
                console.log(`⚠️ ${siteName} 的 URL 不包含 urlFeature "${urlFeature}"，不保存该 URL（等待后续更新）: ${url}`);
                sites.push({
                  name: siteName,
                  url: '', // 留空，等待后续通过消息更新
                  isFavorite: false
                });
                continue;
              }
            } catch (e) {
              console.warn(`解析 ${siteName} 的 URL 失败: ${url}`, e);
              // URL 格式错误，留空
              sites.push({
                name: siteName,
                url: '',
                isFavorite: false
              });
              continue;
            }
          } else {
            // URL 为空，留空等待后续更新
            sites.push({
              name: siteName,
              url: '',
              isFavorite: false
            });
            continue;
          }
        }
        
        // 如果未配置 urlFeature，或者 URL 包含 urlFeature，正常保存
        sites.push({
          name: siteName,
          url: url || '', // 如果获取不到 URL，留空，由后续消息通信更新
          isFavorite: false
        });
      }
    }
    
    if (sites.length === 0) {
      return null; // 如果没有有效的站点，不保存
    }
    
    // 创建历史记录项（尝试立即获取 URL，如果获取不到则由各 iframe 内部脚本检测并更新）
    let historyId = Date.now().toString();
    const historyItem = {
      id: historyId,
      query: query.trim(),
      sites: sites, // 尝试立即获取 URL，如果为空则由后续消息通信更新
      timestamp: Date.now(),
      date: new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
    
    // 从存储中获取现有历史记录
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    
    // 检查是否存在重复记录（基于 query 和 urlFeature 并传入预加载的 siteConfigs 避免在循环中读取存储）
    let existingHistoryId = null;
    for (const existingItem of pkHistory) {
      const isDuplicate = await isHistoryDuplicate(historyItem, existingItem, siteConfigs);
      if (isDuplicate) {
        existingHistoryId = existingItem.id;
        console.log('发现重复的历史记录，将更新现有记录:', existingItem.id);
        break;
      }
    }
    
    let updatedHistory;
    if (existingHistoryId) {
      // 如果存在重复记录，更新现有记录而不是创建新记录
      updatedHistory = pkHistory.map(item => {
        if (item.id === existingHistoryId) {
          // 更新现有记录的时间戳和日期
          return {
            ...item,
            timestamp: Date.now(),
            date: new Date().toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }),
            // 更新站点 URL（如果新记录的 URL 更完整）
            sites: item.sites.map(existingSite => {
              const newSite = historyItem.sites.find(s => s.name === existingSite.name);
              if (newSite && newSite.url && (!existingSite.url || existingSite.url === '')) {
                return { ...existingSite, url: newSite.url };
              }
              return existingSite;
            })
          };
        }
        return item;
      });
      // 将更新的记录移到最前面
      const updatedItem = updatedHistory.find(item => item.id === existingHistoryId);
      updatedHistory = updatedHistory.filter(item => item.id !== existingHistoryId);
      updatedHistory = [updatedItem, ...updatedHistory];
      historyId = existingHistoryId; // 使用现有记录的 ID
    } else {
      // 如果没有重复，将新记录添加到开头
      updatedHistory = [historyItem, ...pkHistory];
    }
    
    // 限制历史记录数量（从 appConfig.json 读取配置）
    let maxHistory = 100; // 默认值
    try {
      if (window.AppConfigManager) {
        const appConfig = await window.AppConfigManager.loadConfig();
        if (appConfig && appConfig.history && appConfig.history.maxCount) {
          maxHistory = appConfig.history.maxCount;
        }
      }
    } catch (error) {
      console.warn('读取历史记录数量配置失败，使用默认值 100:', error);
    }
    const limitedHistory = updatedHistory.slice(0, maxHistory);
    
    // 保存到存储
    await chrome.storage.local.set({ pkHistory: limitedHistory });
    
    // 将历史记录 ID 存储到全局变量，供 iframe 内部脚本更新 URL 时使用
    window._currentHistoryId = historyId;
    
    if (existingHistoryId) {
      console.log('PK 历史记录已更新（待 iframe 更新 URL）:', historyItem);
    } else {
      console.log('PK 历史记录已创建（待 iframe 更新 URL）:', historyItem);
    }
    return historyId;
  } catch (error) {
    console.error('保存 PK 历史记录失败:', error);
    return null;
  }
}

// 更新历史记录中特定站点的 URL
async function updateHistorySiteUrl(siteName, url, historyId) {
  try {
    // 获取站点配置，检查 urlFeature
    let siteConfigs = [];
    try {
      if (window.getDefaultSites) {
        siteConfigs = await window.getDefaultSites();
      } else if (window.siteDetector) {
        siteConfigs = await window.siteDetector.getSites();
      }
    } catch (error) {
      console.warn('获取站点配置失败:', error);
    }
    
    // 获取该站点的配置
    const siteConfig = siteConfigs.find(s => s.name === siteName);
    
    // 如果配置了 urlFeature，检查 URL 是否包含它
    if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
      const urlFeature = siteConfig.historyHandler.urlFeature;
      
      if (!url) {
        // URL 为空，不更新
        console.log(`⚠️ ${siteName} 配置了 urlFeature "${urlFeature}" 但 URL 为空，不更新历史记录`);
        return;
      }
      
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        
        // 如果 URL 不包含 urlFeature，不更新
        if (!pathname.includes(urlFeature)) {
          console.log(`⚠️ ${siteName} 的 URL 不包含 urlFeature "${urlFeature}"，不更新历史记录: ${url}`);
          return;
        }
      } catch (e) {
        console.warn(`解析 ${siteName} 的 URL 失败: ${url}`, e);
        // URL 格式错误，不更新
        return;
      }
    }
    
    // 从存储中获取历史记录
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    
    // 查找对应的历史记录
    const historyIndex = pkHistory.findIndex(item => item.id === historyId);
    if (historyIndex === -1) {
      console.warn(`未找到历史记录 ID: ${historyId}`);
      return;
    }
    
    const historyItem = pkHistory[historyIndex];
    
    // 确保 sites 数组存在
    if (!historyItem.sites) {
      historyItem.sites = [];
    }
    
    // 查找或创建站点项
    let siteItem = historyItem.sites.find(s => s.name === siteName);
    if (siteItem) {
      // 更新现有站点的 URL
      siteItem.url = url;
      // 确保 isFavorite 字段存在（兼容旧数据）
      if (siteItem.isFavorite === undefined) {
        siteItem.isFavorite = false;
      }
    } else {
      // 创建新的站点项，默认 isFavorite 为 false
      siteItem = { name: siteName, url: url, isFavorite: false };
      historyItem.sites.push(siteItem);
    }
    
    // 检查历史记录中是否至少有一个站点的 URL 包含 urlFeature
    // 如果所有站点的 URL 都不包含 urlFeature，删除该历史记录
    let hasValidUrl = false;
    for (const site of historyItem.sites) {
      const siteCfg = siteConfigs.find(s => s.name === site.name);
      if (siteCfg && siteCfg.historyHandler && siteCfg.historyHandler.urlFeature) {
        const urlFeature = siteCfg.historyHandler.urlFeature;
        if (site.url) {
          try {
            const urlObj = new URL(site.url);
            if (urlObj.pathname.includes(urlFeature)) {
              hasValidUrl = true;
              break;
            }
          } catch (e) {
            // URL 格式错误，跳过
          }
        }
      } else {
        // 如果站点未配置 urlFeature，认为该站点有效
        hasValidUrl = true;
        break;
      }
    }
    
    // 如果所有站点的 URL 都不包含 urlFeature，删除该历史记录
    if (!hasValidUrl && historyItem.sites.length > 0) {
      // 检查是否所有站点都配置了 urlFeature
      const allSitesHaveUrlFeature = historyItem.sites.every(site => {
        const siteCfg = siteConfigs.find(s => s.name === site.name);
        return siteCfg && siteCfg.historyHandler && siteCfg.historyHandler.urlFeature;
      });
      
      if (allSitesHaveUrlFeature) {
        // 所有站点都配置了 urlFeature，但没有任何站点的 URL 包含 urlFeature，删除该历史记录
        pkHistory.splice(historyIndex, 1);
        console.log(`🗑️ 历史记录 ${historyId} 的所有站点 URL 都不包含 urlFeature，删除整条记录`);
        await chrome.storage.local.set({ pkHistory: pkHistory });
        return;
      }
    }
    
    // 保存更新后的历史记录
    await chrome.storage.local.set({ pkHistory: pkHistory });
    
    console.log(`✅ 更新历史记录 ${historyId} 中 ${siteName} 的 URL:`, url);
  } catch (error) {
    console.error('更新历史记录站点 URL 失败:', error);
  }
}

// 在页面加载时调用
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  checkForSiteConfigUpdates();
  
  // 检查剪贴板权限状态
  checkClipboardPermissionStatus();
  
  // 在父页面级别阻止 iframe 获取焦点，保持搜索输入框的焦点 (全局注册一次，避免泄露)
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'IFRAME') {
      const inputPanel = document.getElementById('inputPanel');
      const isDrawerOpen = inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '';
      
      if (isDrawerOpen) {
        // 检查鼠标是否在 iframe 区域。如果不是在 iframe 区域，则是自动加载的夺焦行为
        const isMouseOverIframe = !!document.querySelector('.iframe-container:hover, #iframes-container:hover');
        if (!isMouseOverIframe) {
          e.preventDefault();
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.focus();
          }
        }
      }
    }
  }, true);

  // 焦点保护：防止输入框失焦到 iframe (例如某些 AI 网页加载时脚本强行夺焦)
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('blur', () => {
      const inputPanel = document.getElementById('inputPanel');
      const isDrawerOpen = inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '';
      if (isDrawerOpen) {
        // 延迟一瞬检查，确保 activeElement 状态已更新
        setTimeout(() => {
          if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
            // 如果鼠标不悬停在 iframe 区域上，说明是网页自动夺焦，重新获取焦点
            const isMouseOverIframe = !!document.querySelector('.iframe-container:hover, #iframes-container:hover');
            if (!isMouseOverIframe) {
              searchInput.focus();
            }
          }
        }, 50);
      }
    });
  }

  // 全局统一处理来自 iframe 的消息，避免在每次创建 iframe 时重复注册监听器
  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    // === 安全校验（S1）：仅接受来自已知 AI 站点 iframe 的消息 ===
    // 通过 event.source 匹配到已创建的 iframe，并校验其 origin 属于已知 AI 站点。
    if (!event.source) return;
    const knownIframe = Array.from(document.querySelectorAll('.ai-iframe'))
      .find(f => f.contentWindow === event.source);
    if (!knownIframe) return; // 来源不是任何已创建的 AI iframe

    // ★ 在安全校验之前，先从 event.origin 记录 iframe 的实际 origin。
    // 有些站点（如 kimi.moonshot.cn → www.kimi.com）会发生域名级重定向，
    // 导致 iframe.src 推导的 origin 与 iframe 当前页面的实际 origin 不匹配。
    // 缓存的 origin 用于两个目的：
    // 1. 供后续 postToIframe 出站消息使用正确的 targetOrigin
    // 2. 作为 additionalTrustedOrigins 传给 isTrustedMessage，信任重定向后的 origin
    if (event.origin && event.origin !== window.location.origin) {
      const cachedOrigin = iframeActualOriginMap.get(knownIframe);
      if (cachedOrigin !== event.origin) {
        iframeActualOriginMap.set(knownIframe, event.origin);
        console.log('[iframe] 缓存 iframe 实际 origin:', knownIframe.getAttribute('data-site'), event.origin);
      }
    }

    // 异步校验 origin（需查 AI 站点集合）；LINK_CLICK 可先用 source 匹配快速放行，
    // 但仍要求 origin 不是明显异常的扩展/本地源之外的可疑值。
    const cachedActualOrigin = iframeActualOriginMap.get(knownIframe);
    const trusted = await MessagingSecurity.isTrustedMessage(event, {
      expectedSource: knownIframe.contentWindow,
      additionalTrustedOrigins: cachedActualOrigin ? [cachedActualOrigin] : [],
    });
    if (!trusted) {
      console.warn('[iframe] 拒绝来自不可信来源的消息:', event.origin, event.data.type);
      return;
    }

    // 处理 Hover 状态同步
    if (event.data.type === 'IFRAME_HOVER_STATE') {
      const container = knownIframe.closest('.iframe-container');
      if (container) {
        if (event.data.hovered) {
          // 移除其他所有的 js-hovered
          document.querySelectorAll('.iframe-container.js-hovered').forEach(el => {
            el.classList.remove('js-hovered');
          });
          container.classList.add('js-hovered');
        } else {
          container.classList.remove('js-hovered');
        }
      }
      return;
    }

    // 1. 处理链接点击事件
    if (event.data.type === 'LINK_CLICK' && event.data.href) {
      // 仅允许 http(s) 协议，防止 javascript:/data: 等协议被利用
      try {
        const targetUrl = new URL(event.data.href, knownIframe.src);
        if (targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:') {
          window.open(targetUrl.href, '_blank');
        } else {
          console.warn('[iframe] 拒绝非 http(s) 协议的链接点击:', event.data.href);
        }
      } catch (e) {
        console.warn('[iframe] 链接点击解析失败:', e.message);
      }
    }

    // 2. 处理历史记录 URL 更新消息
    if (event.data.type === 'HISTORY_URL_UPDATE' && event.data.source === 'inject-script') {
      const siteName = event.data.siteName;
      const url = event.data.url;
      const historyId = event.data.historyId || window._currentHistoryId;

      if (siteName && url && historyId) {
        console.log(`📝 [全局监听] 收到 ${siteName} 的 URL 更新: ${url}，历史记录 ID: ${historyId}`);
        updateHistorySiteUrl(siteName, url, historyId);
      } else {
        console.warn('历史记录 URL 更新消息缺少必要参数:', { siteName, url, historyId });
      }
    }

    // 3. 处理双击 Alt/Option 呼出/隐藏输入弹窗消息
    if (event.data.type === 'TOGGLE_INPUT_DRAWER' && event.data.source === 'inject-script') {
      const inputToggle = document.getElementById('inputToggleBtn');
      if (inputToggle) {
        inputToggle.click();
      }
    }
  });
});


// 检查剪贴板权限状态
async function checkClipboardPermissionStatus() {
  try {
    // 检查是否支持剪贴板API
    if (!navigator.clipboard) {
      console.log('❌ 浏览器不支持剪贴板API');
      return;
    }
    
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('剪贴板权限状态:', permissionStatus.state);
    
    // 只在权限被拒绝时显示提示，避免在页面加载时打扰用户
    if (permissionStatus.state === 'denied') {
      console.log('❌ 剪贴板权限被拒绝，文件粘贴功能将不可用');
      // 延迟显示提示，避免在页面加载时立即弹出
      setTimeout(() => {
        showClipboardDeniedMessage();
      }, 3000);
    } else if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
    } else {
      console.log('🔄 剪贴板权限状态: prompt，将在用户粘贴时请求');
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
  }
}

// 显示剪贴板权限被拒绝的消息
function showClipboardDeniedMessage() {
  const message = document.createElement('div');
  message.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #f44336;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
  `;
  
  message.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span>🚫</span>
      <span style="font-weight: 600;">剪贴板权限被拒绝</span>
    </div>
    <div style="font-size: 12px; opacity: 0.9;">
      请在浏览器设置中允许剪贴板访问权限，或点击地址栏左侧的锁图标进行设置
    </div>
  `;
  
  document.body.appendChild(message);
  
  // 5秒后自动关闭
  setTimeout(() => {
    if (message.parentNode) {
      message.remove();
    }
  }, 5000);
}


// 检查站点配置更新
async function checkForSiteConfigUpdates() {
  try {
    if (window.RemoteConfigManager) {
      // 首先检查是否有未显示的更新
      const { siteConfigVersion, lastUpdateTime, updateNotificationShown } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateNotificationShown']);
      
      // 如果有更新记录且还没有显示过通知，则显示提示
      if (lastUpdateTime && !updateNotificationShown) {
        console.log('检测到配置更新，显示提示');
        showUpdateNotification();
        // 标记已显示通知，避免重复显示
        await chrome.storage.local.set({ updateNotificationShown: true });
        return;
      }
      
      // 然后检查是否有新的远程更新
      const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
      if (updateInfo && updateInfo.hasUpdate) {
        console.log('发现新版本站点配置，自动更新');
        // 自动更新配置
        await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        // 显示更新成功提示
        showUpdateNotification();
      }
    }
  } catch (error) {
    console.error('检查站点配置更新失败:', error);
  }
}

// 显示更新通知
async function showUpdateNotification() {
  try {
    // 获取更新信息
    const { siteConfigVersion, lastUpdateTime, updateHistory } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateHistory']);
    
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
      background: linear-gradient(135deg, #00a240, #008230);
    color: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    z-index: 10000;
      max-width: 350px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
      line-height: 1.5;
    cursor: pointer;
      border: 1px solid rgba(255,255,255,0.2);
      backdrop-filter: blur(10px);
      animation: slideInRight 0.3s ease-out;
    `;
    
    // 格式化更新时间
    const formatUpdateTime = (timestamp) => {
      if (!timestamp) return '刚刚';
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      if (hours < 24) return `${hours}小时前`;
      return `${days}天前`;
    };
    
    // 获取更新历史信息
    let updateInfo = '';
    if (updateHistory && updateHistory.length > 0) {
      const latestUpdate = updateHistory[updateHistory.length - 1];
      updateInfo = `
        <div style="font-size: 12px; opacity: 0.9; margin-top: 8px;">
          <div>V ${latestUpdate.version || siteConfigVersion || '未知'}</div>
          <div>${formatUpdateTime(latestUpdate.timestamp || lastUpdateTime)}</div>
          ${latestUpdate.newSites ? `<div>新增站点: ${latestUpdate.newSites}个</div>` : ''}
          ${latestUpdate.updatedSites ? `<div>更新站点: ${latestUpdate.updatedSites}个</div>` : ''}
        </div>
      `;
    } else {
      updateInfo = `
        <div style="font-size: 12px; opacity: 0.9; margin-top: 8px;">
          <div>V ${siteConfigVersion || '未知'}</div>
          <div>${formatUpdateTime(lastUpdateTime)}</div>
        </div>
      `;
    }
  
  notification.innerHTML = `
     
      <div style="font-size: 13px; opacity: 0.95; margin-bottom: 8px;">
        🆕AI站点处理规则已自动更新到最新版本
      </div>
      ${updateInfo}
      <div style="font-size: 11px; opacity: 0.8; margin-top: 12px; text-align: center; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
        🔎
      </div>
    `;
    
    // 添加CSS动画 (使用 ID 校验复用)
    let style = document.getElementById('ai-update-notification-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ai-update-notification-style';
      style.textContent = `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // 点击通知显示详细更新信息
  notification.addEventListener('click', () => {
      showDetailedUpdateInfo();
    notification.remove();
      style.remove();
    });
    
    // 添加悬停效果
    notification.addEventListener('mouseenter', () => {
      notification.style.transform = 'translateY(-2px)';
      notification.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
    });
    
    notification.addEventListener('mouseleave', () => {
      notification.style.transform = 'translateY(0)';
      notification.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
  });
  
  document.body.appendChild(notification);
  
    // 10秒后自动消失
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideInRight 0.3s ease-out reverse';
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
            style.remove();
          }
        }, 300);
      }
    }, 10000);
    
  } catch (error) {
    console.error('显示更新通知失败:', error);
    // 显示简单的 toast 提示
    showToast('配置已更新，但无法显示详细信息');
  }
}

// 显示详细更新信息
async function showDetailedUpdateInfo() {
  try {
    const { updateHistory, siteConfigVersion, lastUpdateTime } = await chrome.storage.local.get(['updateHistory', 'siteConfigVersion', 'lastUpdateTime']);
    
    // 创建模态框背景
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;
    
    // 创建模态框内容
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideInUp 0.3s ease-out;
    `;
    
    // 格式化时间
    const formatTime = (timestamp) => {
      if (!timestamp) return chrome.i18n.getMessage('unknownTime');
      const date = new Date(timestamp);
      return date.toLocaleString(chrome.i18n.getUILanguage(), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };
    
    // 生成更新历史内容
    let historyContent = '';
    if (updateHistory && updateHistory.length > 0) {
      // 去重：只显示历史记录，不重复显示当前更新信息
      const uniqueHistory = updateHistory.filter((update, index, arr) => {
        // 如果是最后一个记录且与当前版本相同，则跳过（避免重复显示）
        if (index === arr.length - 1 && update.version === siteConfigVersion) {
          return false;
        }
        return true;
      });
      
      historyContent = uniqueHistory.slice(-5).reverse().map((update, index) => `
        <div style="padding: 12px; border-left: 3px solid #00a240; margin-bottom: 12px; background: #f8f9fa; border-radius: 0 8px 8px 0;">
          <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
            V${update.version} - ${formatTime(update.timestamp)}
          </div>
          <div style="font-size: 13px; color: #666;">
            ${(() => {
              const parts = [];
              if (update.newSites > 0) {
                parts.push(chrome.i18n.getMessage('newSitesCount', [update.newSites]));
              }
              if (update.updatedSites > 0) {
                parts.push(chrome.i18n.getMessage('updatedSitesCount', [update.updatedSites]));
              }
              if (update.totalSites > 0) {
                parts.push(chrome.i18n.getMessage('totalSitesCount', [update.totalSites]));
              }
              return parts.join('，');
            })()}
          </div>
        </div>
      `).join('');
      
      // 如果没有历史记录可显示，显示空状态
      if (historyContent === '') {
        historyContent = `
          <div style="padding: 20px; text-align: center; color: #666;">
            <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
            <div>${chrome.i18n.getMessage('noUpdateHistory')}</div>
          </div>
        `;
      }
    } else {
      historyContent = `
        <div style="padding: 20px; text-align: center; color: #666;">
          <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
          <div>${chrome.i18n.getMessage('noUpdateHistory')}</div>
        </div>
      `;
    }
    
    modal.innerHTML = `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; color: #333; font-size: 16px; font-weight: 600;">📈 ${chrome.i18n.getMessage('recentUpdateRecords')}</h3>
          <button id="closeModal" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;">
            ×
          </button>
        </div>
        <div style="max-height: 300px; overflow-y: auto;">
          ${historyContent}
        </div>
      </div>
      
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="viewGitHub" style="background: #f5f5f5; border: 1px solid #ddd; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #333; transition: all 0.2s;">
          📖 ${chrome.i18n.getMessage('participateAISiteRuleDev')}
        </button>
        <button id="refreshConfig" style="background: #f5f5f5; border: 1px solid #ddd; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #333; transition: all 0.2s;">
          🔄 ${chrome.i18n.getMessage('checkUpdates')}
        </button>
      </div>
    `;
    
    // 添加CSS动画 (使用 ID 校验复用)
    let style = document.getElementById('ai-detailed-update-info-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ai-detailed-update-info-style';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // 事件处理
    const closeModal = () => {
      overlay.style.animation = 'fadeIn 0.3s ease-out reverse';
      setTimeout(() => {
        if (overlay.parentElement) {
          overlay.remove();
        }
      }, 300);
    };
    
    // 关闭按钮
    modal.querySelector('#closeModal').addEventListener('click', closeModal);
    
    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });
    
    // 查看GitHub
    modal.querySelector('#viewGitHub').addEventListener('click', () => {
      window.open('https://github.com/taoAIGC/AI-Shortcuts/blob/main/config/siteHandlers.json', '_blank');
    });
    
    // 检查更新
    modal.querySelector('#refreshConfig').addEventListener('click', async () => {
      const button = modal.querySelector('#refreshConfig');
      const originalText = button.textContent;
      button.textContent = '🔄 检查中...';
      button.disabled = true;
      
      try {
        if (window.RemoteConfigManager) {
          const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
          if (updateInfo && updateInfo.hasUpdate) {
            await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
            showToast('配置已更新到最新版本！');
            closeModal();
            // 显示新的更新通知
            setTimeout(() => showUpdateNotification(), 500);
          } else {
            showToast('已是最新版本');
          }
        } else {
          showToast('更新检查功能不可用');
        }
      } catch (error) {
        console.error('检查更新失败:', error);
        showToast('检查更新失败');
      } finally {
        button.textContent = originalText;
        button.disabled = false;
      }
    });
    
    // ESC键关闭
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);
    
  } catch (error) {
    console.error('显示详细更新信息失败:', error);
    showToast('显示更新信息失败');
  }
}

// 添加拖拽排序功能到导航列表
function addDragAndDropToNavList(navList, enabledSites) {
  let draggedElement = null;
  let draggedIndex = null;

  // 拖拽开始
  navList.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('nav-item')) {
      draggedElement = e.target;
      draggedIndex = Array.from(navList.children).indexOf(e.target);
      e.target.classList.add('dragging');
      navList.classList.add('drag-active');
      
      // 设置拖拽数据
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', e.target.outerHTML);
    }
  });

  // 拖拽结束
  navList.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('dragging');
      navList.classList.remove('drag-active');
      
      // 移除所有拖拽悬停效果
      navList.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('drag-over');
      });
      
      draggedElement = null;
      draggedIndex = null;
    }
  });

  // 拖拽悬停
  navList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const afterElement = getDragAfterElement(navList, e.clientY);
    const dragging = navList.querySelector('.dragging');
    
    if (afterElement == null) {
      navList.appendChild(dragging);
    } else {
      navList.insertBefore(dragging, afterElement);
    }
  });

  // 拖拽进入
  navList.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.target.classList.contains('nav-item') && e.target !== draggedElement) {
      e.target.classList.add('drag-over');
    }
  });

  // 拖拽离开
  navList.addEventListener('dragleave', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('drag-over');
    }
  });

  // 拖拽放置
  navList.addEventListener('drop', async (e) => {
    e.preventDefault();
    
    if (draggedElement) {
      const newIndex = Array.from(navList.children).indexOf(draggedElement);
      
      if (newIndex !== draggedIndex) {
        // 更新站点顺序
        await updateSitesOrder(enabledSites, draggedIndex, newIndex);
        
        // 重新排列iframe
        await reorderIframes(draggedIndex, newIndex);
        
        console.log('导航项顺序已更新');
      }
    }
  });
}

// 获取拖拽后的元素位置
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.nav-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 更新站点顺序
async function updateSitesOrder(enabledSites, fromIndex, toIndex) {
  // 移动数组中的元素
  const movedSite = enabledSites.splice(fromIndex, 1)[0];
  enabledSites.splice(toIndex, 0, movedSite);
  
  try {
    // 从 chrome.storage.sync 读取现有的用户设置
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
    
    // 更新拖拽后站点的order字段
    const updatedUserSettings = { ...existingUserSettings };
    enabledSites.forEach((site, index) => {
      if (!updatedUserSettings[site.name]) {
        updatedUserSettings[site.name] = {};
      }
      updatedUserSettings[site.name].order = index;
    });
    
    // 保存用户设置到 chrome.storage.sync
    await chrome.storage.sync.set({ sites: updatedUserSettings });
    
    console.log('iframe侧边栏站点顺序已保存到 sync 存储');
  } catch (error) {
    console.error('保存站点顺序失败:', error);
  }
}

// 重新排列iframe
async function reorderIframes(fromIndex, toIndex) {
  const container = document.getElementById('iframes-container');
  const iframeContainers = Array.from(container.querySelectorAll('.iframe-container'));
  
  if (iframeContainers.length > 0) {
    // 获取导航项的新顺序
    const navList = document.querySelector('.nav-list');
    const navItems = Array.from(navList.children);
    
    // 为每个iframe容器设置CSS order属性，避免移动DOM元素
    navItems.forEach((navItem, index) => {
      const siteName = navItem.textContent;
      const iframeContainer = iframeContainers.find(container => {
        const iframe = container.querySelector('iframe');
        return iframe && iframe.getAttribute('data-site') === siteName;
      });
      
      if (iframeContainer) {
        // 使用CSS order属性来控制显示顺序，不移动DOM元素
        iframeContainer.style.order = index;
      }
    });
    
    // CSS Grid布局已经支持order属性，无需额外设置
    
    console.log('iframe顺序已更新，使用CSS order属性');
  }
}

// 初始化文件上传功能
function initializeFileUpload() {
  const fileUploadButton = document.getElementById('fileUploadButton');
  const fileInput = document.getElementById('fileInput');
  
  if (!fileUploadButton || !fileInput) {
    return;
  }
  
  // 点击上传按钮触发文件选择
  fileUploadButton.addEventListener('click', () => {
    trackEvent('iframe_upload_click', {
      trigger: 'button'
    });
    fileInput.click();
  });
  
  // 文件选择变化时处理
  fileInput.addEventListener('change', handleFileSelection);
  
  console.log('🎯 文件上传功能已初始化');
}

// 初始化导出回答功能
function initializeExportResponses() {
  const exportButton = document.getElementById('exportResponsesButton');
  if (!exportButton) {
    return;
  }
  
  // 点击导出按钮显示导出模态框
  exportButton.addEventListener('click', () => {
    trackEvent('iframe_export_click', {
      trigger: 'button'
    });
    showExportModal();
  });
}

// 处理文件选择
async function handleFileSelection(event) {
  const files = event.target.files;
  
  if (!files || files.length === 0) {
    console.log('未选择文件');
    return;
  }
  
  console.log('🎯 用户选择了文件:', files.length, '个');
  
  // 处理第一个文件（暂时只支持单文件）
  const file = files[0];
  await processUploadedFile(file);
  
  // 清空input，允许重复选择同一文件
  event.target.value = '';
}

// 处理上传的文件
async function processUploadedFile(file) {
  console.log('🎯 开始处理上传的文件:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  // 文件大小检查（限制50MB）
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    showFileUploadError(`文件大小超过限制（${Math.round(maxSize / 1024 / 1024)}MB）`);
    return;
  }
  
  try {
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });
    
    // 创建文件数据对象
    const fileData = {
      type: file.type,
      blob: blob,
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
    
    console.log('🎯 文件数据准备完成:', fileData);
    
    // 调用现有的多iframe文件处理流程
    await processFileToAllIframes(fileData);
    
  } catch (error) {
    console.error('❌ 文件处理失败:', error);
    showFileUploadError('文件处理失败: ' + error.message);
  }
}

// 向所有iframe发送文件
async function processFileToAllIframes(fileData) {
  console.log('🎯 开始向所有iframe发送文件');
  
  // 获取所有 iframe 元素
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`找到 ${iframes.length} 个 iframe`);
  
  if (iframes.length === 0) {
    showFileUploadError('没有找到可用的AI站点');
    return;
  }
  
  // 调用现有的文件上传处理流程
  await executeFileUploadSequentially(iframes, fileData);
}

// 显示文件上传错误
function showFileUploadError(message) {
  const error = document.createElement('div');
  error.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
    animation: slideInScale 0.3s ease-out;
  `;
  
  error.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">❌</span>
      <span style="font-weight: 600;">文件上传失败</span>
    </div>
    <div style="font-size: 13px; opacity: 0.9;">${message}</div>
  `;
  
  document.body.appendChild(error);
  
  // 3秒后自动关闭
  setTimeout(() => {
    if (error.parentElement) {
      error.remove();
    }
  }, 3000);
}

// ============== 单个 iframe 填充浏览器可视区（伪全屏） ==============
function toggleContainerFullscreen(iframeContainer) {
  if (!iframeContainer) return;
  const isExpanded = iframeContainer.classList.toggle('expanded');
  const btn = iframeContainer.querySelector('.fullscreen-btn');
  if (btn) {
    btn.title = isExpanded ? '退出填充' : '填充可视区';
    // 切换图标：展开 → 收起
    btn.innerHTML = isExpanded
      ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/>
         </svg>`
      : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>
         </svg>`;
  }
  // 锁住背景滚动，避免 expanded 时还能滚动底层
  document.body.style.overflow = isExpanded ? 'hidden' : '';
}

// 全局 ESC 监听：处理全屏容器退出 & 输入弹窗关闭
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  
  // 1. 如果有展开的全屏 iframe 容器，退出全屏
  const expanded = document.querySelector('.iframe-container.expanded');
  if (expanded) {
    toggleContainerFullscreen(expanded);
    return;
  }
  
  // 2. 如果输入面板是打开状态，关闭输入面板
  const inputPanel = document.getElementById('inputPanel');
  if (inputPanel && inputPanel.style.display !== 'none' && inputPanel.style.display !== '') {
    const inputToggle = document.getElementById('inputToggleBtn');
    if (inputToggle) {
      inputToggle.click();
    }
  }
});

// 双击 Alt/Option 呼出/隐藏输入弹窗（在父窗口焦点的场景）
(function() {
  let lastAltPressTime = 0;
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Alt') {
      const currentTime = Date.now();
      if (currentTime - lastAltPressTime < 300) {
        const inputToggle = document.getElementById('inputToggleBtn');
        if (inputToggle) {
          inputToggle.click();
        }
        lastAltPressTime = 0;
      } else {
        lastAltPressTime = currentTime;
      }
    }
  });
})();



