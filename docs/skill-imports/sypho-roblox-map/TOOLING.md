# Offline entrypoints

Run only in the active native workshop task workspace with network disabled; use the current task's spec and write outputs to its workspace.

- python resources/scripts/prove.py <workspace-spec.json> --json <workspace-report.json>
- python resources/scripts/plan.py <workspace-spec.json> --prove -o <workspace-plan.png>
- python resources/scripts/emit.py <workspace-spec.json> --lua <workspace-build.lua> (small maps)
- python resources/scripts/verify_map.py (offline self-test)

No emitted artifact may be inserted or executed except through the active workshop task's controlled Studio MCP calls. A PASS is not evidence of live physics, playability, or visual quality.
