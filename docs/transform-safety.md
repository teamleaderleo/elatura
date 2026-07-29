# Local transform safety controls

The Firefox extension remains observe-only. Transform safety controls exist before transform code so future integration cannot treat emergency disablement as an afterthought.

## Locked default

Every background start creates a fresh transform-safety controller with the emergency lock engaged. The state is content-free and bounded:

- schema version
- fixed reason code
- local generation counter
- volatile-clear attempt and failure counters
- bundled denylist entry count

The controller is not persisted. A browser or extension-background restart therefore returns to the locked build default rather than restoring a possibly enabled transform state.

## Emergency disable

The popup exposes **Emergency disable transforms**. Activating it:

1. keeps the emergency lock engaged;
2. invokes every registered volatile transform-state clearer;
3. records only fixed numeric counters if a clearer fails;
4. leaves observation and ordinary browsing available.

Repeated activation runs the clearers again. A throwing clearer cannot unlock transformation or prevent the remaining clearers from being attempted.

There is no popup unlock, enable, or arm action. A future explicit local opt-in flow requires a separate reviewed milestone and must still consult the emergency lock and denylist before every transform decision.

## Volatile state registry

Future transform modules must register cleanup callbacks through `registerVolatileTransformStateClearer`. The registry is local to the extension process. The emergency control invokes all registered callbacks and reports failure through a fixed content-free code.

The current observe-only build registers no transform state because no transform module is linked.

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
- an explicit reviewed local opt-in exists;
- the exact adapter id/version is not denylisted;
- the adapter, input, plan, materialized output, and release gates all pass their independent checks.

The current controller starts locked and exposes no unlock path, so the observe-only build cannot reach an allowed transform decision.

## Static enforcement

`npm run security:gate` verifies:

- transform capability remains disabled;
- transform permissions and hosts remain empty;
- no transform network/native/persistence capability appears;
- the emergency control remains local and disabled by default;
- the bundled denylist remains local source data;
- the popup contains the emergency action;
- no popup/background transform unlock message exists.
