let currentButtonConfig = null;
// 系统默认站点设置将通过 getDefaultSites() 动态获取


// 加载保存的配置
async function loadConfig() {
  // 直接从 initializeSiteConfigs 中处理站点配置加载
  initializeSiteConfigs();

  chrome.storage.sync.get('buttonConfig', function(data) {
    currentButtonConfig = data.buttonConfig || window.defaultButtonConfig;
    console.log('加载的buttonConfig:', currentButtonConfig);
    initializeButtonConfigs();
  });
}

// 获取翻译文本
function getMessage(key, substitutions = null) {
  return chrome.i18n.getMessage(key, substitutions);
}

// 显示吐司提示
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.classList.remove('show');
  void toast.offsetWidth;
  
  toast.textContent = message;
  toast.classList.add('show');
  
  if (toast.timeoutId) {
    clearTimeout(toast.timeoutId);
  }
  
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// 初始化页面文本
function initializeI18n() {
  // 更新页面标题
  document.title = chrome.i18n.getMessage("appName");

  
  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });
}

// 显示消息
function showMessage(message, isError = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isError ? 'error' : 'success'}`;
  messageElement.textContent = message;
  
  document.body.appendChild(messageElement);
  
  setTimeout(() => {
    messageElement.remove();
  }, 3000);
}

// 初始化快捷入口配置
async function initializeButtonConfigs() {
  try {
    // 获取存储的按钮配置
    let { buttonConfig } = await chrome.storage.sync.get(['buttonConfig']);
    
    // 从 appConfig.json 获取默认配置
    const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
    
    let currentConfig = buttonConfig || defaultButtonConfig;

    console.log('初始配置:', currentConfig);

    // 配置项定义
    const configItems = [
      { id: 'floatButtonSwitch', configKey: 'floatButton', name: chrome.i18n.getMessage("floatButton") },
      { id: 'selectionSearchSwitch', configKey: 'selectionSearch', name: chrome.i18n.getMessage("selectionSearch") },
      { id: 'contextMenuSwitch', configKey: 'contextMenu', name: chrome.i18n.getMessage("contextMenu") },
      { id: 'searchEngineSwitch', configKey: 'searchEngine', name: chrome.i18n.getMessage("searchEngine") }
    ];

    const buttonContainer = document.getElementById('buttonSiteConfigs');
    if (!buttonContainer) return;
    
    buttonContainer.innerHTML = '';

    configItems.forEach(item => {
      const configDiv = document.createElement('div');
      configDiv.className = 'site-config';
      configDiv.innerHTML = `
        <div class="site-header">
          <span class="site-name-display">${item.name}</span>
          <label class="switch">
            <input type="checkbox" id="${item.id}"
              ${currentConfig[item.configKey] ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
      `;
      buttonContainer.appendChild(configDiv);

      const switchElement = configDiv.querySelector(`#${item.id}`);
      switchElement.addEventListener('change', async (e) => {
        // 每次更改前先获取最新的配置
        const { buttonConfig: latestConfig } = await chrome.storage.sync.get(['buttonConfig']);
        const updatedConfig = {
          ...(latestConfig || currentConfig),  // 使用最新的配置作为基础
          [item.configKey]: e.target.checked
        };
        
        await chrome.storage.sync.set({ buttonConfig: updatedConfig });
        // 更新当前配置
        currentConfig = updatedConfig;
        console.log(`已更新${item.name}配置:`, updatedConfig);
        if (chrome.runtime.lastError) {
          showToast(chrome.i18n.getMessage("saveFailed", [chrome.runtime.lastError.message]));
          return;
        }
        showToast(chrome.i18n.getMessage("saveSuccess"));
        
      });
    });

  } catch (error) {
    console.error('初始化按钮配置失败:', error);
  }
}

