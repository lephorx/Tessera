"""Server files, read and written without ever following a symlink.

A server's folder is shared with its Minecraft container, so whatever runs
there (a plugin, a mod, someone with console access) can put a symlink in it.
This API runs as root next to the database and the Docker socket: a link like
`x -> /app/data/cscm.db` must never be read, written, zipped, copied or
restored through.

Everything here works on a trusted base folder (SERVERS_DIR/<id>, a backup
folder) plus a path relative to it. '..', NUL bytes and symlinks in any
component are refused with UnsafePath. Files are opened one directory at a
time with O_NOFOLLOW (dir_fd), so swapping a folder for a link between the
check and the open doesn't help either.
"""

import errno
import os
import stat
import time
import zipfile
from pathlib import Path
from typing import BinaryIO, Iterator

_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_NONBLOCK = getattr(os, "O_NONBLOCK", 0)  # a planted FIFO must not hang the API
_COPY_CHUNK = 1024 * 1024


class UnsafePath(ValueError):
    """The path leaves its base folder or goes through a symlink."""


def parts(rel_path: str | os.PathLike) -> list[str]:
    """The components of a relative path; leading slashes and '.' are dropped."""
    names = []
    for name in str(rel_path).replace("\\", "/").split("/"):
        if name in ("", "."):
            continue
        if name == ".." or "\0" in name:
            raise UnsafePath("Invalid path")
        names.append(name)
    return names


def is_inside(base: str | os.PathLike, target: str | os.PathLike) -> bool:
    """Whether target's real path is base's real path or below it."""
    real_base = os.path.realpath(base)
    real_target = os.path.realpath(target)
    try:
        return os.path.commonpath([real_base, real_target]) == real_base
    except ValueError:  # different drives
        return False


def join(base: str | os.PathLike, rel_path: str | os.PathLike = "", allow_link: bool = False) -> Path:
    """base/rel_path after checking that no existing component is a symlink.
    With allow_link the last one may be (to delete it, not to follow it).

    Components that don't exist yet are fine (an upload may create them).
    For a snapshot check only; opening goes through open_file()/open_dir().
    """
    base = Path(base)
    names = parts(rel_path)
    current = base
    final_link = False
    for i, name in enumerate(names):
        current = current / name
        try:
            mode = os.lstat(current).st_mode
        except (FileNotFoundError, NotADirectoryError):
            break  # nothing further exists, so nothing further is a link
        if stat.S_ISLNK(mode):
            if not (allow_link and i == len(names) - 1):
                raise UnsafePath("Symlinks can't be used here")
            final_link = True
    target = base.joinpath(*names)
    if not is_inside(base, target.parent if final_link else target):
        raise UnsafePath("Invalid path")
    return target


def relative(base: str | os.PathLike, path: str | os.PathLike) -> str:
    """path as a relative path below base (lexically; '..' is refused)."""
    try:
        rel = Path(os.path.normpath(path)).relative_to(os.path.normpath(base))
    except ValueError as exc:
        raise UnsafePath("Invalid path") from exc
    return "/".join(parts(rel))


def _open_dir(dir_fd: int | None, name: str | os.PathLike) -> int:
    try:
        return os.open(name, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=dir_fd)
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.ENOTDIR):
            raise UnsafePath("Symlinks can't be used here") from exc
        raise


