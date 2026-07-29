# Local transform safety controls

The Firefox extension remains observe-only. Transform safety and explicit consent-intent controls exist before transform code so future integration cannot treat either boundary as an afterthought.

## Locked default

Every background start creates a fresh transform-safety controller with the emergency lock engaged. The state is content-free and bounded:

- schema version
- fixed reason code
- local generation counter
- volatile-clear attempt and failure counters
- bundled denylist entry count

The safety controller is not persisted. A browser or extension-background restart therefore returns to the locked build default rather than restoring a possibly active transform state.

## Session-local opt-in intent

The popup exposes a separate opt-in intent flow. The user must acknowledge exactly three fixed statements:

- the intent lasts only for the current background session;
- a future reviewed transform may alter page behaviour;
- emergency disable and ordinary site access remain available.

No free text, conversation identifier, adapter identifier, URL, or page content enters the opt-in state. The state contains only:

- schema version
- recorded boolean
- fixed reason code
- local generation counter
- acknowledgement count
- `authorizesTransform: false`

Recording intent does not disengage the emergency lock, change the capability policy, mutate a response, or authorize a transform. The current build cannot reach an allowed transform decision.

Opt-in intent is not written to browser storage. A background restart resets it to the unrecorded build default. The popup also exposes explicit revocation.

## Emergency disable

The popup exposes **Emergency disable transforms**. Activating it:

1. keeps the emergency lock engaged;
2. invokes every registered volatile transform-state clearer;
3. revokes session-local opt-in intent;
4. records only fixed numeric counters if a clearer fails;
5. leaves observation and ordinary browsing available.

Repeated activation runs the clearers again. A throwing clearer cannot unlock transformation or prevent the remaining clearers from being attempted.

There is no popup unlock, enable, or arm action. A future transform authorization path requires a separate reviewed milestone and must still consult the emergency lock, explicit intent, build/live gate, and denylist before every transform decision.

## Volatile state registry

Future transform modules must register cleanup callbacks through `registerVolatileTransformStateClearer`. The registry is local to the extension process. The emergency control invokes all registered callbacks and reports failure through a fixed content-free code.

The current observe-only build registers only the session-local opt-in controller. No transform payload, plan, output, cache, or application content is linked to the registry.

## Adapter denylist

Adapter denylist entries match the exact pair:

```text
adapter id + adapter version
```

The list is bundled local data. It cannot be downloaded or updated by page content, a remote policy service, or an application response. Matching is exact; prefixes and version ranges are not inferred.

The bundled list is currently empty because no production transform adapter is enabled. The mechanism is covered with non-empty synthetic lists.

## Permission decision

A future transform is allowed only when all of these are true:

- emergency lock is not engaged;
- explicit reviewed local opt-in intent exists;
- a separately reviewed build/live authorization gate is enabled;
- the exact adapter id/version is not denylisted;
- the adapter, input, plan, materialized output, and release gates all pass their independent checks.

The current controller starts locked, opt-in intent explicitly reports `authorizesTransform: false`, the capability policy keeps transforms disabled, and no unlock path exists.

## Static enforcement

`npm run security:gate` verifies:

- transform capability remains disabled;
- transform permissions and hosts remain empty;
- no transform network/native/persistence capability appears;
- the emergency control remains local and disabled by default;
- opt-in intent is session-local, fixed-field, and non-authorizing;
- the bundled denylist remains local source data;
- the popup contains record, revoke, and emergency actions;
- no popup/background transform unlock message exists.
