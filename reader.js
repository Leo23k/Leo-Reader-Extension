const $ = selector => document.querySelector(selector);
const body = document.body;
const article = $("#article");
const articleBody = $("#article-body");
const status = $("#status");
const edgeAudio = $("#edge-audio");
const sessionKey = tabId => tabId ? `readingSession:${tabId}` : "readingSession";
const pendingReadKey = tabId => tabId ? `pendingRead:${tabId}` : "pendingRead";
const settingsKey = "readerSettings";
const defaults = { font: "sans", theme: "light", size: 18, line: "1.8", letter: "0", links: true, images: true, highlight: "sentence", lineEffect: false, speed: 1.25, viewMode: "side" };
let settings = { ...defaults };
let sentences = [];
let sentenceSpans = [];
let current = 0;
let voices = [];
let utterance = null;
let speaking = false;
let paused = false;
let sourceUrl = "";
let sourceTabId = null;
let lastReadNonce = 0;
let speechToken = 0;
let edgeWords = [];
let edgeAudioUrl = "";
let pageRefreshTimer = null;

function applySettings() {
  body.dataset.theme = settings.theme;
  body.dataset.font = settings.font;
  body.dataset.highlight = settings.highlight;
  body.dataset.view = window.parent !== window ? "overlay" : new URLSearchParams(location.search).get("view") || "side";
  body.classList.toggle("line-focus", settings.lineEffect);
  body.style.setProperty("--font-size", `${settings.size}px`);
  body.style.setProperty("--line-height", settings.line);
  body.style.setProperty("--letter-spacing", settings.letter);
  body.classList.toggle("hide-links", !settings.links);
  body.classList.toggle("hide-images", !settings.images);
  $("#font").value = settings.font;
  $("#theme").value = settings.theme;
  $("#line-spacing").value = settings.line;
  $("#letter-spacing").value = settings.letter;
  $("#show-links").checked = settings.links;
  $("#show-images").checked = settings.images;
  $("#highlight").value = settings.highlight;
  $("#line-effect").checked = settings.lineEffect;
  $("#view-mode").value = settings.viewMode;
  $("#speed").value = String(settings.speed);
}

async function saveSettings() {
  await chrome.storage.local.set({ [settingsKey]: settings });
}

function safeArticle(markup, pageUrl) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const allowed = new Set(["article", "section", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "b", "em", "i", "u", "s", "a", "br", "hr", "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td"]);
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SVG", "VIDEO", "AUDIO"].includes(node.tagName)) return document.createDocumentFragment();
    const fragment = document.createDocumentFragment();
    if (!allowed.has(node.tagName.toLowerCase())) {
      for (const child of node.childNodes) fragment.append(copy(child));
      return fragment;
    }
    const el = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === "A") {
      try {
        const url = new URL(node.getAttribute("href"), pageUrl);
        if (["http:", "https:", "mailto:"].includes(url.protocol)) {
          el.href = url.href;
          el.rel = "noopener noreferrer";
          el.target = "_blank";
        }
      } catch {}
    }
    if (node.tagName === "IMG") {
      try {
        const url = new URL(node.getAttribute("src"), pageUrl);
        if (["http:", "https:"].includes(url.protocol)) el.src = url.href;
      } catch {}
      el.alt = node.getAttribute("alt") || "";
    }
    for (const child of node.childNodes) el.append(copy(child));
    fragment.append(el);
    return fragment;
  }
  const root = document.createDocumentFragment();
  for (const child of parsed.body.childNodes) root.append(copy(child));
  return root;
}

function splitReaderSentences(text) {
  const terminal = ".!?…。！？";
  const strong = ";:；：";
  const closing = "\"'”’)]}】》」』";
  const pieces = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const mark = text[index];
    if (!terminal.includes(mark) && !strong.includes(mark)) { index += 1; continue; }
    let end = index + 1;
    if (terminal.includes(mark)) {
      while (end < text.length && terminal.includes(text[end])) end += 1;
      if (mark === ".") {
        const before = text[end - 2] || "";
        const after = text[end] || "";
        const abbreviation = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc)|\bv\.v)\.$/i.test(text.slice(Math.max(0, end - 17), end));
        if ((/\d/.test(before) && /\d/.test(after)) || (/[a-z]/i.test(before) && /[a-z]/i.test(after)) || abbreviation) { index = end; continue; }
      }
    }
    while (end < text.length && closing.includes(text[end])) end += 1;
    if (end === text.length || /\s/.test(text[end])) {
      const value = text.slice(start, end);
      if (value.trim()) pieces.push({ text: value, complete: true });
      start = end;
    }
    index = end;
  }
  const tail = text.slice(start);
  if (tail.trim()) pieces.push({ text: tail, complete: false });
  return pieces.length ? pieces : [{ text, complete: false }];
}

