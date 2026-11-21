# Offline entrypoints

Run only in the active task workspace with network disabled.

- python resources/scripts/verify_vfx.py --self-test
- python resources/scripts/emit_luau.py --lib <task-recipe-dir> --compact <task-output.lua>

Validate a recipe explicitly with python resources/scripts/verify_vfx.py --lib <task-recipe-dir> <task-recipe-dir/simple_particle.json>. Emit a ModuleScript with python resources/scripts/emit_luau.py --lib <task-recipe-dir> --compact <task-output.lua>. Both paths are task-local and offline. Inspect the generated ModuleScript before applying it through controlled workshop tools. emit_luau.py embeds its VFXKit implementation in HEAD; its API builds on a supplied BasePart and returns a handle with emit(), setEnabled(), and destroy() for tagged task-owned attachments. The bundled scripts/luau/engine.lua is the separate stage/timeline engine reference, not an instruction to replace a project runtime.