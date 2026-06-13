// 系统默认站点设置将通过 getDefaultSites() 动态获取

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
  initializeRuleInfo();
  initializePromptTemplates();
});

// 确保禁用网站初始化在 loadConfig 完成后调用
// （loadConfig 中已处理 initializeSiteConfigs）
