# Popup & Redirect Closer

A high-performance Chrome extension (Manifest V3) that **instantly closes popups, unwanted redirects, blank tabs, and off-site links as soon as they open**.

> **Note**: This is **not** an ad blocker that filters in-page ad banners or alters webpage DOM content. Instead, it is an aggressive tab lifecycle supervisor that intercepts and terminates unsolicited popup tabs, popunders, click-jack redirects, blank tabs (`about:blank`), and links that attempt to navigate off the current website before they can paint or run scripts.

---

## 🚀 Key Features

### 1. 🚫 Instant Popup & Popunder Closer (`blockPopups`)
- Immediately terminates standalone popup windows (`type: 'popup'`) spawned via `window.open()`.
- Terminates unsolicited popup tabs spawned from embedded iframes (`sourceFrameId > 0`).
- Terminates popunders opened in the background while the parent tab or window remains unfocused.
- Terminates tabs matching known ad, tracker, and popunder networks before network requests finish.

### 2. 📄 Blank Tab & Link Killer (`blockBlank`)
- Intercepts `about:blank`, `about:blank#...`, and empty popup tabs opened by scripts.
- Closes standalone blank popup windows, iframe-spawned blank tabs, and background blank tabs immediately.
- Employs a 250ms grace timer for tabs spawned by websites to verify whether they remain blank or immediately navigate to external targets, preventing lingering blank tabs from cluttering your browser.

### 3. 🔀 Deep Redirect Closing (`blockRedirects`)
- Listens to `chrome.webNavigation.onCommitted` with transition qualifiers (`server_redirect`, `client_redirect`) to terminate tabs undergoing HTTP 301/302/303/307/308 or client-side redirects.
- Detects tracking hops and redirect parameters in URLs (`?url=http...`, `?redirect=...`, `goto.php?`, `out.php?`, `link=`, `clickid=`, `affid=`) and closes the tab instantly.

### 4. 🌐 Off-Site Link Interception (`blockExternal`)
- Compares the opener tab's root domain with the destination tab's root domain using robust multi-part TLD parsing (e.g., `.co.uk`, `.com.au`, `.co.jp`, etc.).
- When a page on `website-a.com` triggers a link or popup attempting to navigate to `website-b.com`, the extension detects that the destination is external and terminates the tab.

### 5. 🔗 Allow Same-Domain Popups (`allowSameDomain`)
- Provides a dedicated toggle allowing popups whose target URL or domain starts with or matches the current website's URL or origin (e.g., `https://example.com/item` opening `https://example.com/checkout` or a same-domain image preview).
- Can be toggled on or off at any time from the extension popup.

### 6. 👤 User-Created Tab Exemption (`exemptUserTabs`)
- Tabs opened directly by you (via `Ctrl+T`, the browser **`+`** New Tab button, address bar typing, bookmarks, or external desktop applications) are automatically recognized and **100% exempt**.
- Browser internal pages (`chrome://`, `chrome-extension://`, `chrome-search://`, `about:newtab`) are safeguarded and never touched.

### 7. 🛡️ OAuth & Search Engine Safeguards
- **Auth Providers**: Single Sign-On (SSO) and payment gateways (Google, Apple, Microsoft, GitHub, PayPal, Stripe, Auth0, Okta, etc.) are safeguarded so logins and checkouts remain uninterrupted.
- **Search Engines**: Search result clicks from Google, Bing, DuckDuckGo, Yahoo, Ecosia, and Brave are preserved so search navigation works normally.

### 8. ⚡ Interactive Extension Popup & Activity Log
- **Master Switch**: Enable or disable protection globally with one click.
- **1-Click Site Allow/Block**: View the current site in the header and allow or block it with one click.
- **Activity Log**: Displays recently closed tabs with categorical tags (`[Off-site]`, `[Redirect]`, `[Blank]`, `[Popup]`) and exact reasons.
- **1-Click Reopen**: Reopen any accidentally closed tab with temporary bypass protection.
- **Allowed Sites Manager**: View and manage your custom allowlist.

---

## 📁 Project Architecture

```
popup-close/
├── manifest.json       # Manifest V3 configuration & permissions
├── background.js       # Background Service Worker (detection & closing engine)
├── popup.html          # Extension popup UI (modern responsive layout)
├── popup.js            # Controller for options, tabs, and allowlist sync
├── icon16.png          # 16x16 toolbar icon
├── icon32.png          # 32x32 high-DPI icon
├── icon48.png          # 48x48 extensions management icon
├── icon128.png         # 128x128 Chrome Web Store icon
├── CHANGELOG.md        # Detailed release notes and version history
└── README.md           # Project documentation
```

---

## ⚙️ Configuration & Options

| Option | Setting Key | Default | Description |
|---|---|---|---|
| **Master Protection** | `enabled` | `true` | Turns protection on or off globally. |
| **Allow Same-Domain Popups** | `allowSameDomain` | `true` | Permits popups whose domain or URL matches the current site. |
| **Allow User New Tabs** | `exemptUserTabs` | `true` | Never closes tabs opened by you (`Ctrl+T`, `+` button, bookmarks). |
| **Close Popups** | `blockPopups` | `true` | Closes script, iframe, and popunder windows. |
| **Close Blank Links** | `blockBlank` | `true` | Closes `about:blank` and empty tabs created by websites. |
| **Close Redirects** | `blockRedirects` | `true` | Closes tabs redirecting through hops or tracking parameters. |
| **Close Off-Site Links** | `blockExternal` | `true` | Closes tabs leading away from the current website. |

---

## 📦 Installation Instructions

1. Clone or download this repository to your local computer:
   ```bash
   git clone https://github.com/whitesyntax32gaming-tech/popup-redirect-closer.git
   ```
2. Open Google Chrome (or any Chromium browser such as Edge, Brave, or Opera).
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the folder containing `manifest.json`.
7. The extension icon will appear in your Chrome toolbar. Pin it for quick access!

---

## 🔒 Permissions Justification

| Permission | Purpose |
|---|---|
| `tabs` | Required to inspect opener tab IDs, detect popup window types, and close tabs via `chrome.tabs.remove()`. |
| `webNavigation` | Required to intercept navigation targets (`onCreatedNavigationTarget`), committed redirects (`onCommitted`), and navigation URLs (`onBeforeNavigate`) before pages paint. |
| `storage` | Stores user configuration, options toggles, and the custom allowed domains list locally. |
| `<all_urls>` | Allows the extension to protect the user across all websites. |

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
