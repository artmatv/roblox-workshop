---
name: sypho-roblox-vfx
description: Validate VFX recipes and emit task-scoped Luau for visual effects that stay within approved game behavior.
---

# Roblox visual effects

# Adapted SyphoDev package for Roblox Workshop

Selective adaptation; exact unmodified upstream skill is retained in UPSTREAM.md. Bundled files are references and may run only offline in an active workshop task workspace.

## Workshop boundaries

All game changes belong to the currently running, project-bound workshop task and its controlled MCP tools. Preserve project approvals and data; never auto-publish. Run offline helpers only in that task's workspace with network disabled, using absolute ACTIVE root paths and files[].path; do not install packages or use pip. This skill plans work; runtime tools and approvals are checked against the active task.

This skill owns the motion / 3D / visual appearance slice only. create-game-assets owns the overall style brief, 2D assets and provenance; sypho-roblox-map owns map composition, not individual meshes. Animation covers poses, not gameplay behavior. VFX covers appearance, not damage. Avoid HUMANOID, camera and UI changes unless the task specifically requires them. Authored particles do not imply asset-pack rights. Procedural geometric placeholders cannot stand in for a production complex mesh.

## Adapted workflow

Use recipes as design examples, not licensed asset packs. VFX controls visual appearance only; damage, hit detection, and gameplay remain with the task's gameplay design. Do not touch HUMANOID, camera, or UI unless explicitly required. Validate the task-owned recipe directory before emitting Luau and review generated code before the controlled workshop step. No harvested assets or external generators are included. Blender simulation is optional and is not a substitute for local Blender mesh authoring in the 3D-model package.

See TOOLING.md for the selected offline entrypoints and resources/ for included upstream references.
