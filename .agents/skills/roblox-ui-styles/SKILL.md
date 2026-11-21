---
name: roblox-ui-styles
description: "Choose and apply reusable Roblox UI style kits with illustrated icons and coordinated HUD, menu, shop and inventory layouts. Use for Roblox visual direction, preset previews and implementation of a selected kit."
---

# Roblox UI Styles

Use ready-made style kits to make visual choices before building a game. The kits describe presentation and reusable UI components; they do not provide gameplay or a genre template.

## Choose a kit

- Offer the bundled **Bright Simulator**, **Tactical Tycoon** and **Neon Clicker** kits as selectable alternatives. Use [assets/presets.json](assets/presets.json) as the source of versioned tokens and layouts.
- Show the actual kit previews, illustrated icon set and each affected screen. Keep the same sample resources, items and actions when comparing kits. Label these as preset examples, never as screenshots or tests of the user's game.
- Choosing a visual direction does not require building a prototype or connecting Studio. Save the selected kit ID, version and fingerprint in the project; the owner approves the choice before the detailed specification.
- For the visual differences and the user's source photographs, read [references/style-kits.md](references/style-kits.md). Read only the relevant kit when the choice is known.
- If the user asks for a custom variant, preserve its recognizable visual grammar. A palette change alone is not a new style: change the navigation, grouping, action hierarchy, icon treatment and world composition deliberately.
- Preserve an already approved custom or legacy style unless the owner chooses to replace it. Adding this skill to an existing project is not permission to redesign its game.

## Implement the selected kit

Read [references/roblox-implementation.md](references/roblox-implementation.md) when creating or reviewing Roblox UI. Use the selected definition and illustrated symbols in [assets/icons.json](assets/icons.json), together with its preview SVG and icon sheet.

Carry the selected kit through HUD, menu, shop, inventory and world-space UI where those screens are in scope. Keep navigation and currency symbols consistent; give primary actions, secondary actions, disabled states and alerts distinct treatments. Use original bundled shapes rather than emoji, missing external asset IDs or text-only substitutes for promised illustrations.

Game-facing text starts in English (`en-us`) with Roblox localization. Dynamic messages use stable keyed templates and named parameters. Keep player input and names literal. Source-language English and translation readiness are separate from a verified cloud translation.

Preview adaptation is not runtime evidence. Test the produced game in Studio during implementation and acceptance, including actual touch targets, safe areas, text expansion and icon readability. A previously approved preset must not mark those checks passed.

## Bundled resources

- `assets/presets.json`: palette, typography, silhouettes, layout and native implementation tokens.
- `assets/icons.json`: original SVG vector paths for reusable symbols.
- `assets/<kit>-<screen>-<device>.svg`: HUD, menu, shop and inventory examples on desktop and phone.
- `assets/cover-*.svg`: illustrated kit thumbnails.
- `assets/icons-*.svg`: illustrated component sheets for each kit.
- `references/images/*.png`: user-supplied photographs, for visual reference only. Do not carry their player names, brands, event copy or example prices into a new game.

The local workshop automatically pins this skill for art, interface, asset and QA tasks. It is a style layer alongside the project's primary Roblox UI engineering skill, not a second competing engineering standard.