function decorateSentences(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
  let index = 0;
  for (const node of nodes) {
    const text = node.textContent.normalize("NFC").replace(/[\p{Zs}\u200b\u2060\ufeff]+/gu, " ").replace(/\u00ad/g, "");
    const pieces = splitReaderSentences(text);
    const fragment = document.createDocumentFragment();
    for (const piece of pieces) {
      const span = document.createElement("span");
      span.className = "sentence";
      span.dataset.index = index;
      const tokens = piece.text.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_]+/gu) || [piece.text];
      for (const token of tokens) {
        if (/^[\p{L}\p{N}_]+$/u.test(token)) {
          const word = document.createElement("span");
          word.className = "word-token";
          word.textContent = token;
          span.append(word);
        } else span.append(document.createTextNode(token));
      }
      fragment.append(span);
      if (piece.complete) index += 1;
    }
    node.replaceWith(fragment);
  }
  sentenceSpans = [...root.querySelectorAll(".sentence")];
  const grouped = [];
  for (const span of sentenceSpans) {
    const i = Number(span.dataset.index);
    (grouped[i] ||= []).push(span);
  }
  sentences = grouped.map(spans => spans.map(span => span.textContent).join("").trim()).filter(Boolean);
  sentenceSpans = grouped.map(spans => spans || []);
}

function setCurrent(index, charIndex = -1) {
  current = Math.max(0, Math.min(index, sentences.length - 1));
  articleBody.querySelectorAll(".active-line").forEach(line => line.classList.remove("active-line"));
  for (const [i, spans] of sentenceSpans.entries()) {
    for (const span of spans) {
      span.classList.toggle("active", ["sentence", "adaptive"].includes(settings.highlight) && i === current);
      span.classList.remove("current-word");
    }
  }
  if (settings.lineEffect) sentenceSpans[current]?.forEach(span => span.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre")?.classList.add("active-line"));
  if (["word", "adaptive"].includes(settings.highlight) && charIndex >= 0) {
    let offset = 0;
    for (const span of sentenceSpans[current] || []) {
      const length = span.textContent.length;
      const local = charIndex - offset;
      if (local >= 0 && local < length) {
        let wordOffset = 0;
        for (const word of span.querySelectorAll(".word-token")) {
          const wordEnd = wordOffset + word.textContent.length;
          if (local >= wordOffset && local < wordEnd) {
            word.classList.add("current-word");
            break;
          }
          wordOffset = wordEnd;
          const next = word.nextSibling;
          if (next?.nodeType === Node.TEXT_NODE) wordOffset += next.textContent.length;
        }
        break;
      }
      offset += length;
    }
  }
  $("#progress").value = String(current);
  $("#progress-label").textContent = `${sentences.length ? current + 1 : 0} / ${sentences.length}`;
  sentenceSpans[current]?.[0]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function saveSession() {
  await chrome.storage.local.set({ [sessionKey(sourceTabId)]: { title: $("#article-title").textContent, html: articleBody.innerHTML, current, url: sourceUrl, tabId: sourceTabId } });
}

async function setArticle(title, markup, pageUrl, resumeAt = 0, tabId = null) {
  stopSpeech();
  const clean = safeArticle(markup, pageUrl);
  if (!clean.textContent.trim() && !clean.querySelector("img")) {
    status.textContent = "Không tìm thấy nội dung đọc được trên trang này.";
    return;
  }
  articleBody.replaceChildren(clean);
  decorateSentences(articleBody);
  $("#article-title").textContent = title || "Bài viết";
  $("#empty-state").hidden = true;
  article.hidden = false;
  sourceUrl = pageUrl;
  sourceTabId = tabId;
  current = Math.min(resumeAt, Math.max(0, sentences.length - 1));
  $("#progress").max = String(Math.max(0, sentences.length - 1));
  setCurrent(current);
  status.textContent = `${sentences.length} câu`;
  await saveSession();
}

function readPageFromClick(mode) {
  let url;
  try { url = new URL(sourceUrl); } catch { return getPage(mode); }
  if (!/^https?:$/.test(url.protocol)) return getPage(mode);
  const origin = `${url.protocol}//${url.hostname}/*`;
  chrome.permissions.request({ origins: [origin] }, granted => {
    if (chrome.runtime.lastError) {
      status.textContent = chrome.runtime.lastError.message;
    } else if (granted) {
      getPage(mode);
    } else {
      status.textContent = `Hãy cho phép truy cập ${url.hostname} để đọc trang này.`;
    }
  });
}

async function installSelectionButton(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const existingButton = window.__leoReaderSelectionButton;
      if (window.__leoReaderSelectionButtonVersion === 3 && existingButton?.isConnected) {
        return;
      }
      window.__leoReaderSelectionHost?.remove();
      document.getElementById("leo-reader-selection-host")?.remove();
      existingButton?.remove();
      document.getElementById("leo-reader-selection-button")?.remove();
      const host = document.createElement("div");
      host.id = "leo-reader-selection-host";
      host.style.cssText = "position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important";
      const shadow = host.attachShadow({ mode: "closed" });
      const button = document.createElement("button");
      window.__leoReaderSelectionButton = button;
      window.__leoReaderSelectionHost = host;
      window.__leoReaderSelectionButtonVersion = 3;
      button.id = "leo-reader-selection-button";
      button.type = "button";
      button.title = "Đọc đoạn văn bản đã chọn";
      button.setAttribute("aria-label", button.title);
      button.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05a4.5 4.5 0 0 0 2.5-4.02zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';
      button.style.cssText = "position:fixed;z-index:2147483647;display:none;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:#0b57d0;color:#fff;box-shadow:0 2px 8px #0005;cursor:pointer;pointer-events:auto";
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", () => {
        if (!button.dataset.text) return;
        chrome.runtime.sendMessage({ type: "leo-reader-read-selection", text: button.dataset.text, title: document.title, url: location.href }).then(({ tabId }) => {
          if (!Number.isInteger(tabId)) throw new Error("Không lưu được đoạn văn bản đã chọn.");
          if (!window.__leoReaderPlayerHost?.isConnected) {
            document.getElementById("leo-reader-player-overlay")?.remove();
            const host = document.createElement("div");
            host.id = "leo-reader-player-overlay";
            host.style.cssText = "position:fixed!important;z-index:2147483647!important;inset:0 0 auto!important;width:100vw!important;height:64px!important";
            const shadow = host.attachShadow({ mode: "closed" });
            const frame = document.createElement("iframe");
            frame.title = "Leo Reader player";
            frame.allow = "autoplay";
            frame.src = chrome.runtime.getURL(`reader.html?view=overlay&tabId=${tabId}`);
            frame.style.cssText = "display:block!important;width:100%!important;height:64px!important;border:0!important";
            shadow.append(frame);
            document.documentElement.append(host);
            window.__leoReaderPlayerHost = host;
            window.__leoReaderPlayerFrame = frame;
          }
          button.style.display = "none";
        }).catch(() => { button.style.display = "flex"; });
      });
      shadow.append(button);
      document.documentElement.append(host);
      const updateButton = () => {
        const selected = window.getSelection();
        const text = selected?.toString().trim();
        const range = selected?.rangeCount ? selected.getRangeAt(0) : null;
        const bounds = range?.getBoundingClientRect();
        const rect = bounds && (bounds.width || bounds.height) ? bounds : range?.getClientRects()[0];
        if (!text || !rect || (!rect.width && !rect.height)) { button.style.display = "none"; return; }
        button.dataset.text = text;
        button.style.left = `${Math.max(8, Math.min(window.innerWidth - 36, rect.left + rect.width / 2 - 14))}px`;
        button.style.top = `${Math.max(8, rect.top - 36)}px`;
        button.style.display = "flex";
      };
      const scheduleUpdate = () => setTimeout(updateButton, 0);
      document.addEventListener("selectionchange", scheduleUpdate);
      document.addEventListener("pointerup", scheduleUpdate, true);
      document.addEventListener("mouseup", scheduleUpdate, true);
      document.addEventListener("keyup", scheduleUpdate, true);
      window.addEventListener("message", event => {
        if (event.source !== window.__leoReaderPlayerFrame?.contentWindow) return;
        if (event.data?.type === "leo-reader-resize-overlay") {
          const height = event.data.open ? "460px" : "64px";
          window.__leoReaderPlayerHost.style.height = height;
          window.__leoReaderPlayerFrame.style.height = height;
          return;
        }
        if (event.data?.type !== "leo-reader-close-overlay") return;
        window.__leoReaderPlayerHost.remove();
        window.__leoReaderPlayerHost = null;
        window.__leoReaderPlayerFrame = null;
      });
      requestAnimationFrame(updateButton);
    }
  });
}

