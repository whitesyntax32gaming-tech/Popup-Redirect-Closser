'use strict';

/* ------------------------------------------------------------------ *
 *  Popup & Redirect Closer — Popup Controller
 * ------------------------------------------------------------------ */

const el = (id) => document.getElementById(id);

let state = {
  settings: {
    enabled: true,
    exemptUserTabs: true,
    allowSameDomain: true,
    blockPopups: true,
    blockBlank: true,
    blockRedirects: true,
    blockExternal: true,
    allowlist: []
  },
  log: [],
  count: 0
};

let currentHost = '';

const send = (msg) => chrome.runtime.sendMessage(msg);

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
  return Math.floor(d / 86400e3) + 'd ago';
}

function isHostAllowed(host, list) {
  if (!host) return false;
  host = host.toLowerCase();
  return (list || []).some((e) => {
    const s = String(e).toLowerCase();
    return host === s || host.endsWith('.' + s);
  });
}

function itemNode(item) {
  const li = document.createElement('li');

  const header = document.createElement('div');
  header.className = 'item-header';

  const hostTagWrap = document.createElement('div');
  hostTagWrap.className = 'host-tag-wrap';

  const tag = document.createElement('span');
  const tagType = item.tag || 'popup';
  tag.className = 'tag ' + tagType;
  tag.textContent =
    tagType === 'offsite' ? 'Off-site' :
    tagType === 'redirect' ? 'Redirect' :
    tagType === 'blank' ? 'Blank' : 'Popup';

  const host = document.createElement('span');
  host.className = 'hostname';
  host.textContent = item.host || '(blank)';
  host.title = item.url || '';

  hostTagWrap.append(tag, host);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = timeAgo(item.ts);

  header.append(hostTagWrap, time);

  const why = document.createElement('div');
  why.className = 'why';
  why.textContent = (item.reasons || []).slice(0, 2).join(' · ') || 'Closed immediately';
  why.title = (item.reasons || []).join('\n');

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (item.host && item.host !== '(blank)') {
    const allow = document.createElement('button');
    allow.className = 'mini';
    allow.textContent = 'Allow site';
    allow.dataset.act = 'allow';
    allow.dataset.host = item.host;
    actions.append(allow);
  }

  if (item.url && /^https?:/i.test(item.url)) {
    const open = document.createElement('button');
    open.className = 'mini';
    open.textContent = 'Reopen';
    open.dataset.act = 'open';
    open.dataset.url = item.url;
    actions.append(open);
  }

  li.append(header, why, actions);
  return li;
}

function render() {
  const { settings, log, count } = state;

  el('toggle').checked = !!settings.enabled;
  el('state').textContent = settings.enabled ? 'Protection on' : 'Protection off';
  document.body.classList.toggle('off', !settings.enabled);

  if (el('opt-user-tabs')) el('opt-user-tabs').checked = !!settings.exemptUserTabs;
  if (el('opt-same-domain')) el('opt-same-domain').checked = !!settings.allowSameDomain;
  if (el('opt-popups')) el('opt-popups').checked = !!settings.blockPopups;
  if (el('opt-blank')) el('opt-blank').checked = !!settings.blockBlank;
  if (el('opt-redirects')) el('opt-redirects').checked = !!settings.blockRedirects;
  if (el('opt-external')) el('opt-external').checked = !!settings.blockExternal;

  el('count').textContent = String(count || 0);
  el('clear').hidden = log.length === 0;
  el('empty').hidden = log.length > 0;
  el('allowcount').textContent = String((settings.allowlist || []).length);

  el('list').replaceChildren(...log.map(itemNode));

  renderCurrentSite();
  renderAllowlist(settings.allowlist || []);
}

