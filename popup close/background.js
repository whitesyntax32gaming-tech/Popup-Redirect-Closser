'use strict';

/* ------------------------------------------------------------------ *
 *  Popup & Redirect Closer — Background Service Worker
 * ------------------------------------------------------------------ */

const SETTINGS_KEY = 'pak_settings';
const LOG_KEY = 'pak_log';
const COUNT_KEY = 'pak_count';

const MAX_LOG = 60;
const BLANK_GRACE_MS = 250;       // Window to verify if about:blank remains blank or navigates
const RECENT_TAB_TTL_MS = 15000;  // Watch window for redirects on newly opened tabs

const DEFAULT_SETTINGS = {
  enabled: true,
  exemptUserTabs: true,     // Never close tabs created directly by user (Ctrl+T, +, bookmarks)
  allowSameDomain: true,    // Allow popup if it starts with initial domain or URL of current site
  blockPopups: true,        // Popups, popunders, window.open, iframe popups
  blockBlank: true,         // about:blank & empty tabs
  blockRedirects: true,     // HTTP redirects, redirect parameters & hops
  blockExternal: true,      // Tabs leading off the current website
  allowlist: []             // User allowed domains
};

/* ------------------------------------------------------------------ *
 *  Exemptions: OAuth, Auth, Search Engines
 * ------------------------------------------------------------------ */

// Popular search engines — clicking search results is intended to lead off-site
const SEARCH_ENGINES = new Set([
  'google.com', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'google.it',
  'google.es', 'google.com.au', 'google.co.in', 'google.co.jp', 'google.com.br',
  'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'qwant.com',
  'startpage.com', 'brave.com', 'search.brave.com', 'kagi.com', 'baidu.com', 'yandex.com'
]);

// Critical auth, OAuth, SSO, and payment gateways that should never be blocked
const AUTH_ALLOW = [
  'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com',
  'login.microsoftonline.com', 'login.live.com', 'login.yahoo.com',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'facebook.com', 'web.facebook.com', 'm.facebook.com',
  'twitter.com', 'x.com', 'api.twitter.com', 'api.x.com',
  'linkedin.com', 'discord.com', 'slack.com', 'zoom.us',
  'paypal.com', 'checkout.stripe.com', 'js.stripe.com', 'connect.stripe.com',
  'auth0.com', 'okta.com', 'onelogin.com', 'login.gov', 'id.me', 'duosecurity.com',
  'twitch.tv', 'reddit.com', 'steampowered.com', 'store.steampowered.com',
  'spotify.com', 'accounts.spotify.com', 'signin.aws.amazon.com',
  'console.cloud.google.com', 'dropbox.com', 'www.dropbox.com',
  'notion.so', 'figma.com', 'amazon.com', 'netflix.com'
];

// Common multi-part TLDs (e.g. co.uk, com.au) for accurate root domain extraction
const MULTI_TLDS = new Set([
  'co.uk', 'gov.uk', 'ac.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  'com.sg', 'edu.sg', 'gov.sg',
  'com.mx', 'edu.mx', 'gob.mx', 'org.mx',
  'com.tw', 'idv.tw', 'org.tw',
  'com.tr', 'edu.tr', 'gov.tr',
  'com.ph', 'net.ph', 'org.ph',
  'co.za', 'net.za', 'org.za',
  'co.kr', 'ne.kr', 're.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'org.hk', 'edu.hk',
  'com.ar', 'com.co', 'com.my', 'com.pk', 'com.ng', 'com.eg'
]);

