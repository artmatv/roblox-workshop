"""Build the trusted FK fixture, execute the pinned animation renderer, and decode outputs."""
import bpy, hashlib, json, math, os, runpy, sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 4 or not all(os.path.isabs(p) for p in args):
    raise SystemExit("expected absolute fixture builder, anim_render.py, pose spec and output directory")
builder, renderer, spec, output = map(os.path.realpath, args)
with open(spec, encoding="utf-8") as stream:
    pose = json.load(stream)
expected_width, expected_height = ((320, 240) if pose.get("preview", False)
                                  else (int(pose.get("w", 560)), int(pose.get("h", 700))))
os.makedirs(output, exist_ok=True)
blend = os.path.join(output, "fk_fixture.blend")
renders = os.path.join(output, "renders")
os.makedirs(renders, exist_ok=True)
sys.argv = [builder, "--", blend]
runpy.run_path(builder, run_name="__main__")
if not os.path.isfile(blend):
    raise SystemExit("trusted fixture builder did not write its blend file")
bpy.ops.wm.open_mainfile(filepath=blend)
sys.argv = [renderer, "--", spec, renders]
runpy.run_path(renderer, run_name="__main__")
frames = sorted(os.path.join(renders, name) for name in os.listdir(renders)
                if name.startswith("front_") and name.endswith(".png"))
if len(frames) < 2:
    raise SystemExit("animation renderer produced fewer than two front frames")
decoded = []
for path in frames:
    img = bpy.data.images.load(path, check_existing=False)
    rgba = tuple(img.pixels[:])
    if (tuple(img.size) != (expected_width, expected_height)
            or len(rgba) != expected_width * expected_height * 4
            or not all(math.isfinite(value) for value in rgba)
            or not img.has_data):
        raise SystemExit("animation frame failed PNG decode or expected dimensions")
    decoded.append({"path": path, "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
                    "width": int(img.size[0]), "height": int(img.size[1])})
    bpy.data.images.remove(img)
if len({item["sha256"] for item in decoded}) < 2:
    raise SystemExit("animation frames are identical")
sheet = os.path.join(output, "contact-sheet.png")
# Decode every source again through Blender, then assemble a deterministic strip.
images = [bpy.data.images.load(path, check_existing=False) for path in frames]
width, height = expected_width * len(images), expected_height
sheet_image = bpy.data.images.new("WorkshopAnimationContactSheet", width, height, alpha=True)
pixels = [0.0] * (width * height * 4)
for idx, image in enumerate(images):
    for y in range(height):
        row_bytes = expected_width * 4
        src = y * row_bytes
        dst = (y * width + idx * expected_width) * 4
        pixels[dst:dst + row_bytes] = image.pixels[src:src + row_bytes]
sheet_image.pixels[:] = pixels
sheet_image.filepath_raw = sheet
sheet_image.file_format = "PNG"
sheet_image.save()
check_sheet = bpy.data.images.load(sheet, check_existing=False)
sheet_pixels = tuple(check_sheet.pixels[:])
if (tuple(check_sheet.size) != (width, height)
        or len(sheet_pixels) != width * height * 4
        or not all(math.isfinite(value) for value in sheet_pixels)
        or not check_sheet.has_data):
    raise SystemExit("contact sheet failed PNG decode or dimension check")
bpy.data.images.remove(check_sheet)
sheet_digest = hashlib.sha256(open(sheet, "rb").read()).hexdigest()
print("WORKSHOP_DCC_EVIDENCE=" + json.dumps({"kind": "animation", "frames": decoded,
      "contactSheet": {"path": sheet, "sha256": sheet_digest, "width": width, "height": height}}, sort_keys=True), flush=True)
