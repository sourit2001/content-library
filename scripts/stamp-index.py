"""Stamp packs/index.json with the commit that holds the pack files.

Publish flow (CDN mirrors cache `main` unevenly, so files are fetched from a
pinned commit and the newest index revision wins):

    git add packs && git commit -m "Update packs"      # 1. commit the pack files
    python3 scripts/stamp-index.py                      # 2. point index.json at that commit
    git commit -am "Stamp pack index" && git push       # 3. publish the index
"""
import json, subprocess, time, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
index_path = root / "packs" / "index.json"
ref = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
dirty = subprocess.run(["git", "status", "--porcelain", "packs"], cwd=root, capture_output=True, text=True).stdout.strip()
if dirty:
    raise SystemExit("Commit the pack files first; packs/ has uncommitted changes:\n" + dirty)
index = json.loads(index_path.read_text())
index["revision"] = int(time.time())
index["ref"] = ref
index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
print(f"index.json -> ref {ref[:12]}, revision {index['revision']}")