async function initializeSiteConfigs() {
  try {
    // 使用 getDefaultSites 函数获取合并后的站点配置
    const sites = await getDefaultSites();
    console.log('获取到的合并站点数组:', sites);

    // 过滤非隐藏的站点，并分成两组（已经按order排序了）
    const visibleSites = sites.filter(site => site.hidden === false);
    const standaloneSites = visibleSites.filter(site => !site.supportIframe);
    const collectionSites = visibleSites.filter(site => site.supportIframe);
    

    // 3. 获取两个容器
    const standaloneContainer = document.getElementById('standaloneSiteConfigs');
    const collectionContainer = document.getElementById('collectionSiteConfigs');
    
    // 4. 清空容器
    standaloneContainer.innerHTML = '';
    collectionContainer.innerHTML = '';

    // 5. 渲染独立模式站点
    standaloneSites.forEach((site, index) => {
      const siteDiv = document.createElement('div');
      siteDiv.className = 'site-config';
      siteDiv.setAttribute('data-site-name', site.name);
      siteDiv.innerHTML = `
        <div class="site-header">
          <div class="drag-handle" title="拖拽调整顺序"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
          <label class="switch">
            <input type="checkbox" class="enable-toggle"
              ${site.enabled ? 'checked' : ''} 
              data-index="${index}"
              data-mode="standalone">
            <span class="slider round"></span>
          </label>
          <img class="site-icon" src="${chrome.runtime.getURL('icons/' + (site.icon || 'ai/other.svg'))}" alt="">
          <span class="site-name-display">${site.name}</span>
        </div>
      `;
      standaloneContainer.appendChild(siteDiv);
      
      // 添加拖拽功能
      addDragFunctionality(siteDiv, site.name, 'standalone');
    });

    // 6. 渲染合集模式站点
    collectionSites.forEach((site, index) => {
      const siteDiv = document.createElement('div');
      siteDiv.className = 'site-config';
      siteDiv.setAttribute('data-site-name', site.name);
      siteDiv.innerHTML = `
        <div class="site-header">
          <div class="drag-handle" title="拖拽调整顺序"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
          <label class="switch">
            <input type="checkbox" class="enable-toggle"
              ${site.enabled ? 'checked' : ''} 
              data-index="${index}"
              data-mode="collection">
            <span class="slider round"></span>
          </label>
          <img class="site-icon" src="${chrome.runtime.getURL('icons/' + (site.icon || 'ai/other.svg'))}" alt="">
          <span class="site-name-display">${site.name}</span>
        </div>
      `;
      collectionContainer.appendChild(siteDiv);
      
      // 添加拖拽功能
      addDragFunctionality(siteDiv, site.name, 'collection');
    });

    // 7. 添加切换事件监听器
    document.querySelectorAll('.enable-toggle').forEach(toggle => {
      toggle.addEventListener('change', async function() {
        try {
          const siteName = this.closest('.site-config').querySelector('.site-name-display').textContent;
          
          // 获取当前的用户设置
          const { siteSettings = {}, sites: userSiteSettings = {} } = await chrome.storage.sync.get(['siteSettings', 'sites']);
          
          // 更新用户设置
          siteSettings[siteName] = this.checked;
          
          // 更新用户站点设置
          if (!userSiteSettings[siteName]) {
            userSiteSettings[siteName] = {};
          }
          userSiteSettings[siteName].enabled = this.checked;
          
          // 保存用户设置到 sync storage
          await chrome.storage.sync.set({ 
            siteSettings,
            sites: userSiteSettings
          });
          
          console.log('保存的站点设置:', siteName, this.checked);

          if (chrome.runtime.lastError) {
            showToast(chrome.i18n.getMessage("saveFailed", [chrome.runtime.lastError.message]));
            return;
          }
          showToast(chrome.i18n.getMessage("saveSuccess"));
        } catch (error) {
          console.error('保存设置失败:', error);
          showToast('保存失败');
          // 恢复复选框状态
          this.checked = !this.checked;
        }
      });
    });

  } catch (error) {
    console.error('初始化站点配置失败:', error);
    showToast('加载配置失败');
  }
}
// 拖拽功能实现
function addDragFunctionality(siteDiv, siteName, mode) {
  const dragHandle = siteDiv.querySelector('.drag-handle');
  let isDragging = false;
  let dragStartY = 0;
  let initialIndex = 0;
  let placeholder = null;

  // 设置拖拽手柄样式
  dragHandle.style.cursor = 'grab';
  dragHandle.style.userSelect = 'none';

  // 鼠标按下事件
  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    
    // 获取元素当前位置
    const rect = siteDiv.getBoundingClientRect();
    dragStartY = e.clientY;
    
    // 计算鼠标相对于元素的位置偏移
    const offsetY = e.clientY - rect.top;
    
    // 获取当前容器在父容器中的索引
    const container = mode === 'standalone' 
      ? document.getElementById('standaloneSiteConfigs')
      : document.getElementById('collectionSiteConfigs');
    const containers = Array.from(container.children);
    initialIndex = containers.indexOf(siteDiv);
    
    // 添加拖拽样式
    siteDiv.classList.add('dragging');
    dragHandle.style.cursor = 'grabbing';
    
    // 创建占位符
    placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = siteDiv.offsetHeight + 'px';
    container.insertBefore(placeholder, siteDiv.nextSibling);
    
    // 设置拖拽元素的样式
    siteDiv.style.position = 'fixed';
    siteDiv.style.zIndex = '1000';
    siteDiv.style.opacity = '0.8';
    siteDiv.style.transform = 'rotate(2deg)';
    siteDiv.style.pointerEvents = 'none';
    siteDiv.style.width = siteDiv.offsetWidth + 'px';
    siteDiv.style.left = rect.left + 'px';
    siteDiv.style.top = (e.clientY - offsetY) + 'px';
    
    // 存储偏移量供后续使用
    siteDiv.dataset.offsetY = offsetY;
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
  });

  // 拖拽过程中的处理
  function handleDrag(e) {
    if (!isDragging) return;
    
    // 获取存储的偏移量
    const offsetY = parseFloat(siteDiv.dataset.offsetY) || 0;
    
    // 更新拖拽元素位置，让元素跟随鼠标
    siteDiv.style.top = (e.clientY - offsetY) + 'px';
    
    // 检测是否应该移动占位符
    const container = mode === 'standalone' 
      ? document.getElementById('standaloneSiteConfigs')
      : document.getElementById('collectionSiteConfigs');
    const containers = Array.from(container.children).filter(child => 
      child !== placeholder && child.classList.contains('site-config')
    );
    
    let newIndex = initialIndex;
    for (let i = 0; i < containers.length; i++) {
      const rect = containers[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        newIndex = i;
        break;
      }
      newIndex = i + 1;
    }
    
    // 移动占位符到新位置
    if (newIndex !== initialIndex) {
      if (newIndex >= containers.length) {
        container.appendChild(placeholder);
      } else {
        container.insertBefore(placeholder, containers[newIndex]);
      }
      initialIndex = newIndex;
    }
  }

  // 拖拽结束处理
  function handleDragEnd(e) {
    if (!isDragging) return;
    
    isDragging = false;
    
    // 移除拖拽样式
    siteDiv.classList.remove('dragging');
    dragHandle.style.cursor = 'grab';
    
    // 将元素移动到占位符位置
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(siteDiv, placeholder);
    }
    
    // 恢复拖拽元素样式
    siteDiv.style.position = '';
    siteDiv.style.zIndex = '';
    siteDiv.style.opacity = '';
    siteDiv.style.transform = '';
    siteDiv.style.pointerEvents = '';
    siteDiv.style.left = '';
    siteDiv.style.top = '';
    siteDiv.style.width = '';
    
    // 清理存储的偏移量
    delete siteDiv.dataset.offsetY;
    
    // 移除占位符
    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
    
    // 更新站点顺序
    updateSiteOrder(mode);
    
    // 移除事件监听器
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', handleDragEnd);
  }
}

