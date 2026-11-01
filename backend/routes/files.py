"""File management endpoints, operating directly on a server's data directory.

The folder is shared with the Minecraft container, so everything goes through
safe_paths: no '..', and no symlink is ever followed (a plugin could link
`x -> /app/data/cscm.db`).
"""

import mimetypes
import os
import shutil
import stat
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

import safe_paths
from auth_helpers import authorize
from db import get_db
from docker_manager import server_data_dir
from logger import get_logger
from safe_paths import UnsafePath

log = get_logger("api")

files_bp = Blueprint("files", __name__, url_prefix="/api")


def _server_exists(server_id: int) -> bool:
    with get_db() as conn:
        return conn.execute("SELECT 1 FROM servers WHERE id = ?", (server_id,)).fetchone() is not None


def _base(server_id: int) -> Path:
    return Path(server_data_dir(server_id))


def _rel(server_id: int, rel_path: str = "", allow_link: bool = False) -> str | None:
    """rel_path cleaned up ("" for the server folder), or None when it leaves
    the folder or goes through a symlink (allow_link: the last part may be one)."""
    try:
        safe_paths.join(_base(server_id), rel_path, allow_link=allow_link)
        return "/".join(safe_paths.parts(rel_path))
    except UnsafePath:
        return None


def _lstat(server_id: int, rel: str) -> os.stat_result | None:
    """The entry itself (a link is reported, not followed); None when missing."""
    try:
        return safe_paths.lstat(_base(server_id), rel)
    except (FileNotFoundError, NotADirectoryError):
        return None


def _upload_destination(
    server_id: int,
    rel_path: str,
    original_filename: str,
    requested_filename: str | None = None,
) -> str | None:
    """Where an upload goes, relative to the server folder (None if invalid)."""
    filename = Path(requested_filename or original_filename).name
    if not filename or filename in (".", ".."):
        return None
    target = _rel(server_id, rel_path.strip())
    if target is None:
        return None
    if not target:
        return filename
    if requested_filename:
        return f"{target}/{filename}"

    # uploading onto an existing file replaces it
    st = _lstat(server_id, target)
    if st is not None and stat.S_ISREG(st.st_mode):
        return target
    return f"{target}/{filename}"


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
    rel = _rel(server_id, rel_path)
    if rel is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    st = _lstat(server_id, rel)
    if st is None:
        return jsonify({"success": False, "message": "Path does not exist"}), 404
    if not stat.S_ISDIR(st.st_mode):
        return jsonify({"success": False, "message": "Path is not a directory"}), 400

    entries = []
    try:
        dir_fd = safe_paths.open_dir(_base(server_id), safe_paths.parts(rel))
    except (UnsafePath, FileNotFoundError):
        return jsonify({"success": False, "message": "Invalid path"}), 400
    try:
        with os.scandir(dir_fd) as it:
            for entry in it:
                # links are listed as links (they can be deleted), never followed
                if entry.is_symlink():
                    kind, size = "link", None
                elif entry.is_dir(follow_symlinks=False):
                    kind, size = "directory", None
                else:
                    kind, size = "file", entry.stat(follow_symlinks=False).st_size
                entries.append({"name": entry.name, "type": kind, "size": size})
    finally:
        os.close(dir_fd)
    entries.sort(key=lambda e: (e["type"] != "directory", e["name"]))
    return jsonify({"success": True, "path": rel_path or "/", "entries": entries}), 200


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files/download?path=file.txt
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/download", methods=["GET"])
def download_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    fh, name, err = _existing_file(server_id)
    if err:
        return err
    return send_file(fh, as_attachment=True, download_name=name)


