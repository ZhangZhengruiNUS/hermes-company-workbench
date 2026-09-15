#!/usr/bin/env python3
"""build.py — assemble kanban.html from v5_template.html.

实时化后模板自带启动逻辑(运行期 fetch /api/v1/board), 无数据注入。
保留脚本以维持既有部署流程; v5_data.json 仅作回滚参考, 不再注入。

用法: python3 build.py [src_template.html] [out.html]
"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "v5_template.html")
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "kanban.html")

tpl = SRC.read_text(encoding="utf-8")
# 兼容旧占位符: 实时化后模板中不存在 /*__KANBAN_DATA__*/, 若出现则视为错误
assert "/*__KANBAN_DATA__*/" not in tpl, "template still has data placeholder!"
OUT.write_text(tpl, encoding="utf-8")
print("written", OUT, len(tpl), "bytes")
