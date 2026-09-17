#!/usr/bin/env python3
"""Call the project CLI from the current coding agent, without a second agent."""
import pathlib, shutil, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[4]
bun = shutil.which('bun') or str(pathlib.Path.home()/'.bun/bin/bun')
raise SystemExit(subprocess.run([bun, str(root/'dist/cli.mjs'), *sys.argv[1:]]).returncode)
