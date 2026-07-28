# Transport capability matrix

Status: decision record for M0/M1  
Last reviewed: 2026-07-29  
Tracking issue: #17

## Decision

Elatura should continue with a **Firefox WebExtension as the first authenticated transport**.

That decision is narrow:

- Firefox is the first place to prove safe pre-application response transformation.
- The runtime, adapter, cache, provenance, and alternate-representation contracts must remain engine-neutral.
- A local native companion is the likely first route to alternate surfaces.
- Chromium and Safari extensions remain useful secondary transports for observation, page-level integration, and later compatibility, but their documented extension APIs do not currently provide Firefox's general response-body stream filter.
- A focused `WKWebView` shell remains a later product experiment, not the first transformation laboratory.

This is not a permanent browser preference. It is the lowest-risk path to the first hard technical proof.

## Terminology

### Browser-level response interception

The browser gives the extension or embedder the response byte stream before the page consumes it. The interceptor can monitor, replace, or pass through those bytes.

This is the strongest fit for Elatura because it can reduce application state before the site's JavaScript parses and hydrates it.

### Page-world request patching

A script injected into the page's JavaScript environment replaces or wraps APIs such as `fetch` or `XMLHttpRequest`.

This may run early and can be useful, but it is not equivalent to a browser-owned response filter:

- the host page shares the execution environment and can interfere with it
- service workers, native browser fetch paths, cached paths, or alternate APIs may bypass assumptions
- the patch must preserve subtle web-platform behaviour
- failure occurs inside the application execution environment rather than beneath it

Elatura may experiment with page-world patching as a compatibility fallback, but must label it separately and apply a stricter support standard.

## Capability matrix

| Capability | Firefox WebExtension | Chromium MV3 extension | Safari Web Extension | Native `WKWebView` shell | Extension + local companion |
|---|---|---|---|---|---|
| Reuse an existing signed-in browser profile | Yes, within the Firefox profile where installed | Yes, within the Chromium profile where installed | Yes, within the Safari profile where enabled | No direct reuse of Firefox/Safari profile; maintains its own WebKit data store | Yes through the extension side; companion receives only explicitly bridged data |
| General browser-level response-body stream access | **Yes:** `webRequest.filterResponseData()` | **No documented equivalent for ordinary MV3 extensions** | **No documented equivalent; network modification is declarative** | **No for ordinary HTTPS through `WKURLSchemeHandler`** | Depends on the browser extension transport |
| Observe requests without body access | Yes | Yes through `webRequest` | Yes within supported extension APIs | Navigation delegates and page instrumentation; not equivalent to full browser devtools/network interception | Depends on browser transport |
| Block, redirect, or modify headers declaratively | Supported browser APIs | `declarativeNetRequest` | `declarativeNetRequest` | App-controlled navigation/request construction in limited contexts | Depends on browser transport |
| Document-start script injection | Yes | Yes | Yes through Safari WebExtension content-script support | Yes through `WKUserScriptInjectionTime.atDocumentStart` | Depends on browser transport |
| Main page JavaScript world | Supported through WebExtension execution-world controls | Supported through `world: "MAIN"` | Compatibility depends on Safari WebExtension API/version | App-controlled user scripts and content worlds | Depends on browser transport |
| Native companion messaging | Yes; background script mediates native messaging | Yes | Yes through the containing app/native extension | Native code already owns the web view | This is the defining capability |
| Persistent authenticated session | Browser profile owns it | Browser profile owns it | Safari profile owns it | Yes through persistent `WKWebsiteDataStore`; it is a separate Elatura profile | Browser profile remains authoritative |
| Cross-platform reach | Desktop Firefox across macOS, Windows, Linux | Broad desktop reach | Apple platforms | Apple platforms | Native host packaging is OS-specific even if protocol is shared |
| Product-shell control | Low; works inside Firefox | Low; works inside Chromium | Medium because Safari Web Extensions ship in an app container | **High:** navigation, windows, lifecycle, profile, and UI are app-owned | Medium to high for alternate surfaces, while the original browser stays authoritative |
| First-transform suitability | **Best current choice** | Weak without page-world patching | Weak without page-world patching | Medium, but interception gap and separate-session burden remain | Not a transport by itself |
| Best Elatura role | First transport and performance laboratory | Later compatibility/observer transport | Later Apple-browser compatibility transport | Focused supplementary browser experiment | Alternate surfaces, indexing, and heavier local processing |

## Evidence by transport

### Firefox WebExtension

Firefox documents `webRequest.filterResponseData()` as giving an extension full control over a response stream, including monitoring and modification. The extension is responsible for writing and closing or disconnecting the stream. This is the exact primitive the first Elatura experiment needs.

Firefox also supports native messaging between an extension background context and an installed native application. Content scripts cannot invoke native messaging directly; the background script must mediate it. That separation fits Elatura's desired trust boundary.

Primary references:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendNativeMessage
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts

### Chromium Manifest V3 extension

Chrome documents `webRequest` as an observation/interception API, but states that `webRequestBlocking` is unavailable to most Manifest V3 extensions; policy-installed extensions are the exception. Chrome directs ordinary extensions toward `declarativeNetRequest`.

`declarativeNetRequest` evaluates browser-managed block, allow, redirect, upgrade, and header-modification rules without exposing response content to extension JavaScript. It therefore cannot implement Elatura's arbitrary JSON response-body reduction.

Chromium does support content scripts at `document_start` and in the page's `MAIN` world. This makes page-world `fetch` patching technically plausible, but Chrome warns that the host page can access and interfere with main-world scripts. Elatura must not describe that approach as equivalent to a response-stream filter.

Primary references:

- https://developer.chrome.com/docs/extensions/reference/api/webRequest
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