// Ad / tracker network patterns
const AD_LABELS = new Set([
  'doubleclick', 'googlesyndication', 'googleadservices', 'adsense', 'admob',
  'adservice', 'adnxs', 'adsrvr', 'rubiconproject', 'pubmatic', 'criteo',
  'taboola', 'outbrain', 'mgid', 'revcontent', 'popads', 'popcash',
  'propellerads', 'propeller', 'adcash', 'clickadu', 'hilltopads', 'exoclick',
  'juicyads', 'trafficjunky', 'adsterra', 'onclickads', 'clickaine', 'zedo',
  'adroll', 'smartadserver', 'bidswitch', 'casalemedia', 'teads',
  'sharethrough', 'yieldmo', 'smaato', 'mopub', 'inmobi', 'applovin',
  'unityads', 'vungle', 'chartboost', 'ironsrc', 'mobvista', 'mintegral',
  'adcolony', 'popunder', 'popmyads', 'adfoc', 'adfly', 'adshnk', 'clksite',
  'shorte', 'revenuehits', 'popjar', 'adnium', 'trafficstars',
  'trafficfactory', 'clickbank', 'adskeeper', 'bidvertiser', 'infolinks',
  'marketgid', 'lentainform', 'kadam', 'adpushup', 'ezoic', 'playwire',
  'venatus', 'nitropay', 'snigel', 'setupad', 'monumetric', 'appnexus',
  'magnite', 'openx', 'pubnative', 'verve', 'loopme', 'moloco', 'adikteev',
  'yandex', 'sape', 'bttrack', 'adplus', 'adnami', 'clickagy'
]);

const AD_SUBDOMAIN_RE =
  /^(ad|ads|adv|advert|adserver|adservice|advertise|pop|popup|popunder|click|clk|clicks|track|tracker|tracking|trk|promo|sponsor|redirect|redirector|px|pixel|beacon)\d*$/i;

/* ------------------------------------------------------------------ *
 *  In-Memory State & Caches
 * ------------------------------------------------------------------ */

// Handled tab timestamps to prevent duplicate closing
const handled = new Map(); // tabId -> timestamp

// Recent tabs created: tabId -> { createdAt, sourceTabId, sourceHost, sourceRoot, sourceFrameId, blankTimer, isPopup }
const recentTabs = new Map();

// Tab URL Cache: tabId -> { url, host, rootDomain, time }
const tabUrlCache = new Map();

// Tabs created directly by the user (Ctrl+T, "+", address bar, bookmarks)
const userCreatedTabs = new Set();

// Temporarily allowed URLs (e.g. user explicitly clicked "Reopen")
const tempAllowedUrls = new Map(); // url -> expiry

function markHandled(tabId) {
  handled.set(tabId, Date.now());
  if (handled.size > 500) handled.delete(handled.keys().next().value);
}

function isAlreadyHandled(tabId) {
  const t = handled.get(tabId);
  return t != null && Date.now() - t < 10000;
}

function markTempAllowed(url, ms = 15000) {
  if (!url) return;
  tempAllowedUrls.set(url, Date.now() + ms);
  setTimeout(() => tempAllowedUrls.delete(url), ms);
}

function isTempAllowed(url) {
  if (!url) return false;
  const exp = tempAllowedUrls.get(url);
  if (exp && Date.now() < exp) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 *  Settings Helpers (Stored in chrome.storage.local)
 * ------------------------------------------------------------------ */

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, stored[SETTINGS_KEY] || {});
}