async function getPage(mode, refresh = false) {
  try {
    const tabSessionKey = sessionKey(sourceTabId);
    const tabPendingKey = pendingReadKey(sourceTabId);
    const stored = await chrome.storage.local.get([...new Set([tabSessionKey, tabPendingKey, "readingSession", "pendingRead"])]);
    const pendingRead = stored[tabPendingKey] || (stored.pendingRead?.tabId === sourceTabId ? stored.pendingRead : null);
    const pendingStorageKey = stored[tabPendingKey] ? tabPendingKey : "pendingRead";
    const previous = stored[tabSessionKey] || (stored.readingSession?.tabId === sourceTabId ? stored.readingSession : null);
    const candidates = [...new Set([
      sourceTabId,
      pendingRead?.tabId === sourceTabId ? pendingRead.tabId : null,
      previous?.tabId
    ].filter(Number.isInteger))];
    let tabId;
    for (const candidate of candidates) {
      try {
        const tab = await chrome.tabs.get(candidate);
        if (tab.url && /^https?:/.test(tab.url)) { tabId = tab.id; break; }
      } catch { /* Skip a tab id saved by a closed or replaced tab. */ }
    }
    if (!tabId) throw new Error("Không tìm thấy trang gốc để đọc.");
    await installSelectionButton(tabId);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readMode => {
        const selection = window.getSelection()?.toString().trim();
        const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
        if (readMode === "selection" && !selection) return { title: document.title, html: "", url: location.href, selected: false };
        if (selection && readMode !== "article") return { title: document.title, html: `<p>${escape(selection)}</p>`, url: location.href, selected: true };
        const visible = node => {
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
        };
        const candidates = [
          '[itemprop="articleBody"]', "#chapter-c", "#chapter-content", "#chapterContent",
          ".chapter-content", ".chapter__content", ".reader__content", ".read-content",
          ".content-chapter", ".content-body", ".entry-content", ".post-content", "article"
        ];
        const findRoot = () => candidates.map(selector => document.querySelector(selector)).find(node => node && visible(node) && node.innerText.trim().length > 160)
          || document.querySelector("main") || document.querySelector('[role="main"]') || document.body;
        const root = findRoot();
        if (!window.__leoReaderContentObserver) {
          let previousText = findRoot().innerText.trim();
          let changeTimer;
          const observer = new MutationObserver(() => {
            clearTimeout(changeTimer);
            changeTimer = setTimeout(() => {
              const nextText = findRoot().innerText.trim();
              if (nextText === previousText) return;
              previousText = nextText;
              try { chrome.runtime.sendMessage({ type: "leo-reader-content-changed" }).catch(() => {}); } catch {}
            }, 700);
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          window.__leoReaderContentObserver = observer;
        }
        const locked = /webnovel\.vn$/i.test(location.hostname)
          && !candidates.some(selector => {
            const node = document.querySelector(selector);
            return node && visible(node) && node.innerText.trim().length > 160;
          })
          && !!document.querySelector(".unlock__full, .unlock__chapter, #click-to-show");
        if (locked) return { title: document.title, html: "", url: location.href, selected: false, locked: true };
        let markup;
        if (root === document.body || root.matches("main, [role='main']")) {
          const blocks = [...root.querySelectorAll("h1,h2,h3,h4,p,blockquote,pre,ul,ol,figure,img")]
            .filter(node => !node.closest("nav,header,footer,aside,[aria-hidden='true'],.reader__actions,.unlock__full,.unlock__chapter,.bastorypush"))
            .filter(node => node.children.length || node.innerText.trim().length > 35);
          markup = blocks.map(node => node.outerHTML).join("");
        } else {
          const content = root.cloneNode(true);
          content.querySelectorAll(".bastorypush").forEach(node => node.remove());
          markup = content.innerHTML;
        }
        return { title: document.title, html: markup, url: location.href, selected: false };
      },
      args: [mode]
    });
    if (result.locked) {
      stopSpeech();
      await chrome.storage.local.remove(tabSessionKey);
      articleBody.replaceChildren();
      sentences = [];
      sentenceSpans = [];
      article.hidden = true;
      $("#empty-state").hidden = false;
      $("#progress").max = "0";
      setCurrent(0);
      status.textContent = "Chương này chưa hiển thị nội dung. Hãy đăng nhập hoặc mở chương trên trang rồi thử lại.";
      return;
    }
    if (!result.html) {
      if (refresh) {
        stopSpeech();
        await chrome.storage.local.remove(tabSessionKey);
        articleBody.replaceChildren();
        sentences = [];
        sentenceSpans = [];
        article.hidden = true;
        $("#empty-state").hidden = false;
        $("#progress").max = "0";
        setCurrent(0);
      }
      status.textContent = mode === "selection" ? "Hãy bôi đen đoạn văn bản trên trang trước." : "Không tìm thấy nội dung đọc được trên trang này.";
      return;
    }
    const pending = pendingRead?.url === result.url;
    if (pending) await chrome.storage.local.remove(pendingStorageKey);
    if (!refresh && mode === "auto" && !result.selected && previous?.url === result.url) {
      articleBody.replaceChildren(safeArticle(previous.html, result.url));
      decorateSentences(articleBody);
      $("#article-title").textContent = previous.title || result.title;
      sourceUrl = result.url;
      sourceTabId = tabId;
      current = Math.min(previous.current || 0, Math.max(0, sentences.length - 1));
      article.hidden = false;
      $("#empty-state").hidden = true;
      $("#progress").max = String(Math.max(0, sentences.length - 1));
      setCurrent(current);
      status.textContent = `${sentences.length} câu · đã khôi phục vị trí đọc`;
      return;
    }
    const resumeAt = previous?.url === result.url ? previous.current || 0 : 0;
    await setArticle(result.title, result.html, result.url, resumeAt, tabId);
  } catch (error) {
    status.textContent = error.message || "Không thể đọc trang này.";
  }
}

