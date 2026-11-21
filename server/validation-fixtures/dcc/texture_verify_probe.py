"""Run the pinned texture package verifier in the current task-local Blender."""
import hashlib, json, os, runpy, shutil, sys, tempfile

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 2 or not all(os.path.isabs(p) for p in args):
    raise SystemExit("expected absolute verify_texture.py and task action output directory")
verifier, output = map(os.path.realpath, args)
os.makedirs(output, exist_ok=True)
for key in ("TMP", "TEMP", "TMPDIR"):
    os.environ[key] = output
tempfile.tempdir = output
sys.path.insert(0, os.path.dirname(verifier))
sys.argv = [verifier]
private_dirs = []
original_mkdtemp = tempfile.mkdtemp
def tracked_mkdtemp(*args, **kwargs):
    path = original_mkdtemp(*args, **kwargs)
    private_dirs.append(path)
    return path
tempfile.mkdtemp = tracked_mkdtemp
try:
    try:
        runpy.run_path(verifier, run_name="__main__")
    except SystemExit as result:
        if result.code not in (None, 0):
            raise
    if not private_dirs:
        raise SystemExit("texture verifier did not create its expected temporary workspace")
    private = private_dirs[-1]
    destination = os.path.join(output, "artifacts")
    os.makedirs(destination, exist_ok=True)
    copied = []
    for name in ("report.json", "color.png", "paint_report.json"):
        source = os.path.join(private, "out", name)
        if not os.path.isfile(source):
            raise SystemExit("texture verifier output missing: " + name)
        with open(source, "rb") as src, open(os.path.join(destination, name), "wb") as dst:
            content = src.read()
            dst.write(content)
        copied.append({"name": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    print("WORKSHOP_DCC_EVIDENCE=" + json.dumps({"kind": "texture", "checks": "9/9", "artifacts": copied}, sort_keys=True), flush=True)
finally:
    tempfile.mkdtemp = original_mkdtemp
    for path in private_dirs:
        shutil.rmtree(path, ignore_errors=True)
