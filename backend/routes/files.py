"""File management endpoints, operating directly on a server's data directory."""

import mimetypes
import shutil
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from auth_helpers import authorize
from db import get_db
from docker_manager import server_data_dir
from logger import get_logger

log = get_logger("api")

files_bp = Blueprint("files", __name__, url_prefix="/api")


def _server_exists(server_id: int) -> bool:
    with get_db() as conn:
        return conn.execute("SELECT 1 FROM servers WHERE id = ?", (server_id,)).fetchone() is not None


def _server_dir(server_id: int, rel_path: str = "") -> Path | None:
    """Resolve a path inside a server's data directory, guarding against traversal."""
    base = Path(server_data_dir(server_id)).resolve()
    rel_path = rel_path.lstrip("/")
    target = (base / rel_path).resolve() if rel_path else base
    if not str(target).startswith(str(base)):
        return None  # path traversal attempt
    return target


def _upload_destination(
    server_id: int,
    rel_path: str,
    original_filename: str,
    requested_filename: str | None = None,
) -> tuple[Path, Path] | tuple[None, None]:
    rel_path = rel_path.strip()
    filename = Path(requested_filename or original_filename).name
    if not rel_path:
        target_dir = _server_dir(server_id, "")
        return target_dir, target_dir / filename if target_dir else (None, None)

    target = _server_dir(server_id, rel_path)
    if target is None:
        return None, None

    if requested_filename:
        return target, target / filename

    if target.exists() and target.is_file():
        parent = Path(rel_path).parent
        parent_dir = _server_dir(server_id, str(parent) if str(parent) != "." else "")
        if parent_dir is None:
            return None, None
        return parent_dir, target

    return target, target / filename


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files?path=subdir/...
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files", methods=["GET"])
def list_files(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    rel_path = request.args.get("path", "")
    target = _server_dir(server_id, rel_path)
    if target is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    if not target.exists():
        return jsonify({"success": False, "message": "Path does not exist"}), 404
    if not target.is_dir():
        return jsonify({"success": False, "message": "Path is not a directory"}), 400

    entries = []
    for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name)):
        entries.append({
            "name": entry.name,
            "type": "file" if entry.is_file() else "directory",
            "size": entry.stat().st_size if entry.is_file() else None,
        })
    return jsonify({"success": True, "path": rel_path or "/", "entries": entries}), 200


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files/download?path=file.txt
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/download", methods=["GET"])
def download_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    rel_path = request.args.get("path", "")
    if not rel_path:
        return jsonify({"success": False, "message": "'path' query parameter is required"}), 400
    target = _server_dir(server_id, rel_path)
    if target is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    if not target.exists() or not target.is_file():
        return jsonify({"success": False, "message": "File not found"}), 404

    return send_file(target, as_attachment=True, download_name=target.name)


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files/raw?path=icon.png — the file inline, for previews
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/raw", methods=["GET"])
def raw_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    target, err = _existing_file(server_id)
    if err:
        return err
    mimetype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    if mimetype == "image/svg+xml":
        mimetype = "text/plain"  # never let an uploaded SVG run scripts
    response = send_file(target, mimetype=mimetype, as_attachment=False)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    return response


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files/content?path=server.properties
#     -> { content, editable, size }; editable is false for binary files
# PUT /api/servers/<id>/files/content?path=server.properties
#     body: { "content": "..." } — overwrites a text file (or creates it)
# ---------------------------------------------------------------------------
MAX_EDIT_BYTES = 2 * 1024 * 1024


def _existing_file(server_id: int):
    if not _server_exists(server_id):
        return None, (jsonify({"success": False, "message": "Server not found"}), 404)
    rel_path = request.args.get("path", "")
    if not rel_path:
        return None, (jsonify({"success": False, "message": "'path' query parameter is required"}), 400)
    target = _server_dir(server_id, rel_path)
    if target is None:
        return None, (jsonify({"success": False, "message": "Invalid path"}), 400)
    if not target.exists() or not target.is_file():
        return None, (jsonify({"success": False, "message": "File not found"}), 404)
    return target, None