async function loadVoices() {
  const saved = (await chrome.storage.local.get("selectedVoice")).selectedVoice;
  const select = $("#voice");
  const old = select.value || saved;
  select.replaceChildren();
  let chromeVoices = [];
  let edgeVoices = [];
  let edgeHelperAvailable = false;
  if (chrome.tts?.getVoices) {
    try { chromeVoices = (await new Promise(resolve => chrome.tts.getVoices(resolve))).map(voice => ({ id: `chrome:${voice.voiceName}`, name: voice.voiceName, lang: voice.lang || "", engine: "chrome", events: voice.eventTypes || [] })); } catch {}
  }
  const systemVoices = window.speechSynthesis ? speechSynthesis.getVoices().map(voice => ({ id: `system:${voice.voiceURI}`, name: voice.name, lang: voice.lang, engine: "system", voice })) : [];
  try {
    const response = await fetch("http://127.0.0.1:17843/voices");
    if (!response.ok) throw new Error("helper offline");
    const available = await response.json();
    edgeVoices = available.map(voice => ({ id: `edge:${voice.name}`, name: voice.name, lang: voice.locale, engine: "edge" }));
    edgeHelperAvailable = true;
  } catch {}
  const knownVoices = new Set([...chromeVoices, ...edgeVoices].map(voice => `${voice.name}|${voice.lang}`));
  voices = [...chromeVoices, ...edgeVoices, ...systemVoices.filter(voice => !knownVoices.has(`${voice.name}|${voice.lang}`))];
  voices.forEach(voice => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = `${voice.engine === "edge" ? "Microsoft Edge · " : ""}${voice.name}${voice.lang ? ` (${voice.lang})` : ""}`;
    select.append(option);
  });
  if (!edgeHelperAvailable) {
    const option = document.createElement("option");
    option.value = "edge:helper-offline";
    option.textContent = "Edge Read Aloud · khởi động helper";
    option.disabled = true;
    select.append(option);
  }
  if (!voices.length) {
    const option = document.createElement("option");
    option.textContent = "Giọng mặc định của trình duyệt";
    option.value = "";
    select.append(option);
  }
  if (voices.some(voice => voice.id === old)) select.value = old;
  else if (saved && voices.some(voice => voice.id === saved)) select.value = saved;
  else {
    const isEdge = /Edg\//.test(navigator.userAgent);
    const preferred = isEdge
      ? voices.find(voice => voice.engine === "edge" && /minh/i.test(voice.name))
      : voices.find(voice => voice.engine === "chrome" && /google.*(?:2|natural)/i.test(voice.name) && voice.lang.toLowerCase().startsWith("vi"));
    select.value = (preferred || voices.find(voice => voice.engine !== "edge" && voice.lang.toLowerCase().startsWith("vi")) || voices.find(voice => voice.lang.toLowerCase().startsWith("vi")) || voices[0])?.id || "";
  }
}