async function setSettings(patch) {
  const next = Object.assign({}, await getSettings(), patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/* ------------------------------------------------------------------ *
 *  URL & Domain Helpers
 * ------------------------------------------------------------------ */

function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function getRootDomain(hostname) {
  if (!hostname) return '';
  hostname = hostname.toLowerCase().trim().replace(/\.$/, '');
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost') {
    return hostname;
  }
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_TLDS.has(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function hostMatches(host, entry) {
  if (!host || !entry) return false;
  host = host.toLowerCase();
  entry = entry.toLowerCase();
  return host === entry || host.endsWith('.' + entry);
}

function isSearchEngine(host) {
  const root = getRootDomain(host);
  return SEARCH_ENGINES.has(root) || SEARCH_ENGINES.has(host);
}

function isAllowedHost(host, settings) {
  if (!host) return false;
  host = host.toLowerCase();
  for (const entry of AUTH_ALLOW) {
    if (hostMatches(host, entry)) return true;
  }
  for (const entry of settings.allowlist || []) {
    if (hostMatches(host, String(entry))) return true;
  }
  return false;
}

function isAdHost(host) {
  if (!host) return false;
  const labels = host.split('.');
  for (const label of labels) {
    if (AD_LABELS.has(label)) return true;
  }
  if (labels.length > 2 && AD_SUBDOMAIN_RE.test(labels[0])) return true;
  return false;
}

function isBlankUrl(url) {
  if (!url) return true;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed === '' ||
    trimmed === 'about:blank' ||
    trimmed.startsWith('about:blank#') ||
    trimmed === 'about:srcdoc' ||
    trimmed.startsWith('javascript:void') ||
    trimmed === 'javascript:;'
  );
}

function isInternalUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase().trim();
  return (
    u.startsWith('chrome://') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('chrome-search://') ||
    u.startsWith('edge://') ||
    u.startsWith('devtools://') ||
    u.startsWith('about:newtab') ||
    u.startsWith('about:home')
  );
}

function hasRedirectParam(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    const redirectKeys = [
      'url', 'redirect', 'redirect_url', 'redirect_uri', 'target', 'dest',
      'destination', 'goto', 'link', 'to', 'out', 'href', 'r', 'u', 'clickid', 'affid'
    ];
    for (const key of redirectKeys) {
      const val = u.searchParams.get(key);
      if (val && /^https?:\/\//i.test(val)) return true;
    }
    const path = u.pathname.toLowerCase();
    if (/\/(out|goto|redirect|click|links?)\.php$/i.test(path) || /^\/(out|goto|redirect|click|links?)\//i.test(path)) {
      return true;
    }
  } catch {}
  return false;
}

function isSameSiteOrUrl(targetUrl, targetHost, sourceUrl, sourceHost) {
  if (!targetUrl && !targetHost) return false;
  if (!sourceUrl && !sourceHost) return false;

  const tUrl = String(targetUrl || '').toLowerCase();
  const sUrl = String(sourceUrl || '').toLowerCase();

  // 1. Check if target URL starts with current site's initial URL or origin
  if (sUrl && tUrl) {
    try {
      const srcObj = new URL(sUrl);
      const srcOrigin = srcObj.origin.toLowerCase();
      if (tUrl.startsWith(srcOrigin)) return true;
      if (tUrl.startsWith(sUrl)) return true;
    } catch {}
  }

  // 2. Check if target host starts with or matches current site's domain / root domain
  if (sourceHost && targetHost) {
    const sHost = sourceHost.toLowerCase().trim();
    const tHost = targetHost.toLowerCase().trim();

    if (tHost === sHost || tHost.endsWith('.' + sHost) || tHost.startsWith(sHost)) {
      return true;
    }

    const sRoot = getRootDomain(sHost);
    const tRoot = getRootDomain(tHost);
    if (sRoot && tRoot && (tRoot === sRoot || tHost.startsWith(sRoot))) {
      return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ *
 *  Logging & Badge
 * ------------------------------------------------------------------ */

async function logBlock({ host, url, reasons, tag }) {
  const data = await chrome.storage.local.get([LOG_KEY, COUNT_KEY]);
  const log = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  log.unshift({
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
    host: host || '(blank)',
    url: url || '',
    reasons: reasons || [],
    tag: tag || 'popup', // 'popup' | 'redirect' | 'blank' | 'offsite'
    ts: Date.now()
  });
  const count = (data[COUNT_KEY] || 0) + 1;
  await chrome.storage.local.set({
    [LOG_KEY]: log.slice(0, MAX_LOG),
    [COUNT_KEY]: count
  });
  updateBadge(count);
}

function updateBadge(count) {
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
  } catch {}
}

/* ------------------------------------------------------------------ *
 *  Tab Killer
 * ------------------------------------------------------------------ */

async function killTab(tabId, host, url, reasons, tag) {
  if (isAlreadyHandled(tabId)) return;
  markHandled(tabId);

  // Clear any pending timers for this tab
  const rec = recentTabs.get(tabId);
  if (rec && rec.blankTimer) clearTimeout(rec.blankTimer);
  recentTabs.delete(tabId);

  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Tab already closed
  }

  await logBlock({ host, url, reasons, tag });
}

/* ------------------------------------------------------------------ *
 *  Evaluation Engine
 * ------------------------------------------------------------------ */

async function evaluateTab({ tabId, url, sourceTabId, sourceFrameId, isPopupWin }) {
  if (tabId == null || tabId < 0) return;
  if (isAlreadyHandled(tabId)) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  // Exempt user-created tabs (Ctrl+T, "+", bookmarks, address bar)
  if (settings.exemptUserTabs && userCreatedTabs.has(tabId)) {
    return;
  }

  const rawUrl = String(url || '').trim();

  // Browser internal pages (newtab, extensions, devtools, etc.) are always exempt
  if (isInternalUrl(rawUrl)) {
    userCreatedTabs.add(tabId);
    return;
  }

  // If user explicitly reopened this URL, allow it
  if (rawUrl && isTempAllowed(rawUrl)) return;

  // Resolve source tab information
  let sourceUrl = '';
  let sourceHost = '';
  let sourceRoot = '';
  let srcActive = null;
  let srcFocused = null;

  if (typeof sourceTabId === 'number' && sourceTabId >= 0) {
    const cached = tabUrlCache.get(sourceTabId);
    if (cached) {
      sourceUrl = cached.url;
      sourceHost = cached.host;
      sourceRoot = cached.rootDomain;
    }
    try {
      const srcTab = await chrome.tabs.get(sourceTabId);
      srcActive = srcTab.active === true;
      if (!sourceUrl && srcTab.url) {
        sourceUrl = srcTab.url;
        sourceHost = hostOf(sourceUrl);
        sourceRoot = getRootDomain(sourceHost);
      }
      try {
        const win = await chrome.windows.get(srcTab.windowId);
        srcFocused = win ? win.focused === true : null;
      } catch {}
    } catch {}
  }

  // If source site is explicitly allowed by the user, don't kill its children
  if (sourceHost && isAllowedHost(sourceHost, settings)) {
    return;
  }

  // Case 1: Blank Link / Tab
  if (isBlankUrl(rawUrl)) {
    // If opened without a source tab and not a popup window, it is a user-created new tab
    if ((sourceTabId == null || sourceTabId < 0) && !isPopupWin) {
      userCreatedTabs.add(tabId);
      return;
    }

    if (!settings.blockBlank) return;

    // Record tab in recentTabs and start a short grace timer
    let entry = recentTabs.get(tabId);
    if (!entry) {
      entry = {
        createdAt: Date.now(),
        sourceTabId,
        sourceHost,
        sourceRoot,
        sourceFrameId: sourceFrameId || 0,
        isPopup: !!isPopupWin,
        blankTimer: null
      };
      recentTabs.set(tabId, entry);
    }

    // If opened as a popup window, from an iframe, or in background, close immediately
    if (isPopupWin || sourceFrameId > 0 || srcActive === false) {
      await killTab(tabId, '(blank)', rawUrl || 'about:blank', ['Blank popup window/tab'], 'blank');
      return;
    }

    // Otherwise, watch for BLANK_GRACE_MS: if it stays blank, destroy it
    if (entry.blankTimer) clearTimeout(entry.blankTimer);
    entry.blankTimer = setTimeout(async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        const curUrl = t.pendingUrl || t.url || '';
        if (isBlankUrl(curUrl)) {
          await killTab(tabId, '(blank)', curUrl || 'about:blank', ['Blank link / tab remained empty'], 'blank');
        }
      } catch {}
    }, BLANK_GRACE_MS);
    return;
  }

  // Clear blank timer if tab navigated to a non-blank URL
  const existingEntry = recentTabs.get(tabId);
  if (existingEntry && existingEntry.blankTimer) {
    clearTimeout(existingEntry.blankTimer);
    existingEntry.blankTimer = null;
  }

  const targetHost = hostOf(rawUrl);
  const targetRoot = getRootDomain(targetHost);

  // If target is in user allowlist or recognized auth/OAuth, always allow
  if (targetHost && isAllowedHost(targetHost, settings)) {
    return;
  }

  // If enabled: Allow if popup starts with initial domain or URL of the current site
  if (settings.allowSameDomain && isSameSiteOrUrl(rawUrl, targetHost, sourceUrl, sourceHost)) {
    return;
  }

  // Case 2: Redirect Link / Hop URL
  if (settings.blockRedirects && hasRedirectParam(rawUrl)) {
    await killTab(tabId, targetHost, rawUrl, ['Redirect hop / parameter in URL'], 'redirect');
    return;
  }

  // Case 3: Off-site link (leads user away from the current website)
  if (settings.blockExternal && sourceRoot && targetRoot) {
    const isSourceSearch = isSearchEngine(sourceHost);
    if (!isSourceSearch && sourceRoot !== targetRoot) {
      await killTab(
        tabId,
        targetHost,
        rawUrl,
        [`Off-site link from ${sourceHost || sourceRoot} to ${targetHost}`],
        'offsite'
      );
      return;
    }
  }

  // Case 4: Popups & Popunders
  if (settings.blockPopups) {
    if (sourceFrameId > 0) {
      await killTab(tabId, targetHost, rawUrl, ['Popup opened from embedded iframe'], 'popup');
      return;
    }
    if (srcActive === false) {
      await killTab(tabId, targetHost, rawUrl, ['Popunder opened by background tab'], 'popup');
      return;
    }
    if (isPopupWin) {
      await killTab(tabId, targetHost, rawUrl, ['Standalone popup window'], 'popup');
      return;
    }
    if (targetHost && isAdHost(targetHost)) {
      await killTab(tabId, targetHost, rawUrl, ['Known popup/ad network domain'], 'popup');
      return;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Event Listeners
 * ------------------------------------------------------------------ */

// Trigger 1: Navigation target created by script or link
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  recentTabs.set(details.tabId, {
    createdAt: Date.now(),
    sourceTabId: details.sourceTabId,
    sourceHost: hostOf(tabUrlCache.get(details.sourceTabId)?.url),
    sourceRoot: getRootDomain(hostOf(tabUrlCache.get(details.sourceTabId)?.url)),
    sourceFrameId: details.sourceFrameId || 0,
    isPopup: false,
    blankTimer: null
  });

  evaluateTab({
    tabId: details.tabId,
    url: details.url,
    sourceTabId: details.sourceTabId,
    sourceFrameId: details.sourceFrameId
  }).catch(() => {});
});

// Trigger 2: Tab created in browser
chrome.tabs.onCreated.addListener(async (tab) => {
  const url = tab.pendingUrl || tab.url || '';

  // Internal browser tabs (chrome://, chrome-extension://, new tab page, etc.)
  if (isInternalUrl(url)) {
    userCreatedTabs.add(tab.id);
    return;
  }

  let isPopupWin = false;
  try {
    const win = await chrome.windows.get(tab.windowId);
    isPopupWin = win && win.type === 'popup';
  } catch {}

  const sourceTabId = tab.openerTabId;

  // If tab was opened without a source opener and was not registered by onCreatedNavigationTarget,
  // it was created directly by the user (Ctrl+T, "+" button, omnibox, bookmark, external app)
  const isPageSpawned = typeof sourceTabId === 'number' || recentTabs.has(tab.id) || isPopupWin;

  if (!isPageSpawned) {
    userCreatedTabs.add(tab.id);
    return; // Completely exempt user-created new tabs!
  }

  const settings = await getSettings();
  if (settings.exemptUserTabs && userCreatedTabs.has(tab.id)) {
    return;
  }

  if (!recentTabs.has(tab.id)) {
    recentTabs.set(tab.id, {
      createdAt: Date.now(),
      sourceTabId,
      sourceHost: hostOf(tabUrlCache.get(sourceTabId)?.url),
      sourceRoot: getRootDomain(hostOf(tabUrlCache.get(sourceTabId)?.url)),
      sourceFrameId: 0,
      isPopup: isPopupWin,
      blankTimer: null
    });
  }

  evaluateTab({
    tabId: tab.id,
    url,
    sourceTabId,
    sourceFrameId: 0,
    isPopupWin
  }).catch(() => {});
});

// Trigger 3: Navigation starts
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  // Never touch user-created tabs
  if (userCreatedTabs.has(details.tabId)) return;

  const h = hostOf(details.url);
  tabUrlCache.set(details.tabId, {
    url: details.url,
    host: h,
    rootDomain: getRootDomain(h),
    lastUpdated: Date.now()
  });

  const rec = recentTabs.get(details.tabId);
  if (!rec) return;

  evaluateTab({
    tabId: details.tabId,
    url: details.url,
    sourceTabId: rec.sourceTabId,
    sourceFrameId: rec.sourceFrameId,
    isPopupWin: rec.isPopup
  }).catch(() => {});
});

