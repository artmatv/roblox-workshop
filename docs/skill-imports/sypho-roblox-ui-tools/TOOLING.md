# Offline entrypoints

Run only in the active native workshop task workspace with network disabled. Existing task workspace owns input and output paths.

- python resources/scripts/verify_labels.py --ui <built-ui-directory> --client <client-source-directory>
- python resources/scripts/verify_name_contract.py --gui <built-ui-directory> --contract <name-contract.json>
- python resources/scripts/verify_icon_wiring.py --gui <built-ui-directory> --bank <icon-bank.luau>
- python resources/scripts/verify_ui.py <spec.json>
- python resources/scripts/ui_build.py <spec.json> --out <workspace-output> --png --model --luau (uses patterns.py and ui_kit.py)

The primary design workflow remains the installed roblox-ui skill. The added gates are advisory inputs to the task; they do not impose a theme, green buttons, or global scaling. The bundled upstream font files are omitted; ui_build falls back to PIL default font for previews, which does not guarantee Studio metric fidelity. When the host has Arial Bold, choose BuilderSans for preview text; Studio remains ground truth.