function finishSentence(index) {
  speaking = false;
  if (index < sentences.length - 1) speak(index + 1);
  else {
    status.textContent = "Đã đọc xong.";
    $("#play-pause").textContent = "▶";
    $("#play-pause").setAttribute("aria-label", "Phát lại");
    saveSession();
  }
}

function splitLongSpeechSentence(sentence, sentenceIndex) {
  const chunks = [];
  let remaining = sentence.trim();
  let offset = sentence.indexOf(remaining);
  while (remaining.length > 560) {
    const window = remaining.slice(0, 561);
    let splitAt = -1;
    for (const marks of [";:；：", ",，"]) {
      const candidate = Math.max(...[...marks].map(mark => window.lastIndexOf(mark)));
      if (candidate >= 100) { splitAt = candidate + 1; break; }
    }
    if (splitAt < 0) {
      const space = window.lastIndexOf(" ");
      if (space >= 100) splitAt = space;
    }
    if (splitAt < 0) return [...chunks, { text: remaining, sentenceIndex, sentenceOffset: offset, complete: true }];
    const text = remaining.slice(0, splitAt).trim();
    const sentenceOffset = sentence.indexOf(text, offset);
    chunks.push({ text, sentenceIndex, sentenceOffset, complete: false });
    offset += splitAt;
    remaining = remaining.slice(splitAt).trim();
    offset = sentence.indexOf(remaining, offset);
  }
  if (remaining) chunks.push({ text: remaining, sentenceIndex, sentenceOffset: offset, complete: true });
  return chunks;
}

function makeSpeechChunks(start) {
  const chunks = [];
  let chunk = { text: "", offsets: [], end: start };
  const finishChunk = () => {
    if (chunk.text) chunks.push(chunk);
    chunk = { text: "", offsets: [], end: chunk.end };
  };

  for (let sentenceIndex = start; sentenceIndex < sentences.length; sentenceIndex += 1) {
    for (const piece of splitLongSpeechSentence(sentences[sentenceIndex], sentenceIndex)) {
      const proposed = `${chunk.text} ${piece.text}`.trim();
      if (chunk.text && proposed.length > 560) finishChunk();
      const separator = chunk.text ? " " : "";
      chunk.offsets.push({
        sentenceIndex,
        charIndex: chunk.text.length + separator.length,
        sentenceOffset: piece.sentenceOffset,
      });
      chunk.text += separator + piece.text;
      chunk.end = piece.complete ? sentenceIndex + 1 : sentenceIndex;
      if (chunk.text.length >= 360) finishChunk();
    }
  }
  finishChunk();
  if (chunks.length > 1) {
    const last = chunks.at(-1);
    const previous = chunks.at(-2);
    if (last.text.length < 100 && previous.text.length < 360 && previous.text.length + 1 + last.text.length <= 560) {
      const shift = previous.text.length + 1;
      previous.text += ` ${last.text}`;
      previous.offsets.push(...last.offsets.map(offset => ({ ...offset, charIndex: offset.charIndex + shift })));
      previous.end = last.end;
      chunks.pop();
    }
  }
  return chunks;
}

function setVoiceLoading(loading) {
  $("#voice-loading").hidden = !loading;
}