// Trigger 4: Navigation committed (catches HTTP server/client redirects)
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (userCreatedTabs.has(details.tabId)) return;
  if (isAlreadyHandled(details.tabId)) return;

  const rec = recentTabs.get(details.tabId);
  if (!rec && Date.now() - (tabUrlCache.get(details.tabId)?.lastUpdated || 0) > RECENT_TAB_TTL_MS) {
    return;
  }

  const qualifiers = details.transitionQualifiers || [];
  const isRedirect =
    qualifiers.includes('server_redirect') ||
    qualifiers.includes('client_redirect');

  if (isRedirect) {
    const settings = await getSettings();
    if (!settings.enabled || !settings.blockRedirects) return;

    const targetHost = hostOf(details.url);
    if (isAllowedHost(targetHost, settings)) return;
    if (isTempAllowed(details.url)) return;

    // If enabled: Allow if redirect target starts with initial domain or URL of the current site
    const srcTabUrl = rec ? tabUrlCache.get(rec.sourceTabId)?.url : '';
    const srcHost = rec ? rec.sourceHost : '';
    if (settings.allowSameDomain && isSameSiteOrUrl(details.url, targetHost, srcTabUrl, srcHost)) {
      return;
    }

    await killTab(
      details.tabId,
      targetHost,
      details.url,
      [`Redirect detected (${qualifiers.join(', ')})`],
      'redirect'
    );
  }
});