def _read_text(target: Path) -> str | None:
    """The file as text, or None when it is binary or too big to edit."""
    if target.stat().st_size > MAX_EDIT_BYTES:
        return None
    data = target.read_bytes()
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


@files_bp.route("/servers/<int:server_id>/files/content", methods=["GET"])
def get_file_content(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    target, err = _existing_file(server_id)
    if err:
        return err
    content = _read_text(target)
    size = target.stat().st_size
    if content is None:
        reason = ("The file is larger than 2 MB." if size > MAX_EDIT_BYTES
                  else "This is not a text file.")
        return jsonify({"success": True, "editable": False, "size": size, "reason": reason}), 200
    return jsonify({"success": True, "editable": True, "size": size, "content": content}), 200


@files_bp.route("/servers/<int:server_id>/files/content", methods=["PUT"])
def put_file_content(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404
    body = request.get_json(silent=True) or {}
    content = body.get("content")
    if not isinstance(content, str):
        return jsonify({"success": False, "message": "'content' must be a string"}), 400
    data = content.encode("utf-8")
    if len(data) > MAX_EDIT_BYTES:
        return jsonify({"success": False, "message": "Files larger than 2 MB can't be edited here"}), 413

    rel_path = request.args.get("path", "")
    target = _server_dir(server_id, rel_path) if rel_path else None
    if target is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    if target.is_dir():
        return jsonify({"success": False, "message": "Path is a directory"}), 400
    if target.exists() and _read_text(target) is None:
        return jsonify({"success": False, "message": "Only text files can be edited"}), 400

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # write in place so the file keeps its owner and permissions
        with open(target, "wb") as fh:
            fh.write(data)
    except OSError as exc:
        log.warning("File save failed: server_id=%d path=%s error=%s", server_id, target, exc)
        return jsonify({"success": False, "message": f"Could not save the file: {exc}"}), 500

    log.info("File edited: server_id=%d path=%s", server_id, target)
    return jsonify({"success": True, "message": f"Saved {target.name}", "size": len(data)}), 200


# ---------------------------------------------------------------------------
# POST /api/servers/<id>/files/upload?path=subdir/...
# Body: multipart/form-data with field "file"
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/upload", methods=["POST"])
def upload_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file field in request"}), 400

    upload = request.files["file"]
    if not upload.filename:
        return jsonify({"success": False, "message": "Empty filename"}), 400

    # Sanitise filename — strip directory components
    filename = Path(upload.filename).name
    rel_path = request.args.get("path", "")
    requested_filename = request.args.get("filename", "").strip() or None
    target_dir, dest = _upload_destination(server_id, rel_path, filename, requested_filename)
    if target_dir is None or dest is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400

    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        upload.save(dest)
    except OSError as exc:
        log.warning("File upload failed: server_id=%d path=%s error=%s", server_id, dest, exc)
        return jsonify({"success": False, "message": f"Could not save upload: {exc}"}), 500

    log.info("File uploaded: server_id=%d path=%s", server_id, dest)
    return jsonify({"success": True, "message": f"Uploaded {filename}", "path": str(dest)}), 201


# ---------------------------------------------------------------------------
# DELETE /api/servers/<id>/files/delete?path=file.txt
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/delete", methods=["DELETE"])
def delete_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    rel_path = request.args.get("path", "")
    if not rel_path:
        return jsonify({"success": False, "message": "'path' query parameter is required"}), 400
    target = _server_dir(server_id, rel_path)
    if target is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    if not target.exists():
        return jsonify({"success": False, "message": "File not found"}), 404
    if target == _server_dir(server_id, ""):
        return jsonify({"success": False, "message": "The server folder itself can't be deleted"}), 400

    try:
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)  # a folder goes with everything in it
        else:
            target.unlink()
    except OSError as exc:
        log.warning("Delete failed: server_id=%d path=%s error=%s", server_id, target, exc)
        return jsonify({"success": False, "message": f"Could not delete {target.name}: {exc}"}), 500
    log.info("Deleted: server_id=%d path=%s", server_id, target)
    return jsonify({"success": True, "message": f"Deleted {target.name}"}), 200