function speak(index = current) {
  if (!sentences.length) { status.textContent = "Không có nội dung để đọc. Hãy tải lại trang trong reader."; return; }
  if (speaking || paused) stopSpeech();
  const token = ++speechToken;
  current = Math.max(0, Math.min(index, sentences.length - 1));
  const text = sentences[current];
  const voice = voices.find(item => item.id === $("#voice").value);
  const rate = Number(settings.speed);
  speaking = true;
  paused = false;
  setCurrent(current);
  $("#play-pause").textContent = "Ⅱ";
  $("#play-pause").setAttribute("aria-label", "Tạm dừng");
  status.textContent = `Đang đọc ${current + 1} / ${sentences.length}`;
  setVoiceLoading(true);
  if (voice?.engine === "edge") {
    const chunks = makeSpeechChunks(current);
    const playEdgeChunk = async chunkIndex => {
      if (token !== speechToken) return;
      if (chunkIndex >= chunks.length) { finishSentence(sentences.length - 1); return; }
      const chunk = chunks[chunkIndex];
      const first = chunk.offsets[0];
      setCurrent(first.sentenceIndex);
      status.textContent = `Đang đọc ${current + 1} / ${sentences.length}`;
      setVoiceLoading(true);
      const response = await fetch("http://127.0.0.1:17843/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk.text, voice: voice.name, speed: rate })
      });
      if (!response.ok) throw new Error(`Edge TTS helper lỗi (${response.status}).`);
      const encoded = response.headers.get("X-Word-Boundaries") || "W10=";
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      edgeWords = JSON.parse(new TextDecoder().decode(bytes));
      const audio = await response.blob();
      if (token !== speechToken) return;
      if (edgeAudioUrl) URL.revokeObjectURL(edgeAudioUrl);
      edgeAudioUrl = URL.createObjectURL(audio);
      edgeAudio.src = edgeAudioUrl;
      edgeAudio.ontimeupdate = () => {
        if (token !== speechToken || !edgeWords.length) return;
        let boundary = edgeWords[0];
        for (const word of edgeWords) {
          if (word.offset > edgeAudio.currentTime) break;
          boundary = word;
        }
        let offset = chunk.offsets[0];
        for (const candidate of chunk.offsets) {
          if (candidate.charIndex > boundary.charIndex) break;
          offset = candidate;
        }
        setCurrent(offset.sentenceIndex, offset.sentenceOffset + boundary.charIndex - offset.charIndex);
      };
      edgeAudio.onended = () => { if (token === speechToken) playEdgeChunk(chunkIndex + 1).catch(handleEdgeError); };
      setVoiceLoading(false);
      if (paused) return;
      await edgeAudio.play();
    };
    const handleEdgeError = error => {
      if (token === speechToken) {
        setVoiceLoading(false);
        speaking = false;
        $("#play-pause").textContent = "▶";
        $("#play-pause").setAttribute("aria-label", "Phát lại");
        status.textContent = `${error.message} Khởi động edge_tts_helper.py để dùng giọng Edge.`;
      }
    };
    playEdgeChunk(0).catch(handleEdgeError);
  } else if (voice?.engine === "chrome") {
    try {
      const supportsEnd = voice.events.includes("end");
      const desiredEventTypes = ["end", "word", "sentence"].filter(type => voice.events.includes(type));
      const chunks = makeSpeechChunks(current);
      let nextChunkIndex = 0;
      const enqueueChunk = chunkIndex => {
        const chunk = chunks[chunkIndex];
        const options = {
          voiceName: voice.name,
          lang: voice.lang || "vi-VN",
          rate,
          enqueue: chunkIndex > 0,
          ...(desiredEventTypes.length ? { desiredEventTypes } : {}),
          onEvent: event => {
            if (token !== speechToken) return;
            if (event.type === "start" || event.type === "word" || event.type === "sentence") setVoiceLoading(false);
            if (event.type === "word" || event.type === "sentence") {
              const charIndex = event.charIndex || 0;
              let offset = chunk.offsets[0];
              for (const candidate of chunk.offsets) {
                if (candidate.charIndex > charIndex) break;
                offset = candidate;
              }
              setCurrent(offset.sentenceIndex, offset.sentenceOffset + charIndex - offset.charIndex);
            }
            if (event.type === "end") {
              if (chunk.end < sentences.length) {
                current = chunk.end;
                setCurrent(current);
                status.textContent = `Đang đọc ${current + 1} / ${sentences.length}`;
                saveSession();
                if (nextChunkIndex < chunks.length) enqueueChunk(nextChunkIndex++);
              } else {
                speaking = false;
                status.textContent = "Đã đọc xong.";
                $("#play-pause").textContent = "▶";
                $("#play-pause").setAttribute("aria-label", "Phát lại");
                saveSession();
              }
            }
            if (event.type === "error") {
              chrome.tts.stop();
              setVoiceLoading(false);
              speaking = false;
              status.textContent = event.errorMessage || "Giọng đọc gặp lỗi.";
              $("#play-pause").textContent = "▶";
              $("#play-pause").setAttribute("aria-label", "Phát lại");
            }
          }
        };
        chrome.tts.speak(chunk.text, options).catch(error => {
          if (token !== speechToken) return;
          chrome.tts.stop();
          setVoiceLoading(false);
          speaking = false;
          status.textContent = error.message || "Không thể dùng giọng này.";
          $("#play-pause").textContent = "▶";
          $("#play-pause").setAttribute("aria-label", "Phát lại");
        });
      };
      while (nextChunkIndex < chunks.length && (nextChunkIndex < 3 || !supportsEnd)) enqueueChunk(nextChunkIndex++);
      if (!supportsEnd || !voice.events.includes("start")) {
        let started = false;
        let idleChecks = 0;
        let startChecks = 0;
        const monitor = async () => {
          if (token !== speechToken || !speaking) return;
          try {
            if (await chrome.tts.isSpeaking()) { started = true; idleChecks = 0; setVoiceLoading(false); }
            else if (!supportsEnd && started && ++idleChecks === 4) {
              speaking = false;
              status.textContent = "Đã đọc xong.";
              $("#play-pause").textContent = "▶";
              $("#play-pause").setAttribute("aria-label", "Phát lại");
              saveSession();
              return;
            } else if (!started && ++startChecks === 40) {
              setVoiceLoading(false);
              speaking = false;
              status.textContent = "Chrome TTS không bắt đầu phát. Hãy thử chọn giọng khác.";
              $("#play-pause").textContent = "▶";
              $("#play-pause").setAttribute("aria-label", "Phát lại");
              return;
            }
          } catch {}
          setTimeout(monitor, 500);
        };
        setTimeout(monitor, 500);
      }
    }
    catch (error) { speaking = false; status.textContent = error.message; }
  } else if (window.speechSynthesis) {
    utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || "vi-VN";
    utterance.rate = rate;
    if (voice?.voice) utterance.voice = voice.voice;
    utterance.onstart = () => setVoiceLoading(false);
    utterance.onboundary = event => setCurrent(current, event.charIndex);
    utterance.onend = () => finishSentence(current);
    utterance.onerror = event => { setVoiceLoading(false); if (event.error !== "canceled") { speaking = false; status.textContent = "Giọng đọc gặp lỗi."; } };
    speechSynthesis.speak(utterance);
  } else {
    setVoiceLoading(false);
    speaking = false;
    status.textContent = "Không có giọng đọc khả dụng.";
  }
  saveSession();
}

