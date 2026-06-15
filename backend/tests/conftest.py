"""Изолированная тестовая среда: временный конфиг (sqlite + storage во временной папке).

CONFIG_PATH выставляется ДО импорта приложения, поэтому app.config подхватит его.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="do-test-"))
_cfg = _tmp / "config.yaml"
_cfg.write_text(
    f"""
database_url: sqlite:///{(_tmp / 'test.db').as_posix()}
storage_dir: {(_tmp / 'storage').as_posix()}
log_level: WARNING
security:
  require_auth: false
""",
    encoding="utf-8",
)
os.environ["CONFIG_PATH"] = str(_cfg)
