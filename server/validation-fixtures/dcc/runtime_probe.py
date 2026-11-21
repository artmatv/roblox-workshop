"""Ordinary task-local Blender runtime probe. No network or installation steps."""
import bpy, json, os, sys
import numpy as np

print("WORKSHOP_DCC_EVIDENCE=" + json.dumps({
    "kind": "runtime", "blenderVersion": bpy.app.version_string,
    "blenderBinary": os.path.realpath(bpy.app.binary_path),
    "pythonVersion": sys.version.split()[0], "numpyVersion": np.__version__,
    "pythonExecutable": os.path.realpath(sys.executable),
}, sort_keys=True), flush=True)