function stopSpeech() {
  speechToken += 1;
  setVoiceLoading(false);
  if (chrome.tts?.stop) chrome.tts.stop();
  if (window.speechSynthesis) speechSynthesis.cancel();
  edgeAudio.pause();
  edgeAudio.removeAttribute("src");
  edgeAudio.load();
  edgeAudio.ontimeupdate = null;
  edgeAudio.onended = null;
  edgeWords = [];
  if (edgeAudioUrl) URL.revokeObjectURL(edgeAudioUrl);
  edgeAudioUrl = "";
  speaking = false;
  paused = false;
  utterance = null;
  $("#play-pause").textContent = "▶";
  $("#play-pause").setAttribute("aria-label", "Phát");
}

function togglePlayback() {
  const voice = voices.find(item => item.id === $("#voice").value);
  if (speaking && !paused) {
    if (voice?.engine === "edge") edgeAudio.pause();
    else if (voice?.engine === "chrome") chrome.tts.pause();
    else speechSynthesis.pause();
    paused = true;
    $("#play-pause").textContent = "▶";
    $("#play-pause").setAttribute("aria-label", "Tiếp tục");
    status.textContent = "Đã tạm dừng.";
  } else if (paused) {
    if (voice?.engine === "edge") edgeAudio.play();
    else if (voice?.engine === "chrome") chrome.tts.resume();
    else speechSynthesis.resume();
    paused = false;
    $("#play-pause").textContent = "Ⅱ";
    $("#play-pause").setAttribute("aria-label", "Tạm dừng");
    status.textContent = `Đang đọc ${current + 1} / ${sentences.length}`;
  } else speak(current);
}

