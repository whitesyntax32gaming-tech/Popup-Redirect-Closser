# Changelog

All notable changes to the **Popup & Redirect Closer** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-11-03

### Added
- **User-Created Tab Exemption (`exemptUserTabs`)**:
  - Implemented explicit tracking for tabs opened directly by the user via `Ctrl+T`, the Chrome **`+`** (New Tab) button, address bar entries, bookmarks, and external desktop applications.
  - Added internal URL validation (`isInternalUrl`) to protect `chrome://`, `chrome-extension://`, `chrome-search://`, `about:newtab`, and devtools pages.
  - Added user toggle in the popup UI: *"👤 Allow User New Tabs"*.
- **Same-Domain & URL Popup Allowance (`allowSameDomain`)**:
  - Added detection engine (`isSameSiteOrUrl`) to permit popups whose target URL or domain starts with or matches the current website's URL or origin.
  - Added user toggle in the popup UI: *"🔗 Allow Same Domain / URL"*.
- **Deep HTTP & Client Redirect Interception (`blockRedirects`)**:
  - Listens to `chrome.webNavigation.onCommitted` with transition qualifiers (`server_redirect`, `client_redirect`) to terminate tabs undergoing HTTP 301/302/303/307/308 redirects.
  - Inspects query parameters for tracking hops (`?url=http...`, `?redirect=...`, `goto.php?`, `out.php?`, `link=`, `clickid=`, `affid=`).
- **Off-Site Link Interception (`blockExternal`)**:
  - Compares source tab root domain against destination root domain using multi-part TLD parsing (`.co.uk`, `.com.au`, `.co.jp`, etc.).
  - Preserves legitimate search engine outbound clicks (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave).
- **Blank Tab Killer (`blockBlank`)**:
  - Terminates empty tabs and `about:blank` popups opened by web pages.
  - Employs a 250ms grace timer to prevent lingering blank tabs from script popunders.
- **Visual Assets**:
  - Added red shield action icons in 16x16, 32x32, 48x48, and 128x128 PNG formats.
- **Activity Log & Reopen Support**:
  - Categorical tagging for blocked entries: `[Off-site]`, `[Redirect]`, `[Blank]`, `[Popup]`.
  - Reopen button that temporarily bypasses the closer if a user intentionally wanted a blocked URL.
  - 1-click current site allow/block button in header.

### Fixed
- **Service Worker Registration Error**:
  - Fixed `Uncaught TypeError: Cannot read properties of undefined (reading 'addListener')` (Status Code 15) caused by calling non-existent `chrome.webNavigation.onBeforeRedirect`. Replaced with standard `chrome.webNavigation.onCommitted`.
- **Popup UI Initialization Crash**:
  - Resolved `TypeError: Cannot read properties of null` caused by missing DOM elements in `popup.html` (`opt-redirects`, `opt-blank`, `opt-external`, `currenthost`, `allowcurrent`, `allowlist`).
- **Persistence Across Service Worker Suspension**:
  - Migrated state and counter storage to `chrome.storage.local` to prevent loss of configuration or counters when the background service worker is idled by Chromium.

---

## [1.0.0] - 2026-11-02

### Added
- Initial extension release with heuristic scoring for known ad networks and basic popup window listener.
