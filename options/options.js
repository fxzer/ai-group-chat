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

  // 更新所有带有 data-i18n-placeholder 属性的元素的 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.placeholder = message;
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
    showToast(getMessage('templateInitFailed') || '模板加载失败，请刷新页面重试');
  }
}

// 确保存在默认模板
async function ensureDefaultTemplates() {
  try {
    const data = await chrome.storage.sync.get(['promptTemplates', 'promptTemplatesInitializedV3']);
    
    // 如果完全没有初始化过，且没有模板
    if (!data.promptTemplatesInitializedV3 && (!data.promptTemplates || data.promptTemplates.length === 0)) {
      console.log('提示词模板为空且未初始化，将进行初始化');
      try {
        await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
      } catch (error) {
        console.log('无法发送初始化消息，background 可能已处理:', error);
      }
    } else if (data.promptTemplates && data.promptTemplates.length > 0 && !data.promptTemplatesInitializedV3) {
      // 用户已有模板但没有标记，更新标记
      await chrome.storage.sync.set({ promptTemplatesInitializedV3: true });
    }
  } catch (error) {
    console.error('检查默认模板失败:', error);
    throw error;
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
          <p style="font-size: 14px;">点击上方"添加"按钮</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = '';
    sortedTemplates.forEach(template => {
      const item = document.createElement('div');
      item.className = 'template-item site-config';
      item.setAttribute('data-template-id', template.id);
      item.style.cssText = 'background:white;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:12px;transition:box-shadow 0.2s ease;';

      // 头部行
      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;';

      const titleGroup = document.createElement('div');
      titleGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;';

      // 拖拽手柄（静态 SVG，不含用户数据）
      const dragHandle = document.createElement('div');
      dragHandle.className = 'drag-handle';
      dragHandle.title = '拖拽调整顺序';
      dragHandle.style.cssText = 'cursor:grab;color:#999;font-size:14px;user-select:none;';
      dragHandle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';
      titleGroup.appendChild(dragHandle);

      // 标题（用户数据，用 textContent 防 XSS - S5）
      const title = document.createElement('h4');
      title.style.cssText = 'margin:0;font-size:16px;color:#333;';
      title.textContent = template.name;
      titleGroup.appendChild(title);

      if (template.isDefault) {
        const badge = document.createElement('span');
        badge.style.cssText = 'background:#e8f5e8;color:#00a240;padding:2px 6px;border-radius:3px;font-size:12px;';
        badge.textContent = '默认';
        titleGroup.appendChild(badge);
      }
      headerRow.appendChild(titleGroup);

      // 操作按钮组
      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-template-btn';
      editBtn.setAttribute('data-template-id', template.id);
      editBtn.setAttribute('data-i18n', 'editButton');
      editBtn.style.cssText = 'background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;color:#666;';
      editBtn.textContent = chrome.i18n.getMessage('editButton') || '编辑';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-template-btn';
      deleteBtn.setAttribute('data-template-id', template.id);
      deleteBtn.setAttribute('data-i18n', 'deleteButton');
      deleteBtn.style.cssText = 'background:#ffebee;border:1px solid #ffcdd2;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;color:#d32f2f;';
      deleteBtn.textContent = chrome.i18n.getMessage('deleteButton') || '删除';

      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(deleteBtn);
      headerRow.appendChild(btnGroup);
      item.appendChild(headerRow);

      // 查询内容（用户数据，用 textContent 防 XSS - S5）
      const queryBox = document.createElement('div');
      queryBox.style.cssText = 'background:#f8f9fa;border:1px solid #e9ecef;border-radius:4px;padding:12px;font-family:\'Monaco\',\'Menlo\',\'Courier New\',monospace;font-size:12px;color:#495057;word-break:break-word;margin-left:28px;white-space:pre-wrap;';
      queryBox.textContent = template.query;
      item.appendChild(queryBox);

      container.appendChild(item);
    });
    
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
    showToast(getMessage('templateLoadFailed') || '加载模板列表失败，请刷新页面');
  }
}