async function changeViewMode(mode) {
  const openingPanel = mode === "side" && body.dataset.view === "full" && sourceTabId
    ? chrome.sidePanel.open({ tabId: sourceTabId })
    : null;
  settings.viewMode = mode;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await saveSettings();
  if (mode === "full" && body.dataset.view !== "full") {
    await saveSession();
    await chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?view=full&tabId=${sourceTabId}`) });
  } else if (mode === "side" && body.dataset.view === "full") {
    if (openingPanel) await openingPanel;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) await chrome.tabs.remove(tab.id);
  }
}

$("#read-page").addEventListener("click", () => readPageFromClick("article"));
$("#read-selection").addEventListener("click", () => readPageFromClick("selection"));
$("#refresh").addEventListener("click", () => readPageFromClick("article"));
$("#settings-toggle").addEventListener("click", () => {
  $("#settings").hidden = !$("#settings").hidden;
  if (body.dataset.view === "overlay") window.parent.postMessage({ type: "leo-reader-resize-overlay", open: !$("#settings").hidden }, "*");
});
$("#font-smaller").addEventListener("click", () => changeSize(-1));
$("#font-larger").addEventListener("click", () => changeSize(1));
function changeSize(delta) { settings.size = Math.max(14, Math.min(32, settings.size + delta)); applySettings(); saveSettings(); }
$("#play-pause").addEventListener("click", togglePlayback);
$("#previous").addEventListener("click", () => speak(Math.max(0, current - 1)));
$("#next").addEventListener("click", () => speak(Math.min(sentences.length - 1, current + 1)));
$("#close-full").addEventListener("click", async () => {
  if (body.dataset.view === "overlay") {
    stopSpeech();
    window.parent.postMessage({ type: "leo-reader-close-overlay" }, "*");
    return;
  }
  if (sourceTabId) await chrome.sidePanel.open({ tabId: sourceTabId });
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await chrome.tabs.remove(tab.id);
});
$("#progress").addEventListener("input", event => { current = Number(event.target.value); setCurrent(current); saveSession(); });
$("#progress").addEventListener("change", () => { if (speaking) speak(current); });
$("#voice").addEventListener("change", event => chrome.storage.local.set({ selectedVoice: event.target.value }));
$("#speed").addEventListener("change", async event => { settings.speed = Number(event.target.value); await saveSettings(); if (speaking) speak(current); });
$("#font").addEventListener("change", event => updateSetting("font", event.target.value));
$("#theme").addEventListener("change", event => updateSetting("theme", event.target.value));
$("#line-spacing").addEventListener("change", event => updateSetting("line", event.target.value));
$("#letter-spacing").addEventListener("change", event => updateSetting("letter", event.target.value));
$("#show-links").addEventListener("change", event => updateSetting("links", event.target.checked));
$("#show-images").addEventListener("change", event => updateSetting("images", event.target.checked));
$("#highlight").addEventListener("change", event => updateSetting("highlight", event.target.value));
$("#view-mode").addEventListener("change", event => changeViewMode(event.target.value));
async function updateSetting(key, value) { settings[key] = value; applySettings(); await saveSettings(); }
$("#reset-settings").addEventListener("click", async () => { settings = { ...defaults }; applySettings(); await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); await saveSettings(); });
articleBody.addEventListener("click", event => {
  if (event.target.closest("a")) return;
  const sentence = event.target.closest(".sentence");
  if (sentence) { current = Number(sentence.dataset.index); setCurrent(current); saveSession(); }
});

async function init() {
  const stored = await chrome.storage.local.get(settingsKey);
  settings = { ...defaults, ...(stored[settingsKey] || {}) };
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  applySettings();
  await loadVoices();
  if (chrome.tts?.onVoicesChanged) chrome.tts.onVoicesChanged.addListener(loadVoices);
  if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", loadVoices);
  const requestedTabId = Number(new URLSearchParams(location.search).get("tabId"));
  let tab = Number.isInteger(requestedTabId) && requestedTabId > 0 ? await chrome.tabs.get(requestedTabId).catch(() => null) : null;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) {
    sourceUrl = tab.url;
    sourceTabId = tab.id;
    if (body.dataset.view !== "overlay") installSelectionButton(tab.id).catch(error => { status.textContent = error.message || "Không thể hiện nút đọc đoạn đã chọn trên trang này."; });
  }
  const tabSessionKey = sessionKey(sourceTabId);
  const tabPendingKey = pendingReadKey(sourceTabId);
  const readerStorage = await chrome.storage.local.get([...new Set([tabSessionKey, tabPendingKey, "readingSession", "pendingRead"])]);
  const pendingRead = readerStorage[tabPendingKey] || (readerStorage.pendingRead?.tabId === sourceTabId ? readerStorage.pendingRead : null);
  const previous = readerStorage[tabSessionKey] || (readerStorage.readingSession?.tabId === sourceTabId ? readerStorage.readingSession : null);
  if (body.dataset.view === "full" && pendingRead?.tabId === sourceTabId) {
    handlePendingRead(pendingRead);
  } else if (body.dataset.view === "full" && previous?.html) {
    sourceUrl = previous.url || "";
    sourceTabId = previous.tabId || null;
    await setArticle(previous.title, previous.html, sourceUrl, previous.current || 0, sourceTabId);
    status.textContent = `${sentences.length} câu · đã khôi phục vị trí đọc`;
  } else if (tab?.id && pendingRead?.url === tab.url) handlePendingRead(pendingRead);
  else if (tab?.url && previous?.url === tab.url && previous?.html) {
    await setArticle(previous.title, previous.html, previous.url, previous.current || 0, tab.id);
    status.textContent = `${sentences.length} câu · đã khôi phục vị trí đọc`;
  }
  else if (body.dataset.view === "side" && tab?.id && /^https?:/.test(tab.url || "")) getPage("auto");
}

window.addEventListener("pagehide", () => {
  stopSpeech();
  if (!article.hidden) saveSession();
});

function scheduleSourceRefresh(tabId) {
  clearTimeout(pageRefreshTimer);
  pageRefreshTimer = setTimeout(async () => {
    if (tabId !== sourceTabId) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url || !/^https?:/.test(tab.url)) return;
    sourceUrl = tab.url;
    getPage("auto", true);
  }, 700);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== sourceTabId || !tab.url || !/^https?:/.test(tab.url)) return;
  sourceUrl = tab.url;
  if (changeInfo.status !== "complete" && !(changeInfo.url && tab.status === "complete")) return;
  scheduleSourceRefresh(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (body.dataset.view !== "side" || speaking || paused || tabId === sourceTabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  sourceTabId = tab.id;
  sourceUrl = tab.url;
  getPage("auto");
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "leo-reader-content-changed" && sender.tab?.id === sourceTabId) scheduleSourceRefresh(sourceTabId);
});

function handlePendingRead(pending) {
  if (pending.tabId !== sourceTabId) return;
  if (pending.target === "overlay" && body.dataset.view !== "overlay") return;
  if (pending.nonce === lastReadNonce) return;
  lastReadNonce = pending.nonce;
  if (pending.mode === "selection" && pending.text?.trim()) {
    body.classList.add("selection-player");
    const text = pending.text.trim().replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    setArticle(pending.title || "Đoạn văn bản đã chọn", `<p>${text.replace(/\n+/g, "<br>")}</p>`, pending.url || sourceUrl, 0, pending.tabId)
      .then(() => speak(0)).catch(error => { status.textContent = error.message || "Không thể phát đoạn đã chọn."; });
  } else getPage(pending.mode);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[pendingReadKey(sourceTabId)]?.newValue) handlePendingRead(changes[pendingReadKey(sourceTabId)].newValue);
});

init();
