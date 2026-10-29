"""How a server shows up in the players' server list: its description and icon.

Java keeps the description in server.properties as ``motd`` (up to two
lines, § formatting codes allowed) and the icon in ``server-icon.png``, a
64x64 PNG next to it. Bedrock only has a one-line ``server-name`` and no
icon. Both are read when the server starts.
"""

import re
import struct
from pathlib import Path

from docker_manager import BEDROCK_TYPES, server_data_dir
from logger import get_logger

log = get_logger("appearance_manager")

ICON_NAME = "server-icon.png"
ICON_SIZE = 64
MAX_ICON_BYTES = 1024 * 1024
MAX_DESCRIPTION_LENGTH = 200
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _data_dir(server_id: int) -> Path:
    return Path(server_data_dir(server_id))


def _description_key(server_type: str) -> str:
    return "server-name" if server_type in BEDROCK_TYPES else "motd"


# Java reads server.properties as a .properties file: newlines and backslashes
# are escaped, and anything outside ASCII is safest as \uXXXX (§ is §).
def _escape(value: str) -> str:
    out = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ord(ch) < 0x20 or ord(ch) > 0x7E:
            # characters past \uFFFF (emoji) become a UTF-16 surrogate pair
            units = ch.encode("utf-16-be")
            for i in range(0, len(units), 2):
                out.append(f"\\u{int.from_bytes(units[i:i + 2], 'big'):04X}")
        else:
            out.append(ch)
    return "".join(out)


_ESCAPE_RE = re.compile(r"\\(u[0-9a-fA-F]{4}|.)")


def _unescape(value: str) -> str:
    def replace(match: re.Match) -> str:
        code = match.group(1)
        if code.startswith("u") and len(code) == 5:
            return chr(int(code[1:], 16))
        return {"n": "\n", "t": "\t", "r": "\r"}.get(code, code)

    # join surrogate pairs back into one character
    return _ESCAPE_RE.sub(replace, value).encode("utf-16", "surrogatepass").decode("utf-16")


def _read_raw(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        if name.strip() == key:
            return value.lstrip()
    return None


def _write_raw(path: Path, key: str, value: str) -> None:
    """Set one key, keeping the rest of the file (and its order) as is. The
    file is created when the server hasn't started yet; Minecraft fills in
    everything else on its first start."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines() if path.exists() else []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.partition("=")[0].strip() == key:
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def icon_version(server_id: int) -> int | None:
    """Changes whenever the icon does (None without one), so clients know
    when to fetch it again."""
    try:
        return (_data_dir(server_id) / ICON_NAME).stat().st_mtime_ns // 1_000_000
    except OSError:
        return None


def get_appearance(server_id: int, server_type: str) -> dict:
    bedrock = server_type in BEDROCK_TYPES
    raw = _read_raw(_data_dir(server_id) / "server.properties", _description_key(server_type))
    if raw is None:
        description = ""
    else:
        description = raw if bedrock else _unescape(raw)
    return {
        "description": description,
        "multiline": not bedrock,
        "icon_supported": not bedrock,
        "icon_version": None if bedrock else icon_version(server_id),
        "max_length": MAX_DESCRIPTION_LENGTH,
    }


def set_description(server_id: int, server_type: str, description: str) -> tuple[bool, str]:
    description = description.replace("\r\n", "\n").replace("\r", "\n")
    if server_type in BEDROCK_TYPES:
        if "\n" in description:
            return False, "Bedrock server names are a single line"
        value = description.strip()
        if not value:
            return False, "The server name can't be empty"
    else:
        lines = description.split("\n")
        if len(lines) > 2:
            return False, "The description can have at most two lines"
        value = _escape("\n".join(line.rstrip() for line in lines))
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return False, f"The description can be at most {MAX_DESCRIPTION_LENGTH} characters"

    _write_raw(_data_dir(server_id) / "server.properties", _description_key(server_type), value)
    log.info("Description updated: server_id=%d", server_id)
    return True, "Description saved"


def icon_path(server_id: int) -> Path | None:
    path = _data_dir(server_id) / ICON_NAME
    return path if path.is_file() else None


def set_icon(server_id: int, data: bytes) -> tuple[bool, str]:
    """Minecraft only shows a 64x64 PNG, so anything else is refused here;
    the web UI scales the picture down before uploading it."""
    if len(data) > MAX_ICON_BYTES:
        return False, "The image is too large"
    # the IHDR chunk comes right after the signature and holds the size
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        return False, "The icon must be a PNG image"
    width, height = struct.unpack(">II", data[16:24])
    if (width, height) != (ICON_SIZE, ICON_SIZE):
        return False, f"The icon must be {ICON_SIZE}x{ICON_SIZE} pixels (got {width}x{height})"

    path = _data_dir(server_id) / ICON_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".png.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    log.info("Server icon updated: server_id=%d", server_id)
    return True, "Icon saved"


def remove_icon(server_id: int) -> None:
    path = _data_dir(server_id) / ICON_NAME
    path.unlink(missing_ok=True)
    log.info("Server icon removed: server_id=%d", server_id)
