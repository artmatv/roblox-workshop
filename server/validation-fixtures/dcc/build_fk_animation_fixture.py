"""Build a tiny trusted R15 FK rig for the pinned anim_render.py smoke path.

Usage (from the active task workspace):
  blender --factory-startup --background --offline-mode --python-exit-code 1 \
    --disable-autoexec --python build_fk_animation_fixture.py -- <absolute-task-output.blend>

This generator uses only Blender's built-in bpy/mathutils APIs. It does not open
or execute a supplied .blend file and does not access the network.
"""
import os
import sys
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 1 or not os.path.isabs(args[0]):
    raise SystemExit("expected one absolute task-owned .blend output path")
out_path = os.path.abspath(args[0])
os.makedirs(os.path.dirname(out_path), exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
arm_data = bpy.data.armatures.new("DccFkFixture")
arm = bpy.data.objects.new("DccFkFixture", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
segments = {
    "HumanoidRootPart": ((0, 0, 0.0), (0, 0, 0.35), None),
    "LowerTorso": ((0, 0, 0.35), (0, 0, 1.0), "HumanoidRootPart"),
    "UpperTorso": ((0, 0, 1.0), (0, 0, 1.9), "LowerTorso"),
    "Head": ((0, 0, 1.9), (0, 0, 2.5), "UpperTorso"),
    "RightUpperArm": ((0.3, 0, 1.75), (0.58, 0, 1.2), "UpperTorso"),
    "RightLowerArm": ((0.58, 0, 1.2), (0.7, 0, 0.7), "RightUpperArm"),
    "RightHand": ((0.7, 0, 0.7), (0.7, 0, 0.48), "RightLowerArm"),
    "LeftUpperArm": ((-0.3, 0, 1.75), (-0.58, 0, 1.2), "UpperTorso"),
    "LeftLowerArm": ((-0.58, 0, 1.2), (-0.7, 0, 0.7), "LeftUpperArm"),
    "LeftHand": ((-0.7, 0, 0.7), (-0.7, 0, 0.48), "LeftLowerArm"),
    "RightUpperLeg": ((0.18, 0, 0.35), (0.18, 0, -0.42), "LowerTorso"),
    "RightLowerLeg": ((0.18, 0, -0.42), (0.18, 0, -1.18), "RightUpperLeg"),
    "RightFoot": ((0.18, 0, -1.18), (0.18, 0.28, -1.18), "RightLowerLeg"),
    "LeftUpperLeg": ((-0.18, 0, 0.35), (-0.18, 0, -0.42), "LowerTorso"),
    "LeftLowerLeg": ((-0.18, 0, -0.42), (-0.18, 0, -1.18), "LeftUpperLeg"),
    "LeftFoot": ((-0.18, 0, -1.18), (-0.18, 0.28, -1.18), "LeftLowerLeg"),
}
bones = {}
for name, (head, tail, parent) in segments.items():
    bone = arm_data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = bones[parent]
    bones[name] = bone
bpy.ops.object.mode_set(mode="OBJECT")

parts = {
    "HumanoidRootPart": ((0, 0, 0.15), (0.28, 0.28, 0.28)),
    "LowerTorso": ((0, 0, 0.68), (0.48, 0.32, 0.62)),
    "UpperTorso": ((0, 0, 1.45), (0.62, 0.36, 0.86)),
    "Head": ((0, 0, 2.2), (0.48, 0.44, 0.52)),
    "RightUpperArm": ((0.44, 0, 1.48), (0.24, 0.26, 0.54)),
    "RightLowerArm": ((0.64, 0, 0.95), (0.21, 0.24, 0.48)),
    "RightHand": ((0.7, 0, 0.59), (0.22, 0.24, 0.2)),
    "LeftUpperArm": ((-0.44, 0, 1.48), (0.24, 0.26, 0.54)),
    "LeftLowerArm": ((-0.64, 0, 0.95), (0.21, 0.24, 0.48)),
    "LeftHand": ((-0.7, 0, 0.59), (0.22, 0.24, 0.2)),
    "RightUpperLeg": ((0.18, 0, -0.04), (0.29, 0.34, 0.72)),
    "RightLowerLeg": ((0.18, 0, -0.8), (0.25, 0.3, 0.72)),
    "RightFoot": ((0.18, 0.08, -1.18), (0.3, 0.5, 0.2)),
    "LeftUpperLeg": ((-0.18, 0, -0.04), (0.29, 0.34, 0.72)),
    "LeftLowerLeg": ((-0.18, 0, -0.8), (0.25, 0.3, 0.72)),
    "LeftFoot": ((-0.18, 0.08, -1.18), (0.3, 0.5, 0.2)),
}
material = bpy.data.materials.new("DccFixtureNeutral")
material.diffuse_color = (0.55, 0.68, 0.82, 1.0)
for name, (center, size) in parts.items():
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.object
    obj.name = "Fixture_" + name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = name
    obj.matrix_world = Matrix.Translation(Vector(center))

arm.animation_data_create()
arm.animation_data.action = bpy.data.actions.new("DccFixtureRest")
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="POSE")
root = arm.pose.bones["HumanoidRootPart"]
root.rotation_mode = "XYZ"
root.rotation_euler = (0.0, 0.0, 0.0)
root.keyframe_insert(data_path="rotation_euler", frame=0)
bpy.ops.object.mode_set(mode="OBJECT")
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 240
scene.render.resolution_y = 300
scene.render.resolution_percentage = 100
bpy.ops.wm.save_as_mainfile(filepath=out_path)
print("DCC_FIXTURE_SAVED", out_path)