# ---------------------------------------------------------------------------
# GET /api/servers/<id>/files/raw?path=icon.png — the file inline, for previews
# ---------------------------------------------------------------------------
@files_bp.route("/servers/<int:server_id>/files/raw", methods=["GET"])
def raw_file(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    fh, name, err = _existing_file(server_id)
    if err:
        return err
    mimetype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if mimetype == "image/svg+xml":
        mimetype = "text/plain"  # never let an uploaded SVG run scripts
    response = send_file(fh, mimetype=mimetype, as_attachment=False)
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
    """The file at ?path=, opened for reading without following links:
    (file, name, None) or (None, None, error)."""
    if not _server_exists(server_id):
        return None, None, (jsonify({"success": False, "message": "Server not found"}), 404)
    rel_path = request.args.get("path", "")
    if not rel_path:
        return None, None, (jsonify({"success": False, "message": "'path' query parameter is required"}), 400)
    rel = _rel(server_id, rel_path)
    if not rel:
        return None, None, (jsonify({"success": False, "message": "Invalid path"}), 400)
    try:
        fh = safe_paths.open_file(_base(server_id), rel)
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError, UnsafePath):
        # a link, folder or device counts as "no such file"
        return None, None, (jsonify({"success": False, "message": "File not found"}), 404)
    return fh, rel.rsplit("/", 1)[-1], None


def _read_text(fh) -> str | None:
    """The open file as text, or None when it is binary or too big to edit."""
    if os.fstat(fh.fileno()).st_size > MAX_EDIT_BYTES:
        return None
    fh.seek(0)
    data = fh.read()
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
    fh, name, err = _existing_file(server_id)
    if err:
        return err
    with fh:
        content = _read_text(fh)
        size = os.fstat(fh.fileno()).st_size
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

    rel = _rel(server_id, request.args.get("path", ""))
    if not rel:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    base = _base(server_id)
    target = base / rel
    st = _lstat(server_id, rel)
    if st is not None:
        if stat.S_ISDIR(st.st_mode):
            return jsonify({"success": False, "message": "Path is a directory"}), 400
        if not stat.S_ISREG(st.st_mode):
            return jsonify({"success": False, "message": "Only regular files can be edited"}), 400
        try:
            with safe_paths.open_file(base, rel) as existing:
                editable = _read_text(existing) is not None
        except (OSError, UnsafePath):
            editable = False
        if not editable:
            return jsonify({"success": False, "message": "Only text files can be edited"}), 400

    try:
        # written in place so the file keeps its owner and permissions
        safe_paths.write_bytes(base, rel, data)
    except UnsafePath:
        return jsonify({"success": False, "message": "Invalid path"}), 400
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
    rel_dest = _upload_destination(server_id, rel_path, filename, requested_filename)
    if rel_dest is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    dest = _base(server_id) / rel_dest

    try:
        with safe_paths.open_file(_base(server_id), rel_dest, "wb", make_dirs=True) as fh:
            upload.save(fh)
    except (UnsafePath, IsADirectoryError):
        return jsonify({"success": False, "message": "Invalid path"}), 400
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
    rel = _rel(server_id, rel_path, allow_link=True)  # a link is deleted, never followed
    if rel is None:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    if not rel:
        return jsonify({"success": False, "message": "The server folder itself can't be deleted"}), 400
    st = _lstat(server_id, rel)
    if st is None:
        return jsonify({"success": False, "message": "File not found"}), 404
    target = _base(server_id) / rel

    names = safe_paths.parts(rel)
    try:
        parent_fd = safe_paths.open_dir(_base(server_id), names[:-1])
    except UnsafePath:
        return jsonify({"success": False, "message": "Invalid path"}), 400
    try:
        if stat.S_ISDIR(st.st_mode):
            shutil.rmtree(names[-1], dir_fd=parent_fd)  # a folder goes with everything in it
        else:
            os.unlink(names[-1], dir_fd=parent_fd)  # a link goes, not what it points to
    except OSError as exc:
        log.warning("Delete failed: server_id=%d path=%s error=%s", server_id, target, exc)
        return jsonify({"success": False, "message": f"Could not delete {target.name}: {exc}"}), 500
    finally:
        os.close(parent_fd)
    log.info("Deleted: server_id=%d path=%s", server_id, target)
    return jsonify({"success": True, "message": f"Deleted {target.name}"}), 200
