#!/usr/bin/env python3
"""build.py — assemble kanban.html from v5_template.html.

实时化后模板自带启动逻辑(运行期 fetch /api/v1/board), 无数据注入。
构建时注入部署版本: 读 git rev-parse HEAD, 将模板中 __WB_VERSION__ 替换为短 SHA,
页面侧栏底部显示 "Workbench · <short sha>"。不手工写死, 不引入 CI。
v5_data.json 仅作回滚参考, 不再注入。

用法: python3 build.py [--version X] [src_template.html] [out.html]
  --version X: 注入指定版本标识(默认= git rev-parse --short HEAD)
"""
import pathlib
import subprocess
import sys

args = [a for a in sys.argv[1:]]
version_arg = None
if "--version" in args:
    i = args.index("--version")
    if i + 1 >= len(args):
        sys.exit("build.py: --version requires a value")
    version_arg = args[i + 1]
    del args[i:i + 2]

SRC = pathlib.Path(args[0] if args else "v5_template.html")
OUT = pathlib.Path(args[1] if len(args) > 1 else "kanban.html")

def git_short_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(SRC.parent), stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return "unknown"

tpl = SRC.read_text(encoding="utf-8")
# 兼容旧占位符: 实时化后模板中不存在 /*__KANBAN_DATA__*/, 若出现则视为错误
assert "/*__KANBAN_DATA__*/" not in tpl, "template still has data placeholder!"
assert "__WB_VERSION__" in tpl, "template missing __WB_VERSION__ placeholder!"
sha = version_arg if version_arg else git_short_sha()
out = tpl.replace("__WB_VERSION__", sha)
OUT.write_text(out, encoding="utf-8")
print("written", OUT, len(out), "bytes (version: %s)" % sha)
