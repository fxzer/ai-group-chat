let allHistoryItems = [];

function getMessage(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions);
}

function initializeI18n() {
    const title = getMessage('historyTitle') || getMessage('appName');
    if (title) {
        document.title = title;
    }

    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = getMessage(key);
        if (message) {
            element.placeholder = message;
        }
    });
}

async function initializeHistoryTip() {
    const tipEl = document.getElementById('historyMaxTip');
    if (!tipEl) return;

    try {
        const config = await AppConfigManager.loadConfig();
        const maxCount = config?.history?.maxCount || 100;
        const tip = getMessage('historyMaxRecordsTip', [String(maxCount)]);
        if (tip) {
            tipEl.textContent = tip;
        } else {
            tipEl.style.display = 'none';
        }
    } catch (error) {
        tipEl.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeI18n();
    await initializeHistoryTip();
    await loadHistory();

    const clearBtn = document.getElementById('clearHistoryBtn');
    clearBtn.addEventListener('click', async () => {
        const confirmMessage = getMessage('confirmClearHistory');
        if (confirm(confirmMessage || 'Are you sure you want to clear all history?')) {
            await clearHistory();
            await loadHistory();
        }
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        filterHistory(e.target.value);
    });
});

async function loadHistory() {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');

        allHistoryItems = pkHistory;

        const historyList = document.getElementById('historyList');
        const emptyState = document.getElementById('emptyState');
        const noResultsState = document.getElementById('noResultsState');
        const searchInput = document.getElementById('searchInput');

        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const filteredItems = filterItemsBySearch(pkHistory, searchTerm);

        if (pkHistory.length === 0) {
            historyList.style.display = 'none';
            emptyState.style.display = 'block';
            noResultsState.style.display = 'none';
            return;
        }

        if (filteredItems.length === 0 && searchTerm) {
            historyList.style.display = 'none';
            emptyState.style.display = 'none';
            noResultsState.style.display = 'block';
            return;
        }

        historyList.style.display = 'flex';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'none';

        historyList.innerHTML = '';

        filteredItems.forEach(item => {
            const historyItem = createHistoryItem(item);
            historyList.appendChild(historyItem);
        });

    } catch (error) {
        console.error('Failed to load history:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) {
            historyList.innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">' +
                (getMessage('loadHistoryFailed') || 'Failed to load history, please refresh the page') + '</div>';
            historyList.style.display = 'flex';
        }
    }
}

function filterItemsBySearch(items, searchTerm) {
    if (!searchTerm) {
        return items;
    }

    return items.filter(item => {
        const queryMatch = item.query && item.query.toLowerCase().includes(searchTerm);
        const siteMatch = item.sites && item.sites.some(site =>
            site.name && site.name.toLowerCase().includes(searchTerm)
        );

        return queryMatch || siteMatch;
    });
}

function filterHistory(searchTerm) {
    const filteredItems = filterItemsBySearch(allHistoryItems, searchTerm.toLowerCase());

    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');
    const noResultsState = document.getElementById('noResultsState');

    if (allHistoryItems.length === 0) {
        historyList.style.display = 'none';
        emptyState.style.display = 'block';
        noResultsState.style.display = 'none';
        return;
    }

    if (filteredItems.length === 0 && searchTerm.trim()) {
        historyList.style.display = 'none';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'block';
        return;
    }

    historyList.style.display = 'flex';
    emptyState.style.display = 'none';
    noResultsState.style.display = 'none';

    historyList.innerHTML = '';

    filteredItems.forEach(item => {
        const historyItem = createHistoryItem(item);
        historyList.appendChild(historyItem);
    });
}

function createHistoryItem(item) {
    const div = document.createElement('div');
    div.className = 'history-item';

    const header = document.createElement('div');
    header.className = 'history-item-header';

    const queryDiv = document.createElement('div');
    queryDiv.className = 'history-query';
    queryDiv.textContent = item.query;

    const dateDiv = document.createElement('div');
    dateDiv.className = 'history-date';
    dateDiv.textContent = item.date || formatDate(item.timestamp);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'history-item-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = getMessage('deleteButton') || 'Delete';
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmMessage = getMessage('confirmDeleteHistory');
        if (confirm(confirmMessage || 'Are you sure you want to delete this record?')) {
            await deleteHistoryItem(item.id);
            await loadHistory();
        }
    });

    actionsDiv.appendChild(deleteBtn);

    header.appendChild(queryDiv);
    header.appendChild(dateDiv);
    header.appendChild(actionsDiv);

    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'history-sites';

    item.sites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'site-tag';
        tag.textContent = site.name;
        sitesDiv.appendChild(tag);
    });

    div.appendChild(header);
    div.appendChild(sitesDiv);

    div.addEventListener('click', (e) => {
        if (e.target === deleteBtn || deleteBtn.contains(e.target)) {
            return;
        }

        openHistoryItem(item);
    });

    return div;
}

async function openHistoryItem(item) {
    try {
        const params = new URLSearchParams();
        params.set('query', item.query);

        const siteNames = item.sites.map(site => site.name);
        if (siteNames.length > 0) {
            params.set('sites', siteNames.join(','));
        }
        params.set('historyId', item.id);

        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);

        await chrome.tabs.create({
            url: iframeUrl,
            active: true
        });
    } catch (error) {
        console.error('Failed to open history item:', error);
        alert(getMessage('openHistoryFailed') || 'Failed to open history, please try again');
    }
}

async function deleteHistoryItem(id) {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const updatedHistory = pkHistory.filter(item => item.id !== id);
        await chrome.storage.local.set({ pkHistory: updatedHistory });
        allHistoryItems = updatedHistory;
    } catch (error) {
        console.error('Failed to delete history item:', error);
        alert(getMessage('deleteHistoryFailed') || 'Failed to delete history item, please try again');
    }
}

async function clearHistory() {
    try {
        await chrome.storage.local.set({ pkHistory: [] });
    } catch (error) {
        console.error('Failed to clear history:', error);
        alert(getMessage('clearHistoryFailed') || 'Failed to clear history, please try again');
    }
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const locale = chrome.i18n.getUILanguage();
    return date.toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
