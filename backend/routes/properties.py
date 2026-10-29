"""server.properties viewer/editor routes."""

from flask import Blueprint, jsonify, request, send_file

import appearance_manager
import docker_manager
import properties_manager
from auth_helpers import authorize, require_admin
from db import get_db
from logger import get_logger

log = get_logger("api")

properties_bp = Blueprint("properties", __name__, url_prefix="/api")


def _server_exists(server_id: int) -> bool:
    with get_db() as conn:
        return conn.execute("SELECT 1 FROM servers WHERE id = ?", (server_id,)).fetchone() is not None


def _server_type(server_id: int) -> str | None:
    with get_db() as conn:
        row = conn.execute("SELECT type FROM servers WHERE id = ?", (server_id,)).fetchone()
    return row["type"] if row else None


@properties_bp.route("/defaults/properties", methods=["GET"])
def get_default_properties():
    auth_err = authorize()
    if auth_err:
        return auth_err
    return jsonify({"success": True, "properties": properties_manager.get_default_properties()}), 200


@properties_bp.route("/defaults/properties", methods=["PUT"])
def put_default_properties():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    changes = body.get("properties")
    if not isinstance(changes, dict):
        return jsonify({"success": False, "message": "'properties' must be an object"}), 400
    result = properties_manager.set_default_properties(changes)
    return jsonify({"success": True, **result}), 200


@properties_bp.route("/defaults/properties", methods=["PATCH"])
def patch_default_properties():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    changes = body.get("properties")
    if not isinstance(changes, dict) or not changes:
        return jsonify({"success": False, "message": "'properties' must be a non-empty object"}), 400
    result = properties_manager.patch_default_properties(changes)
    return jsonify({"success": True, **result}), 200


@properties_bp.route("/defaults/properties", methods=["DELETE"])
def remove_default_properties():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    keys = body.get("keys")
    if keys is not None and not isinstance(keys, list):
        return jsonify({"success": False, "message": "'keys' must be a list when provided"}), 400
    result = properties_manager.delete_default_properties(keys)
    return jsonify({"success": True, **result}), 200


@properties_bp.route("/servers/<int:server_id>/properties", methods=["GET"])
def get_properties(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    props = properties_manager.read_properties(server_id)
    return jsonify({"success": True, "properties": props}), 200


@properties_bp.route("/servers/<int:server_id>/properties", methods=["PATCH"])
def patch_properties(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404

    body = request.get_json(silent=True) or {}
    changes = body.get("properties")
    if not isinstance(changes, dict) or not changes:
        return jsonify({"success": False, "message": "'properties' must be a non-empty object"}), 400

    result = properties_manager.patch_properties(server_id, {str(k): str(v) for k, v in changes.items()})
    if result.get("error"):
        return jsonify({"success": False, "message": result["error"]}), 404
    return jsonify({"success": True, **result}), 200


# ---------------------------------------------------------------------------
# GET/PATCH /api/servers/<id>/bedrock/properties
#
# Separate from /api/servers/<id>/properties above (which is unchanged) since
# Bedrock's server.properties key set is almost entirely different from
# Java's — this validates keys/values against Bedrock's actual known property
# list instead of accepting anything.
# ---------------------------------------------------------------------------
@properties_bp.route("/servers/<int:server_id>/bedrock/properties", methods=["GET"])
def get_bedrock_properties(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    server_type = _server_type(server_id)
    if server_type is None:
        return jsonify({"success": False, "message": "Server not found"}), 404
    if server_type != "bedrock":
        return jsonify({"success": False, "message": "This endpoint is for 'bedrock' servers only"}), 400

    props = properties_manager.read_properties(server_id)
    return jsonify({"success": True, "properties": props}), 200


@properties_bp.route("/servers/<int:server_id>/bedrock/properties", methods=["PATCH"])
def patch_bedrock_properties(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    server_type = _server_type(server_id)
    if server_type is None:
        return jsonify({"success": False, "message": "Server not found"}), 404
    if server_type != "bedrock":
        return jsonify({"success": False, "message": "This endpoint is for 'bedrock' servers only"}), 400

    body = request.get_json(silent=True) or {}
    changes = body.get("properties")
    if not isinstance(changes, dict) or not changes:
        return jsonify({"success": False, "message": "'properties' must be a non-empty object"}), 400

    result = properties_manager.patch_bedrock_properties(server_id, changes)
    if result.get("error"):
        status = 404 if "server.properties not found" in result["error"] else 400
        return jsonify({"success": False, "message": result["error"], **result}), status
    return jsonify({"success": True, **result}), 200


# ---------------------------------------------------------------------------
# Appearance: the description and icon players see in their server list.
#
# GET    /api/servers/<id>/appearance
# PUT    /api/servers/<id>/description   Body: { "description": "..." }
# GET    /api/servers/<id>/icon          the 64x64 server-icon.png
# PUT    /api/servers/<id>/icon          multipart, field "icon"
# DELETE /api/servers/<id>/icon
# ---------------------------------------------------------------------------
def _appearance_saved(server_id: int, message: str):
    # read on startup, so a running server shows it after the next restart
    running = docker_manager.runtime_status(server_id) not in ("not_created", "stopped")
    return jsonify({"success": True, "message": message, "restart_required": running}), 200


@properties_bp.route("/servers/<int:server_id>/appearance", methods=["GET"])
def get_appearance(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    server_type = _server_type(server_id)
    if server_type is None:
        return jsonify({"success": False, "message": "Server not found"}), 404
    return jsonify({"success": True, **appearance_manager.get_appearance(server_id, server_type)}), 200


@properties_bp.route("/servers/<int:server_id>/description", methods=["PUT"])
def put_description(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    server_type = _server_type(server_id)
    if server_type is None:
        return jsonify({"success": False, "message": "Server not found"}), 404

    body = request.get_json(silent=True) or {}
    description = body.get("description")
    if not isinstance(description, str):
        return jsonify({"success": False, "message": "'description' must be a string"}), 400

    ok, message = appearance_manager.set_description(server_id, server_type, description)
    if not ok:
        return jsonify({"success": False, "message": message}), 400
    return _appearance_saved(server_id, message)


@properties_bp.route("/servers/<int:server_id>/icon", methods=["GET"])
def get_icon(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    path = appearance_manager.icon_path(server_id)
    if path is None:
        return jsonify({"success": False, "message": "This server has no icon"}), 404
    return send_file(path, mimetype="image/png", max_age=0)


@properties_bp.route("/servers/<int:server_id>/icon", methods=["PUT"])
def put_icon(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    server_type = _server_type(server_id)
    if server_type is None:
        return jsonify({"success": False, "message": "Server not found"}), 404
    if server_type in docker_manager.BEDROCK_TYPES:
        return jsonify({"success": False, "message": "Bedrock servers don't support icons"}), 400

    upload = request.files.get("icon")
    if upload is None:
        return jsonify({"success": False, "message": "No 'icon' file uploaded"}), 400
    ok, message = appearance_manager.set_icon(server_id, upload.read(appearance_manager.MAX_ICON_BYTES + 1))
    if not ok:
        return jsonify({"success": False, "message": message}), 400
    return _appearance_saved(server_id, message)


@properties_bp.route("/servers/<int:server_id>/icon", methods=["DELETE"])
def delete_icon(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404
    appearance_manager.remove_icon(server_id)
    return _appearance_saved(server_id, "Icon removed")