function renderCurrentSite() {
  const hostEl = el('currenthost');
  const btn = el('allowcurrent');
  const allowlist = state.settings.allowlist || [];

  if (!currentHost) {
    hostEl.textContent = 'Not on a website';
    hostEl.classList.add('unavailable');
    btn.disabled = true;
    btn.className = 'btn primary';
    btn.textContent = 'Allow this site';
    btn.onclick = null;
    return;
  }

  hostEl.textContent = currentHost;
  hostEl.classList.remove('unavailable');
  btn.disabled = false;

  const allowed = isHostAllowed(currentHost, allowlist);
  if (allowed) {
    btn.className = 'btn allowed';
    btn.textContent = '✓ Allowed (Click to block)';
    btn.onclick = () => {
      const match = allowlist.find((e) => {
        const s = String(e).toLowerCase();
        return currentHost === s || currentHost.endsWith('.' + s);
      });
      refresh({ type: 'remove-host', host: match || currentHost });
    };
  } else {
    btn.className = 'btn primary';
    btn.textContent = 'Allow this site';
    btn.onclick = () => refresh({ type: 'allow-host', host: currentHost });
  }
}

function renderAllowlist(list) {
  const box = el('allowlist');
  box.replaceChildren();

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      '<div class="empty-icon">✓</div>' +
      'No custom sites added.<br /><small>Auth providers (Google, Stripe, etc.) &amp; search engines are preserved automatically.</small>';
    box.append(empty);
    return;
  }

  for (const host of list) {
    const entry = document.createElement('div');
    entry.className = 'entry';

    const span = document.createElement('span');
    span.textContent = host;

    const rm = document.createElement('button');
    rm.className = 'mini remove';
    rm.textContent = 'Remove';
    rm.dataset.act = 'remove';
    rm.dataset.host = host;

    entry.append(span, rm);
    box.append(entry);
  }
}

async function refresh(msg) {
  try {
    const res = await send(msg || { type: 'get-state' });
    if (res && !res.error) state = res;
  } catch {}
  render();
}

async function init() {
  // Query active tab host
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      try {
        const u = new URL(tab.url);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          currentHost = u.hostname.toLowerCase().replace(/\.$/, '');
        }
      } catch {}
    }
  } catch {}

  // Tab switching
  el('tab-btn-activity').addEventListener('click', () => {
    el('tab-btn-activity').classList.add('active');
    el('tab-btn-allowed').classList.remove('active');
    el('view-activity').classList.add('active');
    el('view-allowed').classList.remove('active');
  });

  el('tab-btn-allowed').addEventListener('click', () => {
    el('tab-btn-allowed').classList.add('active');
    el('tab-btn-activity').classList.remove('active');
    el('view-allowed').classList.add('active');
    el('view-activity').classList.remove('active');
  });

  // Master switch
  el('toggle').addEventListener('change', (e) =>
    refresh({ type: 'set-enabled', enabled: e.target.checked })
  );

  // Feature switches
  el('opt-user-tabs').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'exemptUserTabs', value: e.target.checked })
  );

  el('opt-same-domain').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'allowSameDomain', value: e.target.checked })
  );

  el('opt-popups').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'blockPopups', value: e.target.checked })
  );

  el('opt-blank').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'blockBlank', value: e.target.checked })
  );

  el('opt-redirects').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'blockRedirects', value: e.target.checked })
  );

  el('opt-external').addEventListener('change', (e) =>
    refresh({ type: 'set-option', key: 'blockExternal', value: e.target.checked })
  );

  // Clear log
  el('clear').addEventListener('click', () => refresh({ type: 'clear-log' }));

  // Reset allowlist
  el('reset').addEventListener('click', () => {
    if (confirm('Remove all custom allowed sites? Auth providers and search engines remain protected.')) {
      refresh({ type: 'reset-allowlist' });
    }
  });

  // Action clicks inside activity list
  el('list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'allow') {
      refresh({ type: 'allow-host', host: btn.dataset.host });
    } else if (btn.dataset.act === 'open') {
      refresh({ type: 'reopen', url: btn.dataset.url });
    }
  });

  // Action clicks inside allowlist
  el('allowlist').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="remove"]');
    if (!btn) return;
    refresh({ type: 'remove-host', host: btn.dataset.host });
  });

  await refresh();
}

init();
