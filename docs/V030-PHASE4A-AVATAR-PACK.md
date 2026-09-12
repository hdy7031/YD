# YD v0.3 Phase 4A · Avatar Pack Contract（2026-09-12）

Phase 4A only turns the existing single desk-pet asset set into a registered
Avatar Pack. It does not add selection UI, Profile persistence or PetInstance.

## Runtime flow

```text
StateEngine CurrentState
  → companion-display.ts CompanionDisplay
  → avatar.ts builtin registry + resolveAvatarFrame()
  → companion-assets.ts logical asset loader
  → companion-frame.ts resolveCompanionFrame()
  → ui/companion-custom.ts renderer
```

`currentStateToPetDisplay()` remains the only Person State → companion visual
mapping. Avatar code consumes that visual state and never reads schedule,
routine, manual status, reminder timing or the current clock.

## Builtin pack

The current ten-pose character is `yd-default`, manifest version `1.0.0`.
Its existing 412×411 canvas, state-to-asset mapping and per-frame geometry were
moved into the pack manifest without changing files, triggers, scale or offsets.
There is no fake second builtin pack; multi-pack behavior uses test-only data.

## Fallback order

1. requested pack / requested state;
2. requested pack / its fallback state (`idle`);
3. `yd-default` / requested state;
4. `yd-default` / its fallback state;
5. embedded `companion-fallback-idle`.

The resolver returns requested/resolved pack ids, requested/resolved states and
the fallback reason, so fallback logic is not duplicated in renderer branches.

## Storage boundary

`DOMAIN_VERSION` remains 5. No schema field, Profile avatar field id or migration
step was added. The existing migration backup and byte-level rollback gate are
unchanged.