// 更新清除按钮显示状态的辅助函数
function updateClearButtonVisibility(inputEl, clearBtnEl) {
  if (clearBtnEl) {
    clearBtnEl.style.display = inputEl.value ? 'flex' : 'none';
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

  // 绑定清除按钮事件
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const clearNameBtn = document.getElementById('clearNameBtn');
  const clearQueryBtn = document.getElementById('clearQueryBtn');

  if (nameInput && clearNameBtn) {
    nameInput.addEventListener('input', () => updateClearButtonVisibility(nameInput, clearNameBtn));
    clearNameBtn.addEventListener('click', () => {
      nameInput.value = '';
      updateClearButtonVisibility(nameInput, clearNameBtn);
      nameInput.focus();
    });
  }

  if (queryInput && clearQueryBtn) {
    queryInput.addEventListener('input', () => updateClearButtonVisibility(queryInput, clearQueryBtn));
    clearQueryBtn.addEventListener('click', () => {
      queryInput.value = '';
      updateClearButtonVisibility(queryInput, clearQueryBtn);
      queryInput.focus();
    });
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

  // 更新清除按钮的初始显示状态
  const clearNameBtn = document.getElementById('clearNameBtn');
  const clearQueryBtn = document.getElementById('clearQueryBtn');
  updateClearButtonVisibility(nameInput, clearNameBtn);
  updateClearButtonVisibility(queryInput, clearQueryBtn);
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
    showToast(getMessage('templateEditFailed') || '加载模板失败，请重试');
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
    const originalWidth = rect.width;
    const originalHeight = rect.height;
    const offsetY = e.clientY - rect.top;
    const container = document.getElementById('templatesList');
    const items = Array.from(container.querySelectorAll('.template-item'));
    initialIndex = items.indexOf(templateItem);

    templateItem.classList.add('dragging');
    dragHandle.style.cursor = 'grabbing';

    placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    if (window.innerWidth > 1024) {
      placeholder.style.height = originalHeight + 'px';
    }
    container.insertBefore(placeholder, templateItem.nextSibling);

    templateItem.style.position = 'fixed';
    templateItem.style.zIndex = '1000';
    templateItem.style.opacity = '0.8';
    templateItem.style.transform = 'rotate(2deg)';
    templateItem.style.pointerEvents = 'none';
    templateItem.style.width = originalWidth + 'px';
    templateItem.style.left = rect.left + 'px';
    templateItem.style.top = (e.clientY - offsetY) + 'px';
    templateItem.dataset.offsetY = offsetY;

    const handleDrag = (ev) => {
      if (!isDragging) return;
      const offY = parseFloat(templateItem.dataset.offsetY) || 0;
      templateItem.style.top = (ev.clientY - offY) + 'px';

      const allItems = Array.from(container.querySelectorAll('.template-item:not(.dragging)'));
      let closestItem = null;
      let minDistance = Infinity;
      let insertBefore = true;

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const r = item.getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        const dist = Math.pow(ev.clientX - centerX, 2) + Math.pow(ev.clientY - centerY, 2);
        
        if (dist < minDistance) {
          minDistance = dist;
          closestItem = item;
          
          // 大于 1024px 时为网格布局，根据横向位置决定插入位置；否则根据纵向位置决定
          if (window.innerWidth > 1024) {
            insertBefore = ev.clientX < centerX;
          } else {
            insertBefore = ev.clientY < centerY;
          }
        }
      }

      if (closestItem) {
        const targetSibling = insertBefore ? closestItem : closestItem.nextSibling;
        if (placeholder.nextSibling !== targetSibling) {
          container.insertBefore(placeholder, targetSibling);
        }
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
    showToast(getMessage('templateOrderUpdateFailed') || '更新模板顺序失败，请重试');
  }
}

// 初始化总结设置
async function initializeSummarySettings() {
  const summaryApiUrl = document.getElementById('summaryApiUrl');
  const summaryApiKey = document.getElementById('summaryApiKey');
  const summaryApiModel = document.getElementById('summaryApiModel');
  const summaryApiPrompt = document.getElementById('summaryApiPrompt');
  const saveBtn = document.getElementById('saveSummarySettings');

  if (!summaryApiUrl || !summaryApiKey || !summaryApiModel || !summaryApiPrompt || !saveBtn) {
    console.error('未找到总结设置相关 DOM 元素');
    return;
  }

  // 从 sync 存储加载设置
  try {
    const config = await chrome.storage.sync.get([
      'summaryApiUrl',
      'summaryApiKey',
      'summaryApiModel',
      'summaryApiPrompt'
    ]);

    if (config.summaryApiUrl) summaryApiUrl.value = config.summaryApiUrl;
    if (config.summaryApiKey) summaryApiKey.value = config.summaryApiKey;
    if (config.summaryApiModel) summaryApiModel.value = config.summaryApiModel;
    
    if (config.summaryApiPrompt) {
      summaryApiPrompt.value = config.summaryApiPrompt;
    } else {
      summaryApiPrompt.value = "你是一个优秀的AI总结和对比助手。请总结以下所有 AI 的回答要点，对比它们的分歧与共识，提取出核心结论，并输出一份精美的 Markdown 报告。";
    }
  } catch (error) {
    console.error('加载总结设置失败:', error);
    showToast(getMessage('summarySettingsLoadFailed') || '加载总结设置失败，请刷新页面');
  }

  // 绑定保存事件
  saveBtn.addEventListener('click', async () => {
    const url = summaryApiUrl.value.trim();
    const key = summaryApiKey.value.trim();
    const model = summaryApiModel.value.trim();
    const prompt = summaryApiPrompt.value.trim();

    try {
      await chrome.storage.sync.set({
        summaryApiUrl: url,
        summaryApiKey: key,
        summaryApiModel: model,
        summaryApiPrompt: prompt
      });
      showToast(getMessage('summarySettingsSaved') || '总结配置已保存');
    } catch (error) {
      console.error('保存总结设置失败:', error);
      showToast('保存失败: ' + error.message);
    }
  });

  // 绑定测试连接事件
  const testBtn = document.getElementById('testSummarySettings');
  const testResultSpan = document.getElementById('testSummaryApiResult');

  if (testBtn && testResultSpan) {
    testBtn.addEventListener('click', async () => {
      const url = summaryApiUrl.value.trim();
      const key = summaryApiKey.value.trim();
      const model = summaryApiModel.value.trim();

      if (!url || !key || !model) {
        testResultSpan.textContent = "⚠️ 请先填写完整配置";
        testResultSpan.style.color = "#e67e22";
        testResultSpan.style.display = "inline";
        return;
      }

      // 显示测试中
      testResultSpan.textContent = getMessage('summaryApiTesting') || '测试中...';
      testResultSpan.style.color = '#e67e22';
      testResultSpan.style.display = 'inline';
      testBtn.disabled = true;

      try {
        let cleanUrl = url;
        if (!cleanUrl.endsWith('/chat/completions')) {
          cleanUrl = cleanUrl.replace(/\/$/, '') + '/chat/completions';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 秒超时

        const response = await fetch(cleanUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          testResultSpan.textContent = getMessage('summaryApiTestSuccess') || '✅ 连接成功';
          testResultSpan.style.color = '#00a240';
        } else {
          const errorText = await response.text();
          let parsedMsg = '';
          try {
            const errJson = JSON.parse(errorText);
            parsedMsg = errJson.error?.message || errJson.message || errorText;
          } catch (e) {
            parsedMsg = errorText || response.statusText;
          }
          // 截取错误信息的前50个字符
          const cleanMsg = parsedMsg.substring(0, 50) + (parsedMsg.length > 50 ? '...' : '');
          testResultSpan.textContent = (getMessage('summaryApiTestError') || '❌ 连接失败: ') + `${response.status} (${cleanMsg})`;
          testResultSpan.style.color = '#c0392b';
        }
      } catch (error) {
        let errorMsg = error.message;
        if (error.name === 'AbortError') {
          errorMsg = '请求超时 (10s)';
        }
        testResultSpan.textContent = (getMessage('summaryApiTestError') || '❌ 连接失败: ') + errorMsg;
        testResultSpan.style.color = '#c0392b';
      } finally {
        testBtn.disabled = false;
      }
    });
  }

  // S9：API Key 显示/隐藏切换（小眼睛按钮）
  const toggleVisibilityBtn = document.getElementById('toggleApiKeyVisibility');
  if (toggleVisibilityBtn && summaryApiKey) {
    toggleVisibilityBtn.addEventListener('click', () => {
      const isPassword = summaryApiKey.type === 'password';
      summaryApiKey.type = isPassword ? 'text' : 'password';
      const eyeOpen = toggleVisibilityBtn.querySelector('.eye-open');
      const eyeClosed = toggleVisibilityBtn.querySelector('.eye-closed');
      if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : 'block';
      if (eyeClosed) eyeClosed.style.display = isPassword ? 'block' : 'none';
      toggleVisibilityBtn.setAttribute(
        'aria-label',
        isPassword ? '隐藏 API Key' : '显示 API Key'
      );
    });
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

// 初始化 Tab 切换
function initializeTabs() {
  const tabLinks = document.querySelectorAll('.tab-link');
  const tabContents = document.querySelectorAll('.tab-content');

  const switchTab = (targetTabId) => {
    // 切换 tab-link 激活状态
    tabLinks.forEach(link => {
      if (link.getAttribute('data-tab') === targetTabId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // 切换 tab-content 显示状态
    tabContents.forEach(content => {
      if (content.id === targetTabId) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  };

  tabLinks.forEach(link => {
    link.addEventListener('click', () => {
      const targetTabId = link.getAttribute('data-tab');
      switchTab(targetTabId);
      window.location.hash = targetTabId;
    });
  });

  // 保存切换函数引用，供外部/全局 hashchange 事件调用
  tabSwitchFunction = switchTab;

  // 监听 hash 改变
  window.addEventListener('hashchange', handleHashNavigation);

  // 初始化默认显示 (如果 hash 存在则显示对应 tab，否则默认第一个)
  const hash = window.location.hash;
  if (hash) {
    handleHashNavigation();
  } else {
    switchTab('prompt-templates');
  }
}

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Options page loaded');
  
  initializeI18n();
  initializePromptTemplates();
  initializeSummarySettings();
  initializeTabs();
});
