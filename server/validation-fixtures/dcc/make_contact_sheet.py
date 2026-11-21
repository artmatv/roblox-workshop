"""Load Blender-rendered PNG frames and compose one trusted review sheet.

Usage: blender <flags> --python make_contact_sheet.py -- <absolute-output.png> <frame.png>...
"""
import os
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 3:
    raise SystemExit("expected output path and at least two frame PNG paths")
out = os.path.abspath(args[0])
paths = [os.path.abspath(p) for p in args[1:]]
images = []
for path in paths:
    image = bpy.data.images.load(path, check_existing=False)
    if not image.has_data or image.size[0] <= 0 or image.size[1] <= 0:
        raise SystemExit("unreadable render frame: " + path)
    images.append(image)
width, height = images[0].size
if any(tuple(image.size) != (width, height) for image in images):
    raise SystemExit("render frames have inconsistent dimensions")
sheet_width = width * len(images)
sheet = bpy.data.images.new("DccAnimationContactSheet", width=sheet_width, height=height, alpha=True, float_buffer=False)
pixels = [0.0] * (sheet_width * height * 4)
for col, image in enumerate(images):
    source = list(image.pixels[:])
    for row in range(height):
        src = row * width * 4
        dst = (row * sheet_width + col * width) * 4
        pixels[dst:dst + width * 4] = source[src:src + width * 4]
sheet.pixels[:] = pixels
sheet.file_format = "PNG"
sheet.filepath_raw = out
sheet.save()
print("CONTACT_SHEET", out, "size", sheet.size[0], sheet.size[1], "frames", len(images))
