from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value.strip()

    for env_filename in (".env.local", ".env.supabase.local"):
        env_path = Path.cwd() / env_filename
        if not env_path.exists():
            continue
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if not line or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, raw_value = line.split("=", 1)
                if key.strip() == name:
                    return raw_value.strip().strip('"').strip("'")
        except Exception:
            continue
    return None


def int_env(name: str, default: int) -> int:
    try:
        value = int(env_value(name) or "")
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


@contextmanager
def one_byte_file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import msvcrt
        lock = path.open("a+b")
    except Exception:
        pass
    else:
        with lock:
            lock.seek(0, os.SEEK_END)
            if lock.tell() == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        return

    try:
        import fcntl
        lock = path.open("a+b")
    except Exception:
        yield
        return

    with lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
