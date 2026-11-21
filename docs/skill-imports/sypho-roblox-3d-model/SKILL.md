---
name: sypho-roblox-3d-model
description: Run local Blender import, cleanup, decimation, UV, paint or bake, render and export steps for task-owned Roblox meshes.
---

# Roblox 3D mesh authoring

# Adapted SyphoDev package for Roblox Workshop

Selective adaptation; exact unmodified upstream skill is retained in UPSTREAM.md. Bundled files are references and may run only offline in an active workshop task workspace.

## Workshop boundaries

All game changes belong to the currently running, project-bound workshop task and its controlled MCP tools. Preserve project approvals and data; never auto-publish. Run offline helpers only in that task's workspace with network disabled, using absolute ACTIVE root paths and files[].path; do not install packages or use pip. This skill plans work; runtime tools and approvals are checked against the active task.

This skill owns the motion / 3D / visual appearance slice only. create-game-assets owns the overall style brief, 2D assets and provenance; sypho-roblox-map owns map composition, not individual meshes. Animation covers poses, not gameplay behavior. VFX covers appearance, not damage. Avoid HUMANOID, camera and UI changes unless the task specifically requires them. Authored particles do not imply asset-pack rights. Procedural geometric placeholders cannot stand in for a production complex mesh.

## Adapted workflow

This selection supports a local Blender path from a supplied or task-generated mesh to a cleaned, decimated, UV-mapped and measured export, with procedural texture painting or concept projection baking, renders and Roblox-oriented export. Run the mesh stage first and verify its outputs before continuing. Blender is user-installed; the pinned upstream scripts do not declare a supported version, so test the actual installed build before claiming compatibility. This package includes optional local quadruped rigging, gait rendering and skinned export for supplied creature meshes; those complex rigs need separate validation beyond the base smoke checks. This package does not include remote mesh generation, asset upload, or external model services. Use only task-provided/approved source geometry and task-owned output folders; protect source assets.

See TOOLING.md for the selected offline entrypoints and resources/ for included upstream references.
