chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "leo-read-page", title: "Mở trong chế độ đọc", contexts: ["page"] });
    chrome.contextMenus.create({ id: "leo-read-selection", title: "Đọc nội dung đã chọn", contexts: ["selection"] });
  });
  syncPanelBehavior();
});

let viewMode = "side";
async function syncPanelBehavior() {
  const { readerSettings = {} } = await chrome.storage.local.get("readerSettings");
  viewMode = readerSettings.viewMode || "side";
  await chrome.sidePanel.setOptions({ enabled: false });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}
syncPanelBehavior();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.readerSettings) {
    viewMode = changes.readerSettings.newValue?.viewMode || "side";
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});

function openTabPanel(tabId) {
  const options = chrome.sidePanel.setOptions({ tabId, path: `reader.html?tabId=${tabId}`, enabled: true });
  const opening = chrome.sidePanel.open({ tabId });
  return Promise.all([options, opening]);
}

async function openReader(tab, mode = "auto") {
  if (!tab?.id) return;
  const { readerSettings = {} } = await chrome.storage.local.get("readerSettings");
  viewMode = readerSettings.viewMode || "side";
  await chrome.storage.local.set({ [`pendingRead:${tab.id}`]: { mode, url: tab.url, tabId: tab.id, nonce: Date.now() } });
  if (readerSettings.viewMode === "full") {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?view=full&tabId=${tab.id}`) });
  }
}

chrome.action.onClicked.addListener(tab => {
  if (!tab?.id) return;
  if (viewMode === "full") openReader(tab);
  else openTabPanel(tab.id);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const openingPanel = viewMode === "full" ? null : openTabPanel(tab.id);
  openReader(tab, info.menuItemId === "leo-read-selection" ? "selection" : "auto")
    .then(() => openingPanel);
});