// 更新站点顺序
async function updateSiteOrder(mode) {
  const container = mode === 'standalone' 
    ? document.getElementById('standaloneSiteConfigs')
    : document.getElementById('collectionSiteConfigs');
  const containers = Array.from(container.children).filter(child => 
    child.classList.contains('site-config')
  );
  
  // 获取新的顺序
  const newOrder = containers.map(container => {
    return container.getAttribute('data-site-name');
  }).filter(name => name !== null);
  
  console.log(`${mode}模式新的站点顺序:`, newOrder);
  
  // 更新存储中的站点顺序
  try {
    // 从 chrome.storage.sync 读取现有的用户设置
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
    
    // 更新拖拽后站点的order字段
    const updatedUserSettings = { ...existingUserSettings };
    newOrder.forEach((siteName, index) => {
      if (!updatedUserSettings[siteName]) {
        updatedUserSettings[siteName] = {};
      }
      updatedUserSettings[siteName].order = index;
    });
    
    // 保存用户设置到 chrome.storage.sync
    await chrome.storage.sync.set({ sites: updatedUserSettings });
    
    console.log(`${mode}模式站点顺序已更新`);
    
    showToast(chrome.i18n.getMessage("saveSuccess"));

    
  } catch (error) {
    console.error('更新站点顺序失败:', error);
    showToast('保存顺序失败');
  }
}

