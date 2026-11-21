"""Generate the fixed 2-stud closed cube GLB motion validation fixture."""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).parent
vertices = [
    (-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
    (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1),
]
# Two outward-facing triangles per side.
indices = [
    0,2,1, 0,3,2, 4,5,6, 4,6,7,
    0,1,5, 0,5,4, 3,7,6, 3,6,2,
    0,4,7, 0,7,3, 1,2,6, 1,6,5,
]
pos = b"".join(struct.pack("<3f", *v) for v in vertices)
idx = b"".join(struct.pack("<H", i) for i in indices)
idx_offset = (len(pos) + 3) & ~3
binary = pos + b"\0" * (idx_offset - len(pos)) + idx
gltf = {
    "asset": {"version": "2.0", "generator": "Sypho trusted motion fixture"},
    "scene": 0, "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
    "buffers": [{"byteLength": len(binary)}],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
        {"buffer": 0, "byteOffset": idx_offset, "byteLength": len(idx), "target": 34963},
    ],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": [-1,-1,-1], "max": [1,1,1]},
        {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR", "min": [0], "max": [7]},
    ],
}
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
binary += b"\0" * ((4 - len(binary) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(binary)
glb = struct.pack("<III", 0x46546C67, 2, total)
glb += struct.pack("<I4s", len(js), b"JSON") + js
glb += struct.pack("<I4s", len(binary), b"BIN\0") + binary
for target in (ROOT / "input" / "mesh.glb", ROOT / "golden" / "mesh.glb"):
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(glb)
