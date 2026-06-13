// debug-storage.js - AI Shortcuts 存储状态测试脚本

// 全局数据存储
let globalData = {
    local: null,
    sync: null,
    config: null,
    remote: null,
    merged: null
};

// 工具函数：格式化 JSON
function formatJSON(obj) {
    if (!obj) return 'null';
    try {
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return String(obj);
    }
}

// 工具函数：计算对象统计信息
function getObjectStats(obj) {
    if (!obj || typeof obj !== 'object') {
        return { 总数: 0 };
    }

    const stats = {};
    
    if (Array.isArray(obj)) {
        stats.总数 = obj.length;
        if (obj.length > 0 && obj[0].enabled !== undefined) {
            stats.启用 = obj.filter(item => item.enabled).length;
            stats.禁用 = obj.filter(item => !item.enabled).length;
        }
    } else {
        stats.键数量 = Object.keys(obj).length;
        
        // 特殊统计
        if (obj.sites && Array.isArray(obj.sites)) {
            stats.站点总数 = obj.sites.length;
            stats.启用站点 = obj.sites.filter(site => site.enabled).length;
            stats.iframe支持 = obj.sites.filter(site => site.supportIframe).length;
        }
        
        if (obj.version) {
            stats.版本 = obj.version;
        }
    }

    return stats;
}

// 工具函数：渲染统计信息
function renderStats(stats, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = Object.entries(stats)
        .map(([key, value]) => `
            <div class="stat-item">
                <div class="stat-value">${value}</div>
                <div class="stat-label">${key}</div>
            </div>
        `).join('');
}

// 工具函数：渲染版本信息
function renderVersionInfo(data, versionElementId) {
    const versionElement = document.getElementById(versionElementId);
    if (!versionElement) return;

    if (data && data.version) {
        versionElement.style.display = 'block';
        versionElement.innerHTML = `
            <strong>版本:</strong> ${data.version}<br>
            <strong>更新时间:</strong> ${data.lastUpdated || '未知'}
        `;
    } else {
        versionElement.style.display = 'none';
    }
}