// 初始化 Tab 导航功能
function initializeNavigation() {
  const tabLinks = document.querySelectorAll('.tab-link');
  const sections = document.querySelectorAll('.settings-section');

  function switchTab(sectionId) {
    // 移除所有激活状态
    tabLinks.forEach(link => link.classList.remove('active'));
    sections.forEach(section => section.style.display = 'none');

    // 激活目标 tab 和 section
    const activeLink = document.querySelector(`.tab-link[data-section="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.style.display = 'block';

    // 更新 URL hash
    window.history.pushState(null, null, `#${sectionId}`);
  }

  // 点击 tab 切换
  tabLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.getAttribute('data-section');
      if (section) switchTab(section);
    });
  });

  return switchTab;
}

// 初始化规则信息
async function initializeRuleInfo() {
  try {
    let timeDisplay = chrome.i18n.getMessage('ruleUpdateTimePrefix');
    
    // 获取存储中的版本时间
    let storageTime = null;
    const { siteConfigVersion } = await chrome.storage.local.get('siteConfigVersion');
    if (siteConfigVersion) {
      try {
        const timestamp = parseInt(siteConfigVersion);
        if (!isNaN(timestamp)) {
          storageTime = new Date(timestamp);
          console.log('存储中的时间:', storageTime);
        }
      } catch (error) {
        console.error('解析存储时间失败:', error);
      }
    }
    
    // 获取本地配置文件的时间
    let localTime = null;
    try {
      const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
      const localConfig = await response.json();
      if (localConfig.lastUpdated) {
        localTime = new Date(localConfig.lastUpdated);
        console.log('本地配置文件时间:', localTime);
      }
    } catch (error) {
      console.error('读取本地配置文件失败:', error);
    }
    
    // 比较两个时间，取较大值
    let latestTime = null;
    if (storageTime && localTime) {
      latestTime = storageTime > localTime ? storageTime : localTime;
      console.log('取较大时间:', latestTime);
    } else if (storageTime) {
      latestTime = storageTime;
      console.log('使用存储时间:', latestTime);
    } else if (localTime) {
      latestTime = localTime;
      console.log('使用本地时间:', latestTime);
    }
    
    // 格式化显示
    if (latestTime) {
      const year = latestTime.getFullYear();
      const month = String(latestTime.getMonth() + 1).padStart(2, '0');
      const day = String(latestTime.getDate()).padStart(2, '0');
      const hours = String(latestTime.getHours()).padStart(2, '0');
      const minutes = String(latestTime.getMinutes()).padStart(2, '0');
      const seconds = String(latestTime.getSeconds()).padStart(2, '0');
      timeDisplay = `${chrome.i18n.getMessage('ruleUpdateTimePrefix')}${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } else {
      timeDisplay = chrome.i18n.getMessage('ruleUpdateTimeNotAvailable');
    }
    
    // 更新显示
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = timeDisplay;
    }
    
    // 添加参与规则开发按钮的点击事件
    const devButton = document.getElementById('participateRuleDev');
    if (devButton) {
      devButton.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'https://github.com/ai-group-chat/ai-group-chat/blob/main/config/siteHandlers.json'
        });
      });
    }
    
  } catch (error) {
    console.error('初始化规则信息失败:', error);
    
    // 显示错误信息
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = chrome.i18n.getMessage('ruleUpdateTimeError');
    }
  }
}

// 初始化禁用网站管理
async function initializeDisabledSites() {
  const container = document.getElementById('disabledSitesList');
  if (!container) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    if (disabledSites.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; color: #999; padding: 40px;">
          <p>${chrome.i18n.getMessage('noDisabledSites')}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = disabledSites.map(site => `
      <div class="disabled-site-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 8px;">
        <div class="site-info">
          <span class="site-domain" style="font-weight: 500; color: #333;">${site}</span>
          <span class="site-note" style="color: #666; font-size: 12px; margin-left: 8px;">悬浮球已禁用</span>
        </div>
        <div class="site-actions">
          <button class="enable-btn" data-domain="${site}" style="padding: 6px 12px; background: #00a240; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
            重新启用
          </button>
        </div>
      </div>
    `).join('');

    // 添加事件监听器
    container.addEventListener('click', handleDisabledSiteAction);
    
  } catch (error) {
    console.error('加载禁用网站列表失败:', error);
    container.innerHTML = `
      <div class="error-state" style="text-align: center; color: #f44336; padding: 40px;">
        <p>加载失败，请刷新页面重试</p>
      </div>
    `;
  }
}

// 处理禁用网站操作
async function handleDisabledSiteAction(event) {
  const target = event.target;
  if (!target.matches('.enable-btn')) return;
  
  const domain = target.getAttribute('data-domain');
  if (!domain) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    // 重新启用网站 - 从禁用列表中移除
    const updatedSites = disabledSites.filter(site => site !== domain);
    await chrome.storage.sync.set({ disabledSites: updatedSites });
    
    showToast(`已重新启用 ${domain} 的悬浮球`);

    // 重新加载列表
    initializeDisabledSites();
    
  } catch (error) {
    console.error('操作失败:', error);
    showToast('操作失败，请重试');
  }
}

// ============================
// 提示词模板管理功能
// ============================

// 当前编辑的模板ID
let currentEditingTemplateId = null;

// 初始化提示词模板管理
async function initializePromptTemplates() {
  try {
    // 确保有默认模板
    await ensureDefaultTemplates();
    
    // 加载并显示模板列表
    await loadTemplatesList();
    
    // 绑定事件监听器
    bindTemplateEvents();
    
    console.log('提示词模板管理初始化完成');
  } catch (error) {
    console.error('初始化提示词模板失败:', error);
  }
}

// 确保存在默认模板
async function ensureDefaultTemplates() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    
    // 如果没有模板，提醒用户模板将由系统自动初始化
    if (promptTemplates.length === 0) {
      console.log('提示词模板为空，将依赖系统自动初始化');
      
      // 触发 background.js 的初始化（如果还没有运行）
      try {
        await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
      } catch (error) {
        console.log('无法发送初始化消息，background 可能已处理:', error);
      }
    }
  } catch (error) {
    console.error('检查默认模板失败:', error);
  }
}

// 加载模板列表
async function loadTemplatesList() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const container = document.getElementById('templatesList');
    
    if (!container) return;
    
    // 按order排序
    const sortedTemplates = promptTemplates.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: #666; padding: 40px;">
          <p>暂无提示词模板</p>
          <p style="font-size: 14px;">点击上方"添加新模板"按钮开始创建</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item site-config" data-template-id="${template.id}" style="
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        transition: box-shadow 0.2s ease;
      ">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
            <div class="drag-handle" title="拖拽调整顺序" style="cursor: grab; color: #999; font-size: 14px; user-select: none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
            <h4 style="margin: 0; font-size: 16px; color: #333;">${template.name}</h4>
            ${template.isDefault ? '<span style="background: #e8f5e8; color: #00a240; padding: 2px 6px; border-radius: 3px; font-size: 12px;">默认</span>' : ''}
          </div>
          <div style="display: flex; gap: 8px; flex-shrink: 0;">
            <button class="edit-template-btn" data-template-id="${template.id}" style="
              background: #f5f5f5;
              border: 1px solid #ddd;
              border-radius: 4px;
              padding: 6px 12px;
              cursor: pointer;
              font-size: 12px;
              color: #666;
            " data-i18n="editButton">编辑</button>
            ${!template.isDefault ? `<button class="delete-template-btn" data-template-id="${template.id}" style="
              background: #ffebee;
              border: 1px solid #ffcdd2;
              border-radius: 4px;
              padding: 6px 12px;
              cursor: pointer;
              font-size: 12px;
              color: #d32f2f;
            " data-i18n="deleteButton">删除</button>` : ''}
          </div>
        </div>
        <div style="
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 12px;
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
          font-size: 12px;
          color: #495057;
          word-break: break-word;
          margin-left: 28px;
        ">${template.query}</div>
      </div>
    `).join('');
    
    // 添加hover效果和拖拽功能
    container.querySelectorAll('.template-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.boxShadow = 'none';
      });
      addTemplateDragFunctionality(item);
    });
    
  } catch (error) {
    console.error('加载模板列表失败:', error);
  }
}

// 绑定模板相关事件
function bindTemplateEvents() {
  // 添加模板按钮
  const addBtn = document.getElementById('addTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      currentEditingTemplateId = null;
      showTemplateDialog();
    });
  }
  
  // 对话框关闭按钮
  const dialogClose = document.getElementById('dialogClose');
  const cancelBtn = document.getElementById('cancelTemplate');
  const overlay = document.getElementById('dialogOverlay');
  
  [dialogClose, cancelBtn, overlay].forEach(el => {
    if (el) {
      el.addEventListener('click', hideTemplateDialog);
    }
  });
  
  // 保存按钮
  const saveBtn = document.getElementById('saveTemplate');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveTemplate);
  }
  
  // 模板列表事件委托
  const templatesList = document.getElementById('templatesList');
  if (templatesList) {
    templatesList.addEventListener('click', handleTemplateListClick);
  }
}

// 处理模板列表点击事件
async function handleTemplateListClick(event) {
  const target = event.target;
  const templateId = target.getAttribute('data-template-id');
  
  if (!templateId) return;
  
  if (target.classList.contains('edit-template-btn')) {
    await editTemplate(templateId);
  } else if (target.classList.contains('delete-template-btn')) {
    await deleteTemplate(templateId);
  }
}

// 显示模板对话框
function showTemplateDialog(template = null) {
  const dialog = document.getElementById('templateDialog');
  const title = document.getElementById('dialogTitle');
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  
  if (!dialog) return;
  
  if (template) {
    // 编辑模式
    title.textContent = chrome.i18n.getMessage('editTemplateTitle');
    nameInput.value = template.name;
    queryInput.value = template.query;
  } else {
    // 添加模式
    title.textContent = chrome.i18n.getMessage('addTemplateTitle');
    nameInput.value = '';
    queryInput.value = '';
  }
  
  dialog.style.display = 'block';
  nameInput.focus();
}

// 隐藏模板对话框
function hideTemplateDialog() {
  const dialog = document.getElementById('templateDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingTemplateId = null;
}



// 保存模板
async function saveTemplate() {
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  
  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  
  // 验证
  if (!name) {
    showToast(chrome.i18n.getMessage('templateNameRequired'));
    nameInput.focus();
    return;
  }
  
  if (!query) {
    showToast(chrome.i18n.getMessage('templateQueryRequired'));
    queryInput.focus();
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    
    if (currentEditingTemplateId) {
      // 编辑现有模板（保留原有 order）
      const index = promptTemplates.findIndex(t => t.id === currentEditingTemplateId);
      if (index !== -1) {
        promptTemplates[index] = {
          ...promptTemplates[index],
          name,
          query
        };
      }
    } else {
      // 添加新模板（放到末尾）
      const newTemplate = {
        id: generateTemplateId(),
        name,
        query,
        order: promptTemplates.length,
        isDefault: false
      };
      promptTemplates.push(newTemplate);
    }
    
    await chrome.storage.sync.set({ promptTemplates });
    hideTemplateDialog();
    await loadTemplatesList();
    showToast(chrome.i18n.getMessage('templateSavedSuccess'));
    
  } catch (error) {
    console.error('保存模板失败:', error);
    showToast('保存失败，请重试');
  }
}

// 编辑模板
async function editTemplate(templateId) {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const template = promptTemplates.find(t => t.id === templateId);
    
    if (template) {
      currentEditingTemplateId = templateId;
      showTemplateDialog(template);
    }
  } catch (error) {
    console.error('编辑模板失败:', error);
  }
}

// 删除模板
async function deleteTemplate(templateId) {
  const confirmMessage = chrome.i18n.getMessage('confirmDeleteTemplate');
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const filteredTemplates = promptTemplates.filter(t => t.id !== templateId);
    
    await chrome.storage.sync.set({ promptTemplates: filteredTemplates });
    await loadTemplatesList();
    showToast(chrome.i18n.getMessage('templateDeletedSuccess'));
    
  } catch (error) {
    console.error('删除模板失败:', error);
    showToast('删除失败，请重试');
  }
}

// 生成唯一模板ID
function generateTemplateId() {
  return 'template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 模板拖拽排序功能
function addTemplateDragFunctionality(templateItem) {
  const dragHandle = templateItem.querySelector('.drag-handle');
  if (!dragHandle) return;

  let isDragging = false;
  let placeholder = null;
  let initialIndex = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;

    const rect = templateItem.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const container = document.getElementById('templatesList');
    const items = Array.from(container.querySelectorAll('.template-item'));
    initialIndex = items.indexOf(templateItem);

    templateItem.classList.add('dragging');
    dragHandle.style.cursor = 'grabbing';

    placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = templateItem.offsetHeight + 'px';
    container.insertBefore(placeholder, templateItem.nextSibling);

    templateItem.style.position = 'fixed';
    templateItem.style.zIndex = '1000';
    templateItem.style.opacity = '0.8';
    templateItem.style.transform = 'rotate(2deg)';
    templateItem.style.pointerEvents = 'none';
    templateItem.style.width = templateItem.offsetWidth + 'px';
    templateItem.style.left = rect.left + 'px';
    templateItem.style.top = (e.clientY - offsetY) + 'px';
    templateItem.dataset.offsetY = offsetY;

    const handleDrag = (ev) => {
      if (!isDragging) return;
      const offY = parseFloat(templateItem.dataset.offsetY) || 0;
      templateItem.style.top = (ev.clientY - offY) + 'px';

      const allItems = Array.from(container.querySelectorAll('.template-item'));
      let newIdx = initialIndex;
      for (let i = 0; i < allItems.length; i++) {
        const r = allItems[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          newIdx = i;
          break;
        }
        newIdx = i + 1;
      }
      if (newIdx !== initialIndex) {
        if (newIdx >= allItems.length) {
          container.appendChild(placeholder);
        } else {
          container.insertBefore(placeholder, allItems[newIdx]);
        }
        initialIndex = newIdx;
      }
    };

    const handleDragEnd = () => {
      if (!isDragging) return;
      isDragging = false;

      templateItem.classList.remove('dragging');
      dragHandle.style.cursor = 'grab';

      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(templateItem, placeholder);
      }

      templateItem.style.position = '';
      templateItem.style.zIndex = '';
      templateItem.style.opacity = '';
      templateItem.style.transform = '';
      templateItem.style.pointerEvents = '';
      templateItem.style.left = '';
      templateItem.style.top = '';
      templateItem.style.width = '';
      delete templateItem.dataset.offsetY;

      if (placeholder) {
        placeholder.remove();
        placeholder = null;
      }

      updateTemplateOrder();

      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
  });
}

// 更新模板排序
async function updateTemplateOrder() {
  const container = document.getElementById('templatesList');
  const items = Array.from(container.querySelectorAll('.template-item'));

  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');

    items.forEach((item, index) => {
      const id = item.getAttribute('data-template-id');
      const template = promptTemplates.find(t => t.id === id);
      if (template) {
        template.order = index;
      }
    });

    await chrome.storage.sync.set({ promptTemplates });
    showToast('模板顺序已更新');
  } catch (error) {
    console.error('更新模板顺序失败:', error);
  }
}

// ===== Tab 导航：hash 跳转 & 初始化 =====

// 存储 switchTab 引用，供 hash 变化时调用
let tabSwitchFunction = null;

function handleHashNavigation() {
  const hash = window.location.hash;
  if (hash && tabSwitchFunction) {
    const targetId = hash.substring(1);
    tabSwitchFunction(targetId);
  }
}

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Options page loaded');
  
  initializeI18n();
  loadConfig();
  initializeRuleInfo();
  initializePromptTemplates();
  initializeDisabledSites();
  
  // 初始化 tab 导航，并保存 switchTab 引用
  tabSwitchFunction = initializeNavigation();
  
  // 如果没有 hash，默认显示第一个 tab
  if (!window.location.hash) {
    tabSwitchFunction('quick-entry');
  } else {
    // 处理初始 hash
    handleHashNavigation();
  }
  
  // 监听 hash 变化
  window.addEventListener('hashchange', handleHashNavigation);
});

// 确保禁用网站初始化在 loadConfig 完成后调用
// （loadConfig 中已处理 initializeSiteConfigs）
