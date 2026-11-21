---
name: sypho-roblox-animation
description: Author and render task-scoped Roblox character poses with local Blender FK or R6 clip tools, then emit reviewed keyframe data.
---

# Roblox animation authoring

# Adapted SyphoDev package for Roblox Workshop

Selective adaptation; exact unmodified upstream skill is retained in UPSTREAM.md. Bundled files are references and may run only offline in an active workshop task workspace.

## Workshop boundaries

All game changes belong to the currently running, project-bound workshop task and its controlled MCP tools. Preserve project approvals and data; never auto-publish. Run offline helpers only in that task's workspace with network disabled, using absolute ACTIVE root paths and files[].path; do not install packages or use pip. This skill plans work; runtime tools and approvals are checked against the active task.

This skill owns the motion / 3D / visual appearance slice only. create-game-assets owns the overall style brief, 2D assets and provenance; sypho-roblox-map owns map composition, not individual meshes. Animation covers poses, not gameplay behavior. VFX covers appearance, not damage. Avoid HUMANOID, camera and UI changes unless the task specifically requires them. Authored particles do not imply asset-pack rights. Procedural geometric placeholders cannot stand in for a production complex mesh.

## Adapted workflow

Use task-approved rigs and animation data. Render FK poses with anim_render.py or the R6 mesh/joint pipeline with r6_clip.py. Run the selected Blender helpers only in the active task workspace with network disabled. These exporters emit Luau that destroys/replaces target folders or same-named animation children: inspect generated output, choose a unique empty task-owned target folder, and never overwrite existing animations. Do not run external or unreviewed .blend projects with auto-execution enabled; Blender scripts/drivers inside a user rig must be reviewed before enabling them. This is pose authoring, not gameplay. Blender version compatibility is not pinned upstream; validate the installed build.

See TOOLING.md for the selected offline entrypoints and resources/ for included upstream references.