def open_dir(base: str | os.PathLike, names: list[str], create: bool = False) -> int:
    """A file descriptor for base/names..., one component at a time without following links."""
    if create:
        os.makedirs(base, exist_ok=True)
    fd = os.open(base, os.O_RDONLY | _DIRECTORY)  # the base folder itself is ours
    try:
        for name in names:
            try:
                next_fd = _open_dir(fd, name)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(name, 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
                next_fd = _open_dir(fd, name)
            os.close(fd)
            fd = next_fd
    except BaseException:
        os.close(fd)
        raise
    return fd


def open_dir_close(base: str | os.PathLike, names: list[str], create: bool = False) -> None:
    """Make sure base/names... is a real folder (create=True makes it)."""
    os.close(open_dir(base, names, create=create))


def open_file(base: str | os.PathLike, rel_path: str | os.PathLike, mode: str = "rb",
              make_dirs: bool = False) -> BinaryIO:
    """Open a regular file below base. mode is "rb", "wb" (truncate in place,
    so the file keeps its owner and permissions) or "xb". Raises UnsafePath
    for links, devices and FIFOs, FileNotFoundError when it's missing."""
    names = parts(rel_path)
    if not names:
        raise UnsafePath("Invalid path")
    if mode == "rb":
        flags = os.O_RDONLY
    elif mode == "wb":
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    elif mode == "xb":
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    else:
        raise ValueError(f"unsupported mode {mode!r}")

    dir_fd = open_dir(base, names[:-1], create=make_dirs)
    try:
        fd = os.open(names[-1], flags | _NOFOLLOW | _NONBLOCK, 0o644, dir_fd=dir_fd)
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise UnsafePath("Symlinks can't be used here") from exc
        raise
    finally:
        os.close(dir_fd)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        raise UnsafePath("Not a regular file")
    if _NONBLOCK:
        os.set_blocking(fd, True)
    return os.fdopen(fd, mode)


def lstat(base: str | os.PathLike, rel_path: str | os.PathLike = "") -> os.stat_result:
    """lstat of base/rel_path, refusing links on the way (the last one is reported, not followed)."""
    names = parts(rel_path)
    if not names:
        return os.stat(base)
    dir_fd = open_dir(base, names[:-1])
    try:
        return os.stat(names[-1], dir_fd=dir_fd, follow_symlinks=False)
    finally:
        os.close(dir_fd)


def is_file(base: str | os.PathLike, rel_path: str | os.PathLike) -> bool:
    """A regular file (not a link to one)."""
    try:
        return stat.S_ISREG(lstat(base, rel_path).st_mode)
    except (OSError, UnsafePath):
        return False


def read_bytes(base: str | os.PathLike, rel_path: str | os.PathLike) -> bytes:
    with open_file(base, rel_path) as fh:
        return fh.read()


def read_text(base: str | os.PathLike, rel_path: str | os.PathLike, errors: str = "strict") -> str:
    return read_bytes(base, rel_path).decode("utf-8", errors=errors)


def write_bytes(base: str | os.PathLike, rel_path: str | os.PathLike, data: bytes) -> None:
    """Write in place, creating missing folders."""
    with open_file(base, rel_path, "wb", make_dirs=True) as fh:
        fh.write(data)


def write_text(base: str | os.PathLike, rel_path: str | os.PathLike, text: str) -> None:
    write_bytes(base, rel_path, text.encode("utf-8"))


def replace_bytes(base: str | os.PathLike, rel_path: str | os.PathLike, data: bytes) -> None:
    """Write next to the file and rename over it. The temporary name is created
    with O_EXCL, and a rename replaces a link instead of writing through it."""
    names = parts(rel_path)
    if not names:
        raise UnsafePath("Invalid path")
    tmp_name = f"{names[-1]}.{os.getpid()}.{os.urandom(4).hex()}.tmp"
    tmp_rel = "/".join(names[:-1] + [tmp_name])
    with open_file(base, tmp_rel, "xb", make_dirs=True) as fh:
        fh.write(data)
    dir_fd = open_dir(base, names[:-1])
    try:
        os.replace(tmp_name, names[-1], src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    except OSError:
        os.unlink(tmp_name, dir_fd=dir_fd)
        raise
    finally:
        os.close(dir_fd)


def walk_files(base: str | os.PathLike) -> Iterator[str]:
    """Relative paths of all regular files below base. Links (to files or
    folders) are skipped, linked folders are never entered."""
    base = os.fspath(base)
    for root, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        rel_root = os.path.relpath(root, base)
        for name in files:
            try:
                regular = stat.S_ISREG(os.lstat(os.path.join(root, name)).st_mode)
            except FileNotFoundError:
                continue  # removed while walking
            if regular:
                yield name if rel_root == "." else f"{rel_root}/{name}".replace(os.sep, "/")


def walk_dirs(base: str | os.PathLike) -> Iterator[str]:
    """Relative paths of all real folders below base (empty ones included)."""
    base = os.fspath(base)
    for root, dirs, _files in os.walk(base, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        rel_root = os.path.relpath(root, base)
        for name in dirs:
            yield name if rel_root == "." else f"{rel_root}/{name}".replace(os.sep, "/")


def tree_size(base: str | os.PathLike) -> int:
    return sum(lstat(base, rel).st_size for rel in walk_files(base))


def zip_tree(base: str | os.PathLike, zf: zipfile.ZipFile) -> None:
    """Add every regular file below base to zf; links are left out."""
    for rel in walk_files(base):
        try:
            src = open_file(base, rel)
        except (UnsafePath, FileNotFoundError):
            continue  # became a link (or vanished) since the walk
        with src:
            st = os.fstat(src.fileno())
            # zip can't store times before 1980
            info = zipfile.ZipInfo(rel, date_time=max(time.localtime(st.st_mtime)[:6], (1980, 1, 1, 0, 0, 0)))
            info.external_attr = (stat.S_IFREG | (st.st_mode & 0o777)) << 16
            info.compress_type = zf.compression
            with zf.open(info, "w", force_zip64=True) as dst:
                while chunk := src.read(_COPY_CHUNK):
                    dst.write(chunk)


def copy_tree(src: str | os.PathLike, dst: str | os.PathLike) -> None:
    """Copy the folders and regular files of src into dst (which must not exist
    yet), keeping permissions and times. Links are left out."""
    os.makedirs(dst)
    for rel in walk_dirs(src):
        open_dir_close(dst, parts(rel), create=True)
    for rel in walk_files(src):
        try:
            fin = open_file(src, rel)
        except (UnsafePath, FileNotFoundError):
            continue
        with fin, open_file(dst, rel, "xb", make_dirs=True) as fout:
            while chunk := fin.read(_COPY_CHUNK):
                fout.write(chunk)
            st = os.fstat(fin.fileno())
            os.chmod(fout.fileno(), st.st_mode & 0o777)  # copies are root's: no setuid/setgid
            fout.flush()
            os.utime(fout.fileno(), ns=(st.st_atime_ns, st.st_mtime_ns))


def _zip_entry_names(info: zipfile.ZipInfo) -> list[str]:
    name = info.filename
    if name.startswith(("/", "\\")) or (len(name) > 1 and name[1] == ":"):
        raise UnsafePath(f"Refusing archive entry {name!r}")
    try:
        return parts(name)
    except UnsafePath as exc:  # '..'
        raise UnsafePath(f"Refusing archive entry {name!r}") from exc


def check_zip(archive: str | os.PathLike) -> None:
    """Raise UnsafePath if any entry would land outside the folder it's unpacked into (zip-slip)."""
    with zipfile.ZipFile(archive, "r") as zf:
        for info in zf.infolist():
            _zip_entry_names(info)


def extract_zip(archive: str | os.PathLike, dest: str | os.PathLike) -> None:
    """Unpack archive into dest. Archives with entries that would land outside
    dest ('..', absolute paths) are refused before anything is written;
    symlink entries and anything that isn't a file or folder are skipped."""
    check_zip(archive)
    with zipfile.ZipFile(archive, "r") as zf:
        for info in zf.infolist():
            names = _zip_entry_names(info)
            if not names:
                continue
            kind = stat.S_IFMT(info.external_attr >> 16)
            if info.is_dir():
                open_dir_close(dest, names, create=True)
            elif kind in (0, stat.S_IFREG):  # 0: written by a tool without Unix modes
                with zf.open(info) as src, open_file(dest, "/".join(names), "wb", make_dirs=True) as out:
                    while chunk := src.read(_COPY_CHUNK):
                        out.write(chunk)
                    mode = (info.external_attr >> 16) & 0o777  # no setuid/setgid on root's files
                    if mode:
                        os.chmod(out.fileno(), mode)
            # symlinks, devices, FIFOs: skipped