// 加载 Chrome Storage Local
async function loadLocalStorage() {
    const statusEl = document.getElementById('local-status');
    const contentEl = document.getElementById('local-content');
    
    try {
        console.log('开始加载 Chrome Storage Local...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在加载...';
        statusEl.className = 'status loading';

        if (!chrome?.storage?.local) {
            throw new Error('Chrome Storage Local API 不可用');
        }

        const result = await chrome.storage.local.get(null);
        console.log('Chrome Storage Local 数据:', result);
        globalData.local = result;

        statusEl.textContent = '✅ 加载成功';
        statusEl.className = 'status success';
        
        contentEl.textContent = formatJSON(result);
        
        const stats = getObjectStats(result);
        renderStats(stats, 'local-stats');
        
        // 显示版本信息
        if (result.remoteSiteHandlers) {
            renderVersionInfo(result.remoteSiteHandlers, 'local-version');
        } else if (result.siteConfigVersion) {
            renderVersionInfo({ version: result.siteConfigVersion }, 'local-version');
        }

        console.log('Chrome Storage Local 加载完成');

    } catch (error) {
        console.error('加载 Local Storage 失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}

// 加载 Chrome Storage Sync
async function loadSyncStorage() {
    const statusEl = document.getElementById('sync-status');
    const contentEl = document.getElementById('sync-content');
    
    try {
        console.log('开始加载 Chrome Storage Sync...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在加载...';
        statusEl.className = 'status loading';

        if (!chrome?.storage?.sync) {
            throw new Error('Chrome Storage Sync API 不可用');
        }

        const result = await chrome.storage.sync.get(null);
        console.log('Chrome Storage Sync 数据:', result);
        globalData.sync = result;

        statusEl.textContent = '✅ 加载成功';
        statusEl.className = 'status success';
        
        contentEl.textContent = formatJSON(result);
        
        const stats = getObjectStats(result);
        renderStats(stats, 'sync-stats');

        console.log('Chrome Storage Sync 加载完成');

    } catch (error) {
        console.error('加载 Sync Storage 失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}

// 加载本地 siteHandlers.json
async function loadLocalConfig() {
    const statusEl = document.getElementById('config-status');
    const contentEl = document.getElementById('config-content');
    
    try {
        console.log('开始加载本地 siteHandlers.json...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在加载...';
        statusEl.className = 'status loading';

        if (!chrome?.runtime?.getURL) {
            throw new Error('Chrome Runtime API 不可用');
        }

        const configUrl = chrome.runtime.getURL('config/siteHandlers.json');
        console.log('配置文件URL:', configUrl);
        
        const response = await fetch(configUrl);
        console.log('Fetch响应:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('本地配置数据:', data);
        globalData.config = data;

        statusEl.textContent = '✅ 加载成功';
        statusEl.className = 'status success';
        
        contentEl.textContent = formatJSON(data);
        
        const stats = getObjectStats(data);
        renderStats(stats, 'config-stats');
        
        renderVersionInfo(data, 'config-version');

        console.log('本地配置加载完成');

    } catch (error) {
        console.error('加载本地配置失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}

// 加载合并后的站点
async function loadMergedSites() {
    const statusEl = document.getElementById('merged-status');
    const contentEl = document.getElementById('merged-content');
    
    try {
        console.log('开始加载合并后的站点...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在加载...';
        statusEl.className = 'status loading';

        if (!window.getDefaultSites) {
            throw new Error('getDefaultSites 函数未找到 - 请确保 baseConfig.js 已正确加载');
        }

        const mergedSites = await window.getDefaultSites();
        console.log('合并后的站点数据:', mergedSites);
        globalData.merged = mergedSites;

        statusEl.textContent = '✅ 加载成功';
        statusEl.className = 'status success';
        
        // 创建表格显示站点名称和 enabled 状态
        if (Array.isArray(mergedSites) && mergedSites.length > 0) {
            const tableHTML = `
                <table class="sites-table">
                    <thead>
                        <tr>
                            <th>站点名称</th>
                            <th>状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${mergedSites.map(site => `
                            <tr>
                                <td>${site.name || '未知站点'}</td>
                                <td>
                                    <span class="status-badge ${site.enabled ? 'enabled' : 'disabled'}">
                                        ${site.enabled ? '✓ 启用' : '✗ 禁用'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            contentEl.innerHTML = tableHTML;
        } else {
            contentEl.innerHTML = '<div class="error-message">暂无站点数据</div>';
        }
        
        const stats = getObjectStats(mergedSites);
        renderStats(stats, 'merged-stats');

        console.log('合并后的站点加载完成');

    } catch (error) {
        console.error('加载合并后的站点失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}

// 加载远程配置
async function loadRemoteConfig() {
    const statusEl = document.getElementById('remote-status');
    const contentEl = document.getElementById('remote-content');
    
    try {
        console.log('开始加载远程配置...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在检查更新...';
        statusEl.className = 'status loading';

        if (!window.RemoteConfigManager) {
            throw new Error('RemoteConfigManager 未找到 - 请确保 baseConfig.js 已正确加载');
        }

        console.log('RemoteConfigManager URL:', window.RemoteConfigManager.configUrl);
        const updateInfo = await window.RemoteConfigManager.checkAndUpdateConfig();
        console.log('远程配置检查结果:', updateInfo);
        
        if (updateInfo.hasUpdate) {
            statusEl.textContent = '🆕 发现新版本配置';
            statusEl.className = 'status success';
            globalData.remote = updateInfo.config;
            contentEl.textContent = formatJSON(updateInfo.config);
            
            const stats = getObjectStats(updateInfo.config);
            renderStats(stats, 'remote-stats');
            
            renderVersionInfo(updateInfo.config, 'remote-version');
        } else {
            statusEl.textContent = '✅ 当前已是最新版本';
            statusEl.className = 'status success';
            
            // 尝试获取当前远程配置
            try {
                console.log('尝试获取远程配置内容...');
                const response = await fetch(window.RemoteConfigManager.configUrl);
                console.log('远程配置响应:', response.status, response.statusText);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const remoteData = await response.json();
                console.log('远程配置数据:', remoteData);
                globalData.remote = remoteData;
                contentEl.textContent = formatJSON(remoteData);
                
                const stats = getObjectStats(remoteData);
                renderStats(stats, 'remote-stats');
                
                renderVersionInfo(remoteData, 'remote-version');
            } catch (fetchError) {
                console.error('获取远程配置内容失败:', fetchError);
                contentEl.innerHTML = `<div class="error-message">
                    无法获取远程配置内容<br>
                    错误: ${fetchError.message}
                </div>`;
            }
        }

        console.log('远程配置处理完成');

    } catch (error) {
        console.error('加载远程配置失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}

// 加载历史记录
async function loadHistory() {
    const statusEl = document.getElementById('history-status');
    const contentEl = document.getElementById('history-content');
    
    try {
        console.log('开始加载历史记录...');
        statusEl.innerHTML = '<div class="loading-spinner"></div> 正在加载...';
        statusEl.className = 'status loading';

        if (!chrome?.storage?.local) {
            throw new Error('Chrome Storage Local API 不可用');
        }

        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        console.log('历史记录数据:', pkHistory);

        statusEl.textContent = '✅ 加载成功';
        statusEl.className = 'status success';
        
        contentEl.textContent = formatJSON(pkHistory);
        
        // 计算统计信息
        const stats = {};
        if (pkHistory.length > 0) {
            stats.总数 = pkHistory.length;
            const latestDate = new Date(pkHistory[0].timestamp);
            const oldestDate = new Date(pkHistory[pkHistory.length - 1].timestamp);
            stats.最新记录 = latestDate.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            stats.最旧记录 = oldestDate.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } else {
            stats.总数 = 0;
        }
        renderStats(stats, 'history-stats');

        console.log('历史记录加载完成');

    } catch (error) {
        console.error('加载历史记录失败:', error);
        statusEl.textContent = `❌ 加载失败: ${error.message}`;
        statusEl.className = 'status error';
        contentEl.innerHTML = `<div class="error-message">
            错误详情: ${error.message}<br>
            错误堆栈: ${error.stack?.slice(0, 200)}...
        </div>`;
    }
}


// 刷新全部
async function refreshAll() {
    console.log('开始刷新全部数据...');
    await Promise.all([
        loadHistory(),
        loadLocalStorage(),
        loadSyncStorage(),
        loadLocalConfig(),
        loadRemoteConfig(),
        loadMergedSites()
    ]);
    console.log('全部数据刷新完成');
}

// 清空全部存储
async function clearAll() {
    if (!confirm('⚠️ 确定要清空所有存储数据吗？这个操作不可恢复！')) {
        return;
    }

    try {
        await chrome.storage.local.clear();
        await chrome.storage.sync.clear();
        alert('✅ 存储数据已清空');
        await refreshAll();
    } catch (error) {
        alert(`❌ 清空失败: ${error.message}`);
    }
}

// 导出数据
function exportAll() {
    const exportData = {
        timestamp: new Date().toISOString(),
        local: globalData.local,
        sync: globalData.sync,
        config: globalData.config,
        remote: globalData.remote,
        merged: globalData.merged
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-shortcuts-storage-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 检查Chrome扩展环境
function checkExtensionEnvironment() {
    console.log('检查扩展环境...');
    console.log('chrome对象:', typeof chrome);
    console.log('chrome.storage:', typeof chrome?.storage);
    console.log('chrome.runtime:', typeof chrome?.runtime);
    
    if (typeof chrome === 'undefined') {
        throw new Error('Chrome API 不可用');
    }
    
    if (!chrome.storage) {
        throw new Error('Chrome Storage API 不可用');
    }
    
    if (!chrome.runtime) {
        throw new Error('Chrome Runtime API 不可用');
    }
    
    console.log('✅ Chrome扩展环境检查通过');
}

// 页面加载完成后自动加载数据
window.addEventListener('load', () => {
    console.log('页面加载完成，开始自动加载数据...');
    
    try {
        checkExtensionEnvironment();
        
        // 延迟加载，确保所有脚本都已加载完成
        setTimeout(() => {
            console.log('开始加载数据...');
            refreshAll();
        }, 1000);
        
    } catch (error) {
        console.error('环境检查失败:', error);
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; color: #dc3545;">
                <h2>❌ Chrome Extension API 不可用</h2>
                <p>错误: ${error.message}</p>
                <p style="margin-top: 20px; color: #6c757d;">
                    请确保此页面在Chrome扩展环境中运行<br>
                    可以尝试：chrome-extension://扩展ID/debug-storage.html
                </p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; border: none; background: #007bff; color: white; border-radius: 5px; cursor: pointer;">
                    重新加载
                </button>
            </div>
        `;
    }
});

// 添加键盘快捷键
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case 'r':
                e.preventDefault();
                refreshAll();
                break;
            case 'e':
                e.preventDefault();
                exportAll();
                break;
        }
    }
});

// 添加错误处理
window.addEventListener('error', (e) => {
    console.error('页面错误:', e.error);
});

// 监听存储变化
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        console.log('存储发生变化:', namespace, changes);
        // 可以选择自动刷新对应的存储
        if (namespace === 'local') {
            loadLocalStorage();
            loadHistory();
        } else if (namespace === 'sync') {
            loadSyncStorage();
        }
    });
}

// 添加按钮事件监听器
document.addEventListener('DOMContentLoaded', () => {
    // 绑定所有按钮的点击事件
    document.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        
        if (action) {
            e.preventDefault(); // 阻止默认行为
            
            switch(action) {
                case 'refreshAll':
                    refreshAll();
                    break;
                case 'clearAll':
                    clearAll();
                    break;
                case 'exportAll':
                    exportAll();
                    break;
                case 'loadLocalStorage':
                    loadLocalStorage();
                    break;
                case 'loadSyncStorage':
                    loadSyncStorage();
                    break;
                case 'loadLocalConfig':
                    loadLocalConfig();
                    break;
                case 'loadRemoteConfig':
                    loadRemoteConfig();
                    break;
                case 'loadMergedSites':
                    loadMergedSites();
                    break;
                case 'loadHistory':
                    loadHistory();
                    break;
            }
        }
        
        // 保留原有的刷新按钮逻辑（兼容）
        if (e.target.textContent === '刷新' || e.target.classList.contains('refresh-btn')) {
            const column = e.target.closest('.column');
            const columnClass = column ? column.classList[1] : '';
            const action = e.target.getAttribute('data-action');
            if (action) {
                // data-action 已在上方处理
            } else switch(columnClass) {
                case 'column-1':
                    loadLocalStorage();
                    break;
                case 'column-2':
                    loadSyncStorage();
                    break;
                case 'column-3':
                    loadLocalConfig();
                    break;
                case 'column-4':
                    loadRemoteConfig();
                    break;
                case 'column-5':
                    loadMergedSites();
                    break;
                case 'column-6':
                    loadHistory();
                    break;
            }
        }
    });
});

// 全局暴露函数供HTML内联使用
window.refreshAll = refreshAll;
window.clearAll = clearAll;
window.exportAll = exportAll;
window.loadLocalStorage = loadLocalStorage;
window.loadSyncStorage = loadSyncStorage;
window.loadLocalConfig = loadLocalConfig;
window.loadRemoteConfig = loadRemoteConfig;
window.loadMergedSites = loadMergedSites;
window.loadHistory = loadHistory;
