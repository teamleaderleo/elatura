# YouTube Music memory notes

This note captures a real-world resource-pressure case that may inform Elatura's broader workload model and measurement approach.

## User environment

Observed development workload on a 24 GB MacBook Air commonly includes:

- Claude Code
- Codex
- dozens of ChatGPT tabs
- YouTube Music running as a Safari Add to Dock web app

Under this workload, memory pressure and swap become recurring constraints. The immediate motivation is therefore to reduce the cost of long-lived authenticated web applications without giving up their native service experience.

## YouTube Music requirements

The desired YouTube Music experience is deliberately narrow in one sense and demanding in another:

- preserve the actual `music.youtube.com` experience when possible
- preserve Google account state, recommendations, history, likes, playlists, radios, and recommendation feeds
- preserve point-and-click use
- avoid replacing the experience with CLI playback
- prioritize lower Mac-side RAM use

The recommendation system is part of the product requirement. A low-memory player that discards Google's personalized discovery loop is a different product.

## Approaches considered

### Safari Add to Dock

Current baseline. This keeps the literal YouTube Music website and Google session, but still executes the full desktop web application in WebKit.

A different thin `WKWebView` wrapper around the same desktop site is unlikely to change the dominant cost if the page itself owns most of the resident state.

### CLI playback (`mpv`, `yt-dlp`, terminal clients)

Potentially very cheap in memory, but rejected for this use case because browsing, recommendations, and direct interaction with the service are central requirements.

### Native third-party YouTube Music clients

Potentially useful if they replace large portions of the web UI with native controls while retaining Google-backed recommendations and account data. They change the user experience and therefore serve as an alternate client experiment rather than a drop-in replacement for the website.

### Mobile execution with Mac audio output

The most promising immediate workaround is to run YouTube Music entirely on an iPhone and use the Mac as the audio endpoint via AirPlay Receiver.

This moves the heavy YouTube Music application workload off the Mac while retaining:

- the official YouTube Music client
- the user's Google account
- recommendation feeds and radios
- ordinary touch interaction
- MacBook speakers as output

A related experiment is iPhone Mirroring, where the YouTube Music app executes on the phone while interaction occurs from the Mac and audio plays through the Mac.

The MacBook microphone remains independently available for Mac applications, though speaker-to-microphone acoustic pickup is still a physical consideration.

## Broader observation

This case suggests a useful distinction for Elatura research: resource reduction can happen at several layers.

1. Reduce how much remote application state the browser eagerly receives or materializes.
2. Reduce how much of an already-received application is kept live in the page.
3. Replace expensive presentation with a cheaper local representation while keeping an authoritative origin.
4. Move execution to another device while preserving a lightweight interaction or output endpoint on the constrained machine.

Elatura currently concentrates primarily on the first three categories. Device offload is a different mechanism, but it attacks the same user-visible failure mode: a useful authenticated application consumes resources that the user would rather reserve for primary work.

The YouTube Music case may therefore be useful as a comparison workload even if it never becomes an Elatura adapter.

## Root-level question

The recurring workload is broader than music. A development session can include several heavyweight agent tools plus many simultaneous ChatGPT conversations. Browser sleeping helps inactive tabs, but the more interesting question is how much of a long-lived interactive web application's retained state is truly needed at any moment.

For ChatGPT specifically, simply disabling JavaScript is incompatible with the application. The root-level opportunity is instead to identify which state, branches, message bodies, code blocks, attachments, metadata, and rendered nodes must remain live for the current interaction, and which can be represented, deferred, cached, or reloaded on demand while preserving the authoritative conversation.

This is closely aligned with Elatura's existing direction: keep the authenticated application as the source of truth while preventing oversized applications from eagerly consuming far more state than the user currently needs.

## Suggested measurements

For the YouTube Music case, compare steady-state Mac memory and swap under the same playback period for:

1. Safari Add to Dock YouTube Music, freshly launched
2. Safari Add to Dock after extended browsing through Home, albums, radios, and queue changes
3. iPhone YouTube Music -> Mac via AirPlay Receiver
4. iPhone Mirroring with YouTube Music active
5. a native third-party client, if tested

Record at minimum:

- resident memory attributable to the client and helper processes
- system memory pressure
- swap used
- CPU use during steady playback
- time since launch
- amount of browsing performed before measurement

The useful result is the delta between approaches under a repeatable workload, rather than a single absolute RAM number.
