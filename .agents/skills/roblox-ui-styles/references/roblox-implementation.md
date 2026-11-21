# Carry a kit into Roblox

Use the selected version in `assets/presets.json`; its `native` object maps the visual tokens to Roblox fonts and component properties. Keep the world and gameplay implementation original to the approved specification.

- Build editable `ScreenGui`, frames, layouts and buttons. Use a component factory for each kit's navigation tile, resource strip, item card, detail panel and action button so its geometry, states and spacing remain consistent across screens.
- The supplied SVG paths are authoring assets. Roblox ImageLabels need an imported raster asset with permission for the target experience. Rasterize/upload through the project's approved asset pipeline when available, preserving stable asset mapping. Do not insert a fabricated `rbxassetid`. If that pipeline is unavailable, represent the same distinctive symbols with native UI geometry and record the limitation. Do not silently replace all symbols with empty boxes or text.
- Rasterize glyphs without their sheet labels. Keep English button/item text in separate localizable TextLabels rather than baking it into uploaded pictures.
- Use the pack's native font, contrast, corner radius, stroke and palette. A dark outline around an illustrated icon is separate from a selection border around its card; apply UIStroke to the appropriate container.
- On a phone, give primary actions at least 44 logical pixels and keep currency, navigation and the progress bar away from system and Roblox controls. Simulator navigation becomes a bottom strip; Tactical uses compact grouped equipment; Clicker collapses secondary promotions and navigation. Do not fit by applying a single global UIScale.
- Author labels and placeholders in English. In this workshop, static GUI uses AutoLocalize and the injected `AutomationI18n` source catalogue. Format changing counters and states with keyed complete messages. Leave space for longer translations.
- During game acceptance, measure actual client bounds, text bounds and safe areas on the affected screens. Confirm all item illustrations load and buttons have visible hover/pressed/disabled/selected states. Native tests, source-language checks and published cloud translation retain separate evidence.

The three style previews and icon sheets are reusable visual specifications. Selecting one does not require a Studio scene, a game prototype, a paid image generator or an automatic public upload.
