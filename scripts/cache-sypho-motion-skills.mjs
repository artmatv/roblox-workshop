// Allowlist-only cache for the selected animation, 3D and VFX workflows.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const repo="SyphoDev-yt/roblox-ai-skills", sha="5aad881d1e6553cc3671ad549fdf01b8191bdc37";
const root=resolve(import.meta.dirname,"../docs/skill-imports"), raw=p=>`https://raw.githubusercontent.com/${repo}/${sha}/${p}`;
const get=async(u,json=false)=>{const r=await fetch(u,{headers:{"User-Agent":"Roblox-Workshop-Skill-Cache"}});if(!r.ok)throw Error(`${r.status} ${u}`);return json?r.json():r.text()};
const sha256=s=>createHash("sha256").update(s).digest("hex"), blob=s=>createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
const tree=await get(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,true);if(tree.truncated)throw Error("incomplete tree");const blobs=new Map(tree.tree.filter(x=>x.type==="blob").map(x=>[x.path,x.sha]));
const pinned=async p=>{if(!blobs.has(p))throw Error(`missing ${p}`);const s=await get(raw(p));if(blob(s)!==blobs.get(p))throw Error(`Git blob mismatch ${p}`);return s};
const licensePath="LICENSE.txt", license=await pinned(licensePath), readme=await pinned("README.md"), links=[...readme.matchAll(/https?:\/\/[^\s)]+/g)].map(x=>x[0]).filter(x=>/youtube|youtu\.be/i.test(x));
const boundary=`## Workshop boundaries\n\nAll game changes belong to the currently running, project-bound workshop task and its controlled MCP tools. Preserve project approvals and data; never auto-publish. Run offline helpers only in that task's workspace with network disabled, using absolute ACTIVE root paths and files[].path; do not install packages or use pip. This skill plans work; runtime tools and approvals are checked against the active task.\n\nThis skill owns the motion / 3D / visual appearance slice only. create-game-assets owns the overall style brief, 2D assets and provenance; sypho-roblox-map owns map composition, not individual meshes. Animation covers poses, not gameplay behavior. VFX covers appearance, not damage. Avoid HUMANOID, camera and UI changes unless the task specifically requires them. Authored particles do not imply asset-pack rights. Procedural geometric placeholders cannot stand in for a production complex mesh.\n`;
const common=`# Adapted SyphoDev package for Roblox Workshop\n\nSelective adaptation; exact unmodified upstream skill is retained in UPSTREAM.md. Bundled files are references and may run only offline in an active workshop task workspace.\n\n${boundary}`;
const packs=[
{id:"sypho-roblox-animation",dir:"skills/roblox-animation",roles:["art","assets","gameplay","qa"],caps:[],deps:[],files:["references/pose-recipes.md","references/traps.md","references/example-fk-punch.json","references/example-fk-roundhouse.json","references/example-fk-wave.json","references/example-uppercut.json","scripts/anim_render.py","scripts/calibrate_rig.py","scripts/fk_crouch.py","scripts/fk_probe.py","scripts/probe_bone.py","scripts/r6_clip.py","scripts/r6_joint.py","scripts/r6_luau.py","scripts/rbx_axis_check.py","scripts/sweep_control.py","scripts/to_roblox.py"],title:"Roblox animation authoring",desc:"Author and render task-scoped Roblox character poses with local Blender FK or R6 clip tools, then emit reviewed keyframe data.",body:`Use task-approved rigs and animation data. Render FK poses with anim_render.py or the R6 mesh/joint pipeline with r6_clip.py. Run the selected Blender helpers only in the active task workspace with network disabled. These exporters emit Luau that destroys/replaces target folders or same-named animation children: inspect generated output, choose a unique empty task-owned target folder, and never overwrite existing animations. Do not run external or unreviewed .blend projects with auto-execution enabled; Blender scripts/drivers inside a user rig must be reviewed before enabling them. This is pose authoring, not gameplay. Blender version compatibility is not pinned upstream; validate the installed build.`,tool:`# Offline Blender entrypoints

Use the Blender executable installed by the user. These commands require Blender background mode, Python script execution, and bundled APIs bpy, bmesh, mathutils and mathutils.bvhtree; r6_clip.py also needs Blender's bundled NumPy. The upstream files declare no Blender version floor or ceiling. The local anim_render.py and r6_clip.py select an available Eevee engine; verify_texture.py child runs also inherit fixed factory/offline/disabled-autoexec/strict-exit flags. UPSTREAM.md preserves both exact original files. Do not pass --python-use-system-env. Run in the active task workspace, with network disabled, factory startup and explicit Python error exit; use absolute ACTIVE-root paths and task-owned input/output files.

- FK pose render: blender --factory-startup --background --offline-mode --python-exit-code 1 --disable-autoexec <task-rig.blend> --python <ACTIVE>/resources/scripts/anim_render.py -- <ACTIVE>/pose-spec.json <ACTIVE>/render-dir
- Rig diagnostics: use the same Blender flags and task rig with --python <ACTIVE>/resources/scripts/calibrate_rig.py or sweep_control.py.
- R6 rigid-part clip: blender --factory-startup --background --offline-mode --python-exit-code 1 --python <ACTIVE>/resources/scripts/r6_clip.py -- --rig <ACTIVE>/rig.json --glb-dir <ACTIVE>/parts --clip <ACTIVE>/clip.json --outdir <ACTIVE>/r6-output
- R6 Luau emission: python <ACTIVE>/resources/scripts/r6_luau.py --folder <unique task-owned target> --r6 <ACTIVE>/r6-output/resolved.json
- FK Luau emission: python <ACTIVE>/resources/scripts/to_roblox.py <ACTIVE>/pose-spec.json --folder <unique task-owned target>

r6_clip.py uses r6_joint.py and emits resolved CFrames that r6_luau.py consumes. rbx_axis_check.py uses to_roblox.py. Both Luau exporters have destructive replacement behavior; inspect the generated source before any controlled workshop application. Blender 3D previews are local evidence, not Studio or gameplay validation.`},
{id:"sypho-roblox-3d-model",dir:"skills/roblox-3d-model",roles:["art","assets","qa"],caps:[],deps:[],files:["references/example-manifest.json","references/example-cow.paint.json","references/example-pig.paint.json","references/hard-surface-route.md","references/licences.md","references/traps.md","scripts/axes_probe.py","scripts/check_prop.py","scripts/export_for_studio.py","scripts/glb_tool.py","scripts/make_paint_spec.py","scripts/mesh_pipeline.py","scripts/paint_texture.py","scripts/render_check.py","scripts/texture_bake.py","scripts/verify.py","scripts/verify_texture.py","scripts/quadruped_rig.py","scripts/quadruped_anim.py","scripts/export_skinned.py","scripts/probe_rig.py","scripts/finish_creature.py","scripts/check_colours.py","scripts/landmarks.py","scripts/zprofile.py"],title:"Roblox 3D mesh authoring",desc:"Run local Blender import, cleanup, decimation, UV, paint or bake, render and export steps for task-owned Roblox meshes.",body:`This selection supports a local Blender path from a supplied or task-generated mesh to a cleaned, decimated, UV-mapped and measured export, with procedural texture painting or concept projection baking, renders and Roblox-oriented export. Run the mesh stage first and verify its outputs before continuing. Blender is user-installed; the pinned upstream scripts do not declare a supported version, so test the actual installed build before claiming compatibility. This package includes optional local quadruped rigging, gait rendering and skinned export for supplied creature meshes; those complex rigs need separate validation beyond the base smoke checks. This package does not include remote mesh generation, asset upload, or external model services. Use only task-provided/approved source geometry and task-owned output folders; protect source assets.`,tool:`# Offline Blender entrypoints

Use the user's Blender executable in the active task workspace with network disabled, --factory-startup --background --offline-mode --python-exit-code 1 and --disable-autoexec. Use absolute ACTIVE-root paths. Do not use --python-use-system-env; Blender scripts need bpy, bmesh, mathutils, Cycles/render and glTF operators plus Blender's bundled NumPy. No upstream Blender version floor/ceiling is specified, and the local Blender workflow remains unvalidated until the user's installed build is tested.

1. Run Blender's built-in smoke checks: blender --factory-startup --background --offline-mode --python-exit-code 1 --disable-autoexec --python <ACTIVE>/resources/scripts/verify.py; then the paint-stage checks with --python <ACTIVE>/resources/scripts/verify_texture.py. The pinned checks exercise the mesh stage (19 cases) and painter stage (9 cases).
2. Process an approved GLB/GLTF/OBJ/FBX: blender --factory-startup --background --offline-mode --python-exit-code 1 --disable-autoexec --python <ACTIVE>/resources/scripts/mesh_pipeline.py -- --input <ACTIVE>/source.glb --outdir <ACTIVE>/mesh-output --target-tris 9000
3. Paint an approved procedural spec or bake a supplied concept: use paint_texture.py --mesh <ACTIVE>/mesh-output/low.glb --spec <ACTIVE>/paint-spec.json --outdir <ACTIVE>/paint-output; or texture_bake.py --mesh <ACTIVE>/mesh-output/low.glb --concept <ACTIVE>/approved-concept.png --outdir <ACTIVE>/bake-output. Each Blender command follows the same flags and adds --python before the script.
4. Render a contact sheet: render_check.py --mesh <ACTIVE>/mesh-output/low.glb --color <ACTIVE>/paint-output/color.png --out <ACTIVE>/render.png (same Blender flags and --python <ACTIVE>/resources/scripts/render_check.py --).
5. Export to a task-owned folder: export_for_studio.py --mesh <ACTIVE>/mesh-output/low.glb --color <ACTIVE>/paint-output/color.png --outdir <ACTIVE>/export --name <task-asset-name>.
6. Measure the exported GLB with python <ACTIVE>/resources/scripts/glb_tool.py measure --glb <ACTIVE>/export/<mesh>.glb --json. For supplied quadruped geometry, use the same Blender flags with --python resources/scripts/quadruped_rig.py -- <name> <source.glb> <rig-output>, then open <rig-output>/<name>_rigged.blend with quadruped_anim.py -- <name> trot <gait-output>, then export the skin with export_skinned.py -- <name> <skinned-output>. Inspect the gait renders and rig report. Blender's own import/export operators are separate checks from Studio import and visual review.

Use axes_probe.py and check_prop.py where axes or colour evidence is needed; use make_paint_spec.py to start a task-owned paint recipe. probe_rig.py, finish_creature.py, landmarks.py, zprofile.py and check_colours.py provide additional local creature geometry/rig diagnostics. Keep all outputs under the active task. No uploads, servers, batch orchestrator, remote generators, Hugging Face, Kaggle or Kiln. Blender-generated placeholders cannot stand in for a production-complex mesh without explicit acceptance.`},
{id:"sypho-roblox-vfx",dir:"skills/roblox-vfx",roles:["art","assets","gameplay","qa"],caps:[],deps:[],files:["scripts/verify_vfx.py","scripts/emit_luau.py","scripts/luau/engine.lua","references/DESIGN.md","references/BEATS.md","references/property-surface.md"],title:"Roblox visual effects",desc:"Validate VFX recipes and emit task-scoped Luau for visual effects that stay within approved game behavior.",body:`Use recipes as design examples, not licensed asset packs. VFX controls visual appearance only; damage, hit detection, and gameplay remain with the task's gameplay design. Do not touch HUMANOID, camera, or UI unless explicitly required. Validate the task-owned recipe directory before emitting Luau and review generated code before the controlled workshop step. No harvested assets or external generators are included. Blender simulation is optional and is not a substitute for local Blender mesh authoring in the 3D-model package.`,tool:`# Offline entrypoints

Run only in the active task workspace with network disabled.

- python resources/scripts/verify_vfx.py --self-test
- python resources/scripts/emit_luau.py --lib <task-recipe-dir> --compact <task-output.lua>

Validate a recipe explicitly with python resources/scripts/verify_vfx.py --lib <task-recipe-dir> <task-recipe-dir/simple_particle.json>. Emit a ModuleScript with python resources/scripts/emit_luau.py --lib <task-recipe-dir> --compact <task-output.lua>. Both paths are task-local and offline. Inspect the generated ModuleScript before applying it through controlled workshop tools. emit_luau.py embeds its VFXKit implementation in HEAD; its API builds on a supplied BasePart and returns a handle with emit(), setEnabled(), and destroy() for tagged task-owned attachments. The bundled scripts/luau/engine.lua is the separate stage/timeline engine reference, not an instruction to replace a project runtime.`}
];const props={Acceleration:{Vector3:[0,0,0]},Brightness:1,Color:{ColorSequence:[[0,[1,0.75,0.25]],[1,[1,0.2,0.05]]]},Drag:0,EmissionDirection:{Enum:"NormalId.Top"},Enabled:false,FlipbookFramerate:{NumberRange:[0,0]},FlipbookLayout:{Enum:"ParticleFlipbookLayout.None"},FlipbookMode:{Enum:"ParticleFlipbookMode.Loop"},FlipbookStartRandom:false,Lifetime:{NumberRange:[0.5,1]},LightEmission:0,LightInfluence:0,LockedToPart:false,Orientation:{Enum:"ParticleOrientation.FacingCamera"},Rate:0,RotSpeed:{NumberRange:[0,0]},Rotation:{NumberRange:[0,360]},Shape:{Enum:"ParticleEmitterShape.Box"},ShapeInOut:{Enum:"ParticleEmitterShapeInOut.Outward"},ShapeStyle:{Enum:"ParticleEmitterShapeStyle.Volume"},Size:{NumberSequence:[[0,0.5,0],[1,0.05,0]]},SpreadAngle:{Vector2:[20,20]},Speed:{NumberRange:[4,8]},Squash:{NumberSequence:[[0,0,0],[1,0,0]]},Texture:"rbxasset://textures/particles/sparkles_main.dds",TimeScale:1,Transparency:{NumberSequence:[[0,0,0],[1,1,0]]},VelocityInheritance:0,ZOffset:0,WindAffectsDrag:false};
const simpleRecipe={name:"SimpleParticlePreview",duration:1.5,texture_portable:true,texture_refs:["rbxasset://textures/particles/sparkles_main.dds"],layers:[{name:"Spark",class:"ParticleEmitter",offset:[0,0,0],emit:{mode:"burst",count:12},props}]};
const reports=[];
for(const p of packs){const upstream=await pinned(`${p.dir}/SKILL.md`), files=[{path:"SKILL.md",content:`---\nname: ${p.id}\ndescription: ${p.desc}\n---\n\n# ${p.title}\n\n${common}\n## Adapted workflow\n\n${p.body}\n\nSee TOOLING.md for the selected offline entrypoints and resources/ for included upstream references.\n`},{path:"UPSTREAM.md",content:upstream},{path:"TOOLING.md",content:p.tool},{path:"LICENSE.txt",content:license}];
const selected=[];
for(const rel of p.files){
 const original=`${p.dir}/${rel}`;
 const sourceText=await pinned(original);
 let content=sourceText;
 if(p.id==="sypho-roblox-animation"&&rel==="scripts/anim_render.py"){
  const old='sc.render.engine = "BLENDER_EEVEE_NEXT"';
  if(!sourceText.includes(old))throw Error("Expected upstream Eevee assignment not found");
  content=sourceText.replace(old,`engines = {item.identifier for item in sc.render.bl_rna.properties["engine"].enum_items}
if "BLENDER_EEVEE_NEXT" in engines:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
elif "BLENDER_EEVEE" in engines:
    sc.render.engine = "BLENDER_EEVEE"
else:
    die("no supported Eevee renderer in this Blender build")`).replace(
   'print(f"=== keying into existing action {act.name!r} ({len(act.fcurves)} fcurves) from frame {START}")',
   'print(f"=== keying into existing action {act.name!r} from frame {START}")'
  ).replace(
   'print(f"=== baked {n} frames of keys; action now has {len(act.fcurves)} fcurves")',
   'print(f"=== baked {n} frames of keys into action {act.name!r}")'
  );
 }
  if(p.id==="sypho-roblox-3d-model"&&rel==="scripts/verify_texture.py"){
  content=sourceText.replace('[blender, "--background", "--python",','[blender, "--background", "--factory-startup", "--offline-mode", "--python-exit-code", "1", "--disable-autoexec", "--python",').replace('[bpy.app.binary_path, "--background", "--python",','[bpy.app.binary_path, "--background", "--factory-startup", "--offline-mode", "--python-exit-code", "1", "--disable-autoexec", "--python",');
 }if(p.id==="sypho-roblox-animation"&&rel==="scripts/r6_clip.py"){
 const old='sc.render.engine = "BLENDER_EEVEE_NEXT"';
 if(!sourceText.includes(old))throw Error("Expected upstream R6 Eevee assignment not found");
 content=sourceText.replace(old,`engines = {item.identifier for item in sc.render.bl_rna.properties["engine"].enum_items}
if "BLENDER_EEVEE_NEXT" in engines:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
elif "BLENDER_EEVEE" in engines:
    sc.render.engine = "BLENDER_EEVEE"
else:
    die("no supported Eevee renderer in this Blender build")`);
}
if(p.id==="sypho-roblox-3d-model"&&rel==="scripts/render_check.py"){
 const old='s.render.engine = "BLENDER_EEVEE_NEXT"';
 if(!sourceText.includes(old))throw Error("Expected upstream render_check Eevee assignment not found");
 content=sourceText.replace(old,`engines = {item.identifier for item in s.render.bl_rna.properties["engine"].enum_items}
        s.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"`);
}const path=`resources/${rel.replace(/\.luau?$/i,e=>e+".txt")}`;
 files.push({path,content,originalPath:rel});selected.push(original);
}
if(p.id==="sypho-roblox-vfx")files.push({path:"resources/examples/simple_particle.json",content:JSON.stringify(simpleRecipe,null,2)+"\n",originalPath:"examples/simple_particle.json"});
const resources=files.filter(f=>f.originalPath).map(f=>({originalPath:f.originalPath,path:f.path,hash:sha256(f.content)})).sort((a,b)=>a.originalPath.localeCompare(b.originalPath));files.push({path:"RESOURCE_MAP.json",content:JSON.stringify({files:resources},null,2)+"\n"});files.sort((a,b)=>a.path.localeCompare(b.path));
const packageHash=sha256(JSON.stringify(files.map(({path,content})=>({path,content})).sort((a,b)=>a.path.localeCompare(b.path))));const payload={id:p.id,source:`https://github.com/${repo}/tree/${sha}/${p.dir}`,version:`${sha}-workshop.1`,license:"SyphoDev free licence",licensePath:"LICENSE.txt",roles:p.roles,capabilities:p.caps,dependencies:p.deps,files:files.map(({path,content})=>({path,content})),packageHash,resourceFiles:resources};
const out=resolve(root,p.id);for(const f of files){const target=resolve(out,f.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,f.content,"utf8")}writeFileSync(resolve(root,`${p.id}.json`),JSON.stringify(payload,null,2)+"\n");reports.push({id:p.id,source:payload.source,commit:sha,version:payload.version,packageHash,license:"SyphoDev free licence",licensePath:"LICENSE.txt", youtubeLinksInReadme:links,included:files.map(f=>({path:f.path,originalPath:f.originalPath||null,bytes:Buffer.byteLength(f.content),sha256:sha256(f.content)})),localAdaptations:p.id==="sypho-roblox-animation"?["scripts/anim_render.py and r6_clip.py select an available Eevee renderer; anim_render also avoids removed Action.fcurves logging; exact upstream source is preserved in UPSTREAM.md"]:p.id==="sypho-roblox-3d-model"?["scripts/verify_texture.py child Blender launches use factory startup, offline mode, disabled autoexec and strict Python exit codes; render_check.py selects an available Eevee renderer; original source is preserved in UPSTREAM.md"]:[],excluded:tree.tree.filter(f=>f.type==="blob"&&f.path.startsWith(p.dir+"/")&&!p.files.includes(f.path.slice(p.dir.length+1))&&!(["SKILL.md"].includes(f.path.slice(p.dir.length+1)))).map(f=>({path:f.path.slice(p.dir.length+1),reason:(f.path==="skills/roblox-vfx/sim/effects/explosion_crimson.json"?"simulation effect schema is incompatible with the selected recipe verifier/emitter; replaced by a minimal verified portable example":"outside the selected, offline task workflow")}))});}
writeFileSync(resolve(root,"sypho-motion-sources.json"),JSON.stringify({repo,commit:sha,licensePath,licenseSha256:sha256(license),youtubeAttribution:{readmeMentionsChannel:true,linksFound:links},packages:reports},null,2)+"\n");console.log(JSON.stringify(reports.map(p=>({id:p.id,included:p.included.map(f=>f.path),packageHash:p.packageHash})),null,2));


















