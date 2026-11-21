"""Generate a tiny trusted, low-poly quadruped GLB for the pinned offline rig/gait smoke path."""
import os
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 1 or not os.path.isabs(args[0]):
    raise SystemExit("expected one absolute task-owned .glb output path")
out = os.path.abspath(args[0])
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

parts = []
def add_ico(name, location, scale, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(obj)
def add_cube(name, location, scale):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(obj)

# Body is long on +Y/-Y; four legs extend to the same ground plane in all quadrants.
add_ico("Body", (0, 0, 1.15), (0.42, 0.95, 0.42), 3)
add_ico("Chest", (0, 0.48, 1.18), (0.42, 0.48, 0.42), 2)
add_ico("Head", (0, 1.02, 1.42), (0.28, 0.31, 0.27), 2)
add_cube("Neck", (0, 0.80, 1.3), (0.26, 0.36, 0.28))
for x, side in [(-0.34, "L"), (0.34, "R")]:
    for y, end in [(-0.58, "B"), (0.58, "F")]:
        add_cube(f"Leg_{side}{end}", (x, y, 0.55), (0.18, 0.18, 1.10))
add_ico("Tail", (0, -0.98, 1.25), (0.12, 0.32, 0.12), 1)

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
mesh = bpy.context.object
mesh.name = "DccQuadruped"
mesh.data.name = mesh.name + "Mesh"
# A flat material gives the rig and gait renderer visible geometry.
mat = bpy.data.materials.new("DccQuadrupedNeutral")
mat.diffuse_color = (0.42, 0.58, 0.38, 1.0)
mesh.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True)
print("DCC_QUADRUPED_GLB", out, "verts", len(mesh.data.vertices), "faces", len(mesh.data.polygons))