### Safari Web Extension

Safari Web Extensions use the cross-browser WebExtension model, request explicit website permissions, support content scripts, and can communicate with a containing native app.

Apple documents declarative network modification through `declarativeNetRequest`. The documented model is designed to block, redirect, or modify headers without granting extension JavaScript access to the full request content. The reviewed Safari extension documentation does not expose an equivalent to Firefox's arbitrary response-body stream filter.

This makes Safari a plausible later observer and page-integration transport, but not the strongest place to prove pre-hydration graph reduction.

Primary references:

- https://developer.apple.com/documentation/safariservices/safari-web-extensions
- https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions
- https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension
- https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension

### Native `WKWebView` shell

A native shell offers strong product control:

- app-owned navigation and window lifecycle
- document-start user scripts
- persistent or isolated website data stores
- direct native UI and processing
- purpose-built alternate surfaces

However, `WKURLSchemeHandler` handles URL schemes WebKit does not already support. Apple explicitly documents that registering a handler for a built-in scheme such as `https` is a programmer error. It is therefore not a supported general interceptor for ordinary ChatGPT HTTPS responses.

A shell could still patch page-world request APIs at document start, use a controlled proxy architecture, or rely on an application-specific server API if one becomes supported. Each option carries a substantially different security and compatibility model and must be evaluated separately.

A `WKWebView` session can persist cookies, caches, and other website data using `WKWebsiteDataStore`, but that is an Elatura-owned WebKit profile rather than reuse of the user's existing Firefox or Safari profile.

Primary references:

- https://developer.apple.com/documentation/webkit/wkuserscriptinjectiontime/atdocumentstart
- https://developer.apple.com/documentation/webkit/wkurlschemehandler
- https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/seturlschemehandler(_:forurlscheme:)
- https://developer.apple.com/documentation/webkit/wkwebsitedatastore

### Browser extension plus local companion

Native messaging is available in Firefox, Chromium, and Safari, with browser-specific manifest, packaging, sandbox, and message-flow details.

The companion does not replace the browser transport. It provides capabilities that should not live in an extension process:

- larger local indexes
- alternate web/native/terminal surfaces
- durable search and provenance stores
- heavier transformation or export jobs
- OS-integrated file and window operations

The browser remains the authenticated acquisition layer. The companion must never receive cookies, authorization headers, or a reusable browser session credential.

Primary references:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension

## Engine-neutral contracts required now

The following interfaces must not depend on Firefox APIs:

- adapter detection and capability declarations
- input and output validation
- structural fingerprints
- selection plans and materialization results
- fail-open decisions and content-free reason codes
- cache envelopes, isolation keys, and freshness metadata
- provenance and alternate-representation records
- benchmark report schemas
- browser-to-companion message envelopes

The Firefox transport may translate browser events into those contracts, but browser-specific request IDs, stream filters, tabs, frames, and extension storage objects must stop at the transport boundary.

## Firefox exit criteria

Elatura should reconsider Firefox as the first or primary transport only when evidence satisfies at least one of these conditions.

### Exit condition 1: the required response is not filterable

A current live benchmark shows that the dominant authenticated application state does not pass through `filterResponseData()`, or reaches the page through a path that cannot be safely filtered.

Required evidence:

- content-free request classification
- reproducible observer traces
- confirmation across cold load, hard reload, and client-side navigation
- no viable Firefox interception point beneath page execution

### Exit condition 2: filter overhead destroys the performance case

Observe-only Firefox filtering imposes unacceptable overhead compared with stock Firefox.

Initial investigation threshold:

- median time-to-composer regression above 15%, or
- peak content-process memory regression above 10%, or
- repeated instability attributable to the stream filter

These numbers trigger investigation, not automatic abandonment. The decision must distinguish observer implementation defects from browser API cost.

### Exit condition 3: a different transport proves materially better end to end

A controlled prototype using the same workload and correctness checks demonstrates:

- equal or stronger authenticated-session safety
- equal fail-open reliability
- at least 25% better cold time-to-usable or peak memory than Firefox safe mode
- no materially worse login, navigation, permission, update, or distribution burden

A prettier shell alone is not enough to replace the first transport.

### Exit condition 4: Firefox distribution becomes impractical

Required permissions, signing rules, platform policy, or browser changes make the reviewed capability unavailable to ordinary users.

This must be based on current official policy or a failed distribution prototype, not speculation.

### Exit condition 5: product value moves primarily to alternate exploration

If user value proves to come mainly from local search, comparison, timelines, and alternate rendering rather than modifying the original page, the product centre may shift toward a companion or focused shell.

Firefox may still remain the acquisition bridge in that architecture.

## Experiments permitted before M1

- maintain this capability matrix against official documentation
- define engine-neutral transport and companion message contracts
- build synthetic stream fixtures
- test Firefox pass-through, cancellation, and failure semantics
- prototype a local companion using only synthetic content
- build a trivial `WKWebView` shell that loads local synthetic pages, solely to estimate lifecycle and packaging burden
- test page-world injection against a local synthetic application, clearly labelled as page-world patching

## Experiments deferred until evidence exists

- production Safari or Chromium ports
- a full `WKWebView` browser shell
- direct login-compatibility work against private applications
- custom TLS proxying or certificate installation
- browser-engine forks
- user-agent spoofing or anti-detection behaviour
- real private-content transfer to a native companion

## Review cadence

Revisit this document:

- after issue #3 produces the first live baseline
- after the first synthetic and then real safe-mode transform
- when an official browser API or extension policy materially changes
- before beginning a production transport beyond Firefox

Do not update the decision from secondary articles or community reverse engineering alone. Material capability changes require current official documentation or a reproducible local prototype.
