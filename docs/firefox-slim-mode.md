# Firefox slim-mode prototype

Issue #95 tracks a local Firefox experiment for making oversized ChatGPT conversations usable without replacing the genuine `chatgpt.com` client.

This packet implements the planner, DOM controller, popup controls, content-free counters, and fail-open recovery path. **Live slimming remains locked in this build.** The existing transform safety state starts emergency-disabled, and recorded session opt-in intent explicitly does not authorize a transformation.

## Modes

### Stock

The extension leaves the page untouched.

### Render suppression

Older discovered turns receive CSS containment and `content-visibility: auto`. The latest configured user/assistant groups and any active streaming group remain unsuppressed.

This mode may reduce layout and paint work. It does not reduce the response payload or prove that the ChatGPT application released any JavaScript state.

### Latest-message window

The pure planner retains the latest configured turn groups plus any active streaming group. Older mounted turn elements are replaced with bounded inert placeholders. The extension does not retain detached nodes, cloned nodes, message text, Markdown output, or serialized transcript content.

Because the removed elements cannot be reconstructed safely by the extension, **Reveal previous** and **Stock** clear the session-local mode configuration and reload the genuine page. A future reviewed authorization packet may allow private-profile testing of this path.

## Selector and fail-open policy

The live DOM adapter currently accepts only a coherent ordered list where:

- message-role markers exist;
- each role marker resolves to a conversation-turn test container or an article container;
- resolved turn containers share one parent;
- containers are ordered and non-nested;
- at least one user or assistant role is present.

The selector-independent planner receives only opaque ordinal turn ids, opaque group ids, a streaming boolean, and a bounded height estimate. It never receives message text.

Before any destructive mode can run, the content script must successfully write the mode and retained-group count to tab-local `sessionStorage`. Selector drift is retried briefly. Repeated drift clears that configuration and either restores in place or reloads Stock when turn removal has occurred.

## Privacy and authority

The prototype:

- reads role markers and element geometry, not message text;
- performs no outbound request;
- writes no page data to extension storage;
- logs no page data;
- does not decode or modify response bodies;
- does not submit messages;
- does not retain detached DOM;
- adds no extension permission or host beyond the existing observer boundary;
- exposes `slim-window.js` only to `https://chatgpt.com/*` for local dynamic import.

The existing byte observer remains a byte-for-byte response pass-through.

## Content-free measurements

The content script reports bounded values for:

- element and text-node counts before and after application;
- whether node counting reached its traversal limit;
- discovered and mounted turn counts;
- suppressed turn count;
- placeholder count;
- apply and fail-open counts.

The existing observer separately records request counts, total bytes, oversized-response counts, and composer-ready time. The experiment must keep rendering measurements separate from network and application-state claims.

The complete trial contract is in `benchmarks/slim-mode-manifest.json`.

## Required validation before live authorization

1. Full repository CI and Firefox extension lint pass.
2. The pure planner passes synthetic grouping, streaming, placeholder, and budget tests.
3. The locked build is reviewed for selector drift, recovery order, and content sinks.
4. A separate reviewed authorization packet connects a private-profile-only grant without enabling response transformation.
5. Manual testing runs ordinary, large, and pathological conversations.
6. One hundred chat-switch cycles and one hundred enable/disable cycles show no monotonic extension-state or placeholder growth.
7. Stock restoration consistently returns the official page and usable composer.

Response-body windowing remains outside this packet.
