# AI Group Chat Developer Guide / AI Group Chat 开发者指南

## Overview / 概述

AI Group Chat is a Chrome browser extension that enables users to interact with multiple AI websites simultaneously in a unified interface. This guide helps developers add new AI sites and extend functionality.

AI Group Chat 是一个 Chrome 浏览器扩展，允许用户在统一界面中同时与多个 AI 网站交互。本指南帮助开发者添加新的 AI 站点并扩展功能。

## Table of Contents / 目录

- [Architecture Overview / 架构概述](#architecture-overview--架构概述)
- [Adding New AI Sites / 添加新的 AI 站点](#adding-new-ai-sites--添加新的-ai-站点)
- [Action Types Reference / 动作类型参考](#action-types-reference--动作类型参考)
- [Debugging Guide / 调试指南](#debugging-guide--调试指南)
- [Best Practices / 最佳实践](#best-practices--最佳实践)
- [Contributing / 贡献指南](#contributing--贡献指南)

## Architecture Overview / 架构概述

### Core Components / 核心组件

```
ai-group-chat/
├── config/
│   ├── siteHandlers.json    # AI site configurations / AI 站点配置
│   └── baseConfig.js        # Default site definitions / 默认站点定义
├── iframe/
│   ├── inject.js           # Site automation engine / 站点自动化引擎
│   └── iframe.js           # Multi-AI interface / 多AI界面
├── content-scripts/        # Browser integration / 浏览器集成
└── background.js           # Extension lifecycle / 扩展生命周期
```

### How It Works / 工作原理

1. **Site Detection / 站点检测**: Extension detects AI sites and loads handlers / 扩展检测AI站点并加载处理器
2. **Message Passing / 消息传递**: Parent window sends queries to iframe / 父窗口向iframe发送查询
3. **Action Execution / 动作执行**: `inject.js` executes configured automation steps / `inject.js`执行配置的自动化步骤
4. **DOM Manipulation / DOM操作**: Automated interaction with AI site interfaces / 自动与AI站点界面交互

## Adding New AI Sites / 添加新的 AI 站点

### Step 1: Create Site Configuration / 第1步：创建站点配置

Add a new entry to `config/siteHandlers.json` / 在 `config/siteHandlers.json` 中添加新条目：

```json
{
  "name": "YourAI",
  "url": "https://yourai.com/",
  "enabled": true,
  "supportUrlQuery": false,
  "region": "Global",
  "supportIframe": true,
  "searchHandler": {
    "steps": [
      {
        "action": "click",
        "selector": "textarea, [contenteditable]",
        "description": "Click input area / 点击输入区域"
      },
      {
        "action": "setValue",
        "selector": "textarea",
        "description": "Set query text / 设置查询文本"
      },
      {
        "action": "sendKeys",
        "selector": "textarea",
        "keys": "Enter",
        "description": "Submit query / 提交查询"
      }
    ]
  }
}
```

### Step 2: Test Your Configuration / 第2步：测试配置

1. Open Chrome DevTools on the AI site / 在AI站点上打开Chrome开发者工具
2. Test selectors: `document.querySelector('your-selector')` / 测试选择器：`document.querySelector('your-selector')`
3. Verify automation steps work manually / 手动验证自动化步骤是否工作

### Step 3: Debug with Logs / 第3步：使用日志调试

The extension provides detailed logging / 扩展提供详细的日志记录：

```javascript
// Enable debug mode / 启用调试模式
console.log('🎯 inject.js 脚本已加载');
console.log('🚀 executeSiteHandler 开始执行');
console.log('✅ 使用 YourAI 配置化处理器处理消息');
```

## Action Types Reference / 动作类型参考

### Basic Actions / 基础动作

#### `click` / 点击动作
Clicks on DOM elements. / 点击DOM元素。

```json
{
  "action": "click",
  "selector": "button.submit",
  "description": "Click submit button / 点击提交按钮",
  "retryOnDisabled": true,
  "maxAttempts": 5,
  "retryInterval": 200
}
```

**Parameters / 参数：**
- `selector`: CSS selector (string or array) / CSS选择器（字符串或数组）
- `condition`: Optional condition check / 可选条件检查
- `retryOnDisabled`: Retry if button is disabled / 按钮禁用时重试
- `maxAttempts`: Maximum retry attempts / 最大重试次数
- `retryInterval`: Delay between retries (ms) / 重试间隔（毫秒）

#### `focus` / 聚焦动作
Sets focus on elements. / 设置元素焦点。

```json
{
  "action": "focus",
  "selector": "input[type=text]",
  "description": "Focus text input / 聚焦文本输入框"
}
```

#### `setValue` / 设值动作
Sets values in form elements. / 设置表单元素的值。

```json
{
  "action": "setValue",
  "selector": "textarea",
  "description": "Set textarea value / 设置文本区域的值"
}
```

**Input Types / 输入类型：**
- Default: Sets `element.value` for inputs / 默认：为输入元素设置 `element.value`
- `contenteditable`: Handles rich text editors / 处理富文本编辑器
- `special`: Custom handling with `specialConfig` / 使用 `specialConfig` 进行自定义处理

#### `sendKeys` / 发送按键动作
Sends keyboard events. / 发送键盘事件。

```json
{
  "action": "sendKeys",
  "selector": "textarea",
  "keys": "Enter",
  "description": "Press Enter key / 按下回车键"
}
```

**Supported Keys / 支持的按键：**
- `Enter`: Return key / 回车键

#### `triggerEvents` / 触发事件动作
Dispatches DOM events. / 分发DOM事件。

```json
{
  "action": "triggerEvents",
  "selector": "input",
  "events": ["input", "change", "blur"],
  "description": "Trigger input events / 触发输入事件"
}
```

#### `wait` / 等待动作
Adds delays between actions. / 在动作之间添加延迟。

```json
{
  "action": "wait",
  "duration": 500,
  "description": "Wait 500ms / 等待500毫秒"
}
```

#### `paste` / 粘贴动作
Simulates clipboard paste operation. / 模拟剪贴板粘贴操作。

```json
{
  "action": "paste",
  "description": "Paste clipboard content / 粘贴剪贴板内容"
}
```

### Advanced Actions / 高级动作

#### `replace` / 替换动作
Replaces DOM element content with custom HTML. / 用自定义HTML替换DOM元素内容。

```json
{
  "action": "replace",
  "selector": ".editor",
  "write": [
    {
      "tag": "p",
      "text": "$query",
      "attributes": {
        "class": "user-input"
      }
    }
  ],
  "description": "Replace editor content / 替换编辑器内容"
}
```

#### `custom` / 自定义动作
Executes custom JavaScript logic. / 执行自定义JavaScript逻辑。

```json
{
  "action": "custom",
  "customAction": "special_site_logic",
  "description": "Execute custom logic / 执行自定义逻辑"
}
```

**Built-in Custom Actions / 内置自定义动作：**
- `url_query`: Site uses URL parameters / 站点使用URL参数
- `placeholder`: Placeholder for future implementation / 未来实现的占位符
- `send_message`: Send message to parent window / 向父窗口发送消息

## Debugging Guide / 调试指南

### Enable Debug Logging / 启用调试日志

The extension provides comprehensive logging for troubleshooting / 扩展为故障排除提供全面的日志记录：

```javascript
// Check if site handler is found / 检查是否找到站点处理器
console.log('🔍 调试信息 - 域名:', domain);
console.log('🔍 调试信息 - 站点处理器:', siteHandler);

// Monitor step execution / 监控步骤执行
console.log('🚀 executeSiteHandler 开始执行');
console.log('执行步骤 1: click');

// Element selection debugging / 元素选择调试
console.log('未找到任何元素，尝试的选择器:', selectors.join(', '));
```

### Common Issues / 常见问题

#### 1. Site Handler Not Found / 站点处理器未找到

**Symptoms / 症状：**
```
❌ 未找到对应的站点处理器
🔍 调试信息 - 域名: yourai.com
```

**Solutions / 解决方案：**
- Check URL matching in configuration / 检查配置中的URL匹配
- Verify `window.getDefaultSites()` is available / 验证 `window.getDefaultSites()` 是否可用
- Ensure `baseConfig.js` is loaded / 确保 `baseConfig.js` 已加载

#### 2. Element Not Found / 元素未找到

**Symptoms / 症状：**
```
未找到任何元素，尝试的选择器: textarea, [contenteditable]
```

**Solutions / 解决方案：**
- Test selectors in browser console / 在浏览器控制台中测试选择器
- Wait for dynamic content with `wait` action / 使用 `wait` 动作等待动态内容
- Use multiple fallback selectors / 使用多个备用选择器

#### 3. Clipboard Permission Error / 剪贴板权限错误

**Symptoms / 症状：**
```
NotAllowedError: Failed to execute 'writeText' on 'Clipboard'
```

**Solutions / 解决方案：**
- Use `setValue` instead of clipboard operations / 使用 `setValue` 而不是剪贴板操作
- Request clipboard permissions in manifest / 在清单中请求剪贴板权限
- Implement fallback methods / 实现回退方法

### Testing Workflow / 测试工作流程

1. **Manual Testing / 手动测试**: Test selectors and actions manually in DevTools / 在开发者工具中手动测试选择器和动作
2. **Configuration Testing / 配置测试**: Add configuration and test with extension / 添加配置并使用扩展进行测试
3. **Cross-browser Testing / 跨浏览器测试**: Test on different browsers/versions / 在不同浏览器/版本上测试
4. **Edge Case Testing / 边缘情况测试**: Test with empty inputs, special characters / 使用空输入、特殊字符进行测试

## Best Practices / 最佳实践

### Selector Strategy / 选择器策略

1. **Use Stable Selectors / 使用稳定的选择器**: Prefer semantic selectors over generated classes / 优先使用语义选择器而不是生成的类名
   ```json
   // Good / 好的做法
   "selector": "textarea[placeholder='Ask me anything']"
   
   // Avoid / 避免
   "selector": ".css-1234567"
   ```

2. **Fallback Selectors / 备用选择器**: Provide multiple options / 提供多个选项
   ```json
   "selector": ["textarea", "[contenteditable]", "[role='textbox']"]
   ```

3. **Specific Over Generic / 具体胜过通用**: Use specific selectors when possible / 尽可能使用具体的选择器
   ```json
   // Good / 好的做法
   "selector": "textarea.chat-input"
   
   // Less reliable / 可靠性较低
   "selector": "textarea"
   ```

### Error Handling / 错误处理

1. **Graceful Degradation / 优雅降级**: Use `required: false` for optional steps / 为可选步骤使用 `required: false`
   ```json
   {
     "action": "click",
     "selector": ".optional-button",
     "required": false,
     "description": "Optional enhancement / 可选增强功能"
   }
   ```

2. **Retry Logic / 重试逻辑**: Use retry for unreliable elements / 对不可靠的元素使用重试
   ```json
   {
     "action": "click",
     "selector": "button.submit",
     "retryOnDisabled": true,
     "maxAttempts": 3
   }
   ```

### Performance Considerations / 性能考虑

1. **Minimize Wait Times / 最小化等待时间**: Use shortest necessary delays / 使用最短的必要延迟
2. **Efficient Selectors / 高效的选择器**: Avoid complex CSS selectors / 避免复杂的CSS选择器
3. **Batch Operations / 批量操作**: Combine related actions when possible / 尽可能合并相关动作

### Site-Specific Patterns / 站点特定模式

#### Rich Text Editors / 富文本编辑器
```json
{
  "action": "setValue",
  "selector": "[contenteditable]",
  "inputType": "contenteditable",
  "description": "Set rich text content / 设置富文本内容"
}
```

#### Dynamic Loading / 动态加载
```json
{
  "action": "wait",
  "duration": 1000,
  "description": "Wait for dynamic content / 等待动态内容"
},
{
  "action": "click",
  "selector": ".dynamic-element",
  "description": "Click after loading / 加载后点击"
}
```

#### Special Frameworks / 特殊框架
```json
{
  "action": "setValue",
  "selector": ".custom-editor",
  "inputType": "special",
  "specialConfig": {
    "type": "lexical-editor",
    "containerSelector": ".editor-container",
    "elementType": "span",
    "attributes": {
      "data-lexical-text": "true"
    }
  }
}
```

## Contributing / 贡献指南

### Code Standards / 代码标准

1. **JSON Formatting / JSON格式**: Use consistent indentation and structure / 使用一致的缩进和结构
2. **Descriptive Names / 描述性命名**: Use clear, descriptive action descriptions / 使用清晰、描述性的动作描述
3. **Error Messages / 错误消息**: Provide helpful error messages / 提供有用的错误消息
4. **Documentation / 文档**: Document complex configurations / 记录复杂的配置

### Testing Requirements / 测试要求

Before submitting / 提交前：

1. Test configuration manually / 手动测试配置
2. Verify error handling / 验证错误处理
3. Check cross-browser compatibility / 检查跨浏览器兼容性
4. Validate JSON syntax / 验证JSON语法

### Pull Request Process / 拉取请求流程

1. Fork the repository / 分叉仓库
2. Create feature branch: `git checkout -b add-yourai-support` / 创建功能分支
3. Add site configuration / 添加站点配置
4. Test thoroughly / 彻底测试
5. Submit pull request with / 提交拉取请求，包含：
   - Clear description / 清晰的描述
   - Testing evidence / 测试证据
   - Screenshots/videos if applicable / 如适用，提供截图/视频

### Site Configuration Template / 站点配置模板

Use this template for new sites / 为新站点使用此模板：

```json
{
  "name": "YourAI",
  "url": "https://yourai.com/",
  "enabled": true,
  "supportUrlQuery": false,
  "region": "Global",
  "hidden": false,
  "supportIframe": true,
  "note": "Production ready / 生产就绪",
  "searchHandler": {
    "steps": [
      {
        "action": "click",
        "selector": ".input-area",
        "description": "Focus input area / 聚焦输入区域"
      },
      {
        "action": "setValue",
        "selector": "textarea",
        "description": "Enter user query / 输入用户查询"
      },
      {
        "action": "wait",
        "duration": 100,
        "description": "Brief pause / 短暂暂停"
      },
      {
        "action": "sendKeys",
        "selector": "textarea",
        "keys": "Enter",
        "description": "Submit query / 提交查询"
      }
    ]
  },
  "fileUploadHandler": {
    "steps": [
      {
        "action": "paste",
        "description": "Paste file content / 粘贴文件内容"
      }
    ]
  }
}
```

## Support / 支持

- **Issues / 问题报告**: Report bugs on GitHub Issues / 在GitHub Issues上报告错误
- **Discussions / 讨论**: Join community discussions / 加入社区讨论
- **Documentation / 文档**: This guide and inline code comments / 本指南和内联代码注释

Happy coding! / 编程愉快！🚀