// Keep track of tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.url;
  if (currentUrl) {
    const h = hostOf(currentUrl);
    tabUrlCache.set(tabId, {
      url: currentUrl,
      host: h,
      rootDomain: getRootDomain(h),
      lastUpdated: Date.now()
    });
  }
});

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  userCreatedTabs.delete(tabId);
  const rec = recentTabs.get(tabId);
  if (rec && rec.blankTimer) clearTimeout(rec.blankTimer);
  recentTabs.delete(tabId);
  tabUrlCache.delete(tabId);
});

// Periodically clean up stale recentTabs
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of recentTabs.entries()) {
    if (now - item.createdAt > RECENT_TAB_TTL_MS) {
      if (item.blankTimer) clearTimeout(item.blankTimer);
      recentTabs.delete(id);
    }
  }
}, 30000);

/* ------------------------------------------------------------------ *
 *  UI Messaging
 * ------------------------------------------------------------------ */

async function buildState() {
  const settings = await getSettings();
  const data = await chrome.storage.local.get([LOG_KEY, COUNT_KEY]);
  return {
    settings,
    log: Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [],
    count: data[COUNT_KEY] || 0
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'get-state':
          break;
        case 'set-enabled':
          await setSettings({ enabled: !!msg.enabled });
          break;
        case 'set-option':
          if (msg.key && typeof msg.value === 'boolean') {
            await setSettings({ [msg.key]: msg.value });
          }
          break;
        case 'allow-host': {
          const host = String(msg.host || '').toLowerCase().trim();
          if (host) {
            const s = await getSettings();
            const set = new Set(s.allowlist || []);
            set.add(host);
            await setSettings({ allowlist: [...set] });
          }
          break;
        }
        case 'remove-host': {
          const host = String(msg.host || '').toLowerCase().trim();
          if (host) {
            const s = await getSettings();
            const list = (s.allowlist || []).filter((h) => h.toLowerCase() !== host);
            await setSettings({ allowlist: list });
          }
          break;
        }
        case 'reset-allowlist':
          await setSettings({ allowlist: [] });
          break;
        case 'clear-log':
          await chrome.storage.local.set({ [LOG_KEY]: [], [COUNT_KEY]: 0 });
          updateBadge(0);
          break;
        case 'reopen':
          if (msg.url && /^https?:/i.test(msg.url)) {
            markTempAllowed(msg.url, 20000);
            await chrome.tabs.create({ url: msg.url, active: true });
          }
          break;
        default:
          break;
      }
      sendResponse(await buildState());
    } catch (err) {
      sendResponse({ error: String(err) });
    }
  })();
  return true;
});

/* ------------------------------------------------------------------ *
 *  Initialization
 * ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
  const data = await chrome.storage.local.get(COUNT_KEY);
  updateBadge(data[COUNT_KEY] || 0);
});
