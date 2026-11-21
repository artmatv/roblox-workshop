# Offline Blender entrypoints

Use the Blender executable installed by the user. These commands require Blender background mode, Python script execution, and bundled APIs bpy, bmesh, mathutils and mathutils.bvhtree; r6_clip.py also needs Blender's bundled NumPy. The upstream files declare no Blender version floor or ceiling. The local anim_render.py and r6_clip.py select an available Eevee engine; verify_texture.py child runs also inherit fixed factory/offline/disabled-autoexec/strict-exit flags. UPSTREAM.md preserves both exact original files. Do not pass --python-use-system-env. Run in the active task workspace, with network disabled, factory startup and explicit Python error exit; use absolute ACTIVE-root paths and task-owned input/output files.

- FK pose render: blender --factory-startup --background --offline-mode --python-exit-code 1 --disable-autoexec <task-rig.blend> --python <ACTIVE>/resources/scripts/anim_render.py -- <ACTIVE>/pose-spec.json <ACTIVE>/render-dir
- Rig diagnostics: use the same Blender flags and task rig with --python <ACTIVE>/resources/scripts/calibrate_rig.py or sweep_control.py.
- R6 rigid-part clip: blender --factory-startup --background --offline-mode --python-exit-code 1 --python <ACTIVE>/resources/scripts/r6_clip.py -- --rig <ACTIVE>/rig.json --glb-dir <ACTIVE>/parts --clip <ACTIVE>/clip.json --outdir <ACTIVE>/r6-output
- R6 Luau emission: python <ACTIVE>/resources/scripts/r6_luau.py --folder <unique task-owned target> --r6 <ACTIVE>/r6-output/resolved.json
- FK Luau emission: python <ACTIVE>/resources/scripts/to_roblox.py <ACTIVE>/pose-spec.json --folder <unique task-owned target>

r6_clip.py uses r6_joint.py and emits resolved CFrames that r6_luau.py consumes. rbx_axis_check.py uses to_roblox.py. Both Luau exporters have destructive replacement behavior; inspect the generated source before any controlled workshop application. Blender 3D previews are local evidence, not Studio or gameplay validation.