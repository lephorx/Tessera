"""User management. Admin-only, except changing your own password.

Admins see and manage every server, the users and the settings; other users
only their own servers (enforced centrally in app.py).
"""

from flask import Blueprint, g, jsonify, request

import auth_manager
from auth_helpers import authorize, require_admin
from db import get_db
from logger import get_logger

log = get_logger("api")

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


# ---------------------------------------------------------------------------
# GET /api/users
# ---------------------------------------------------------------------------
@users_bp.route("", methods=["GET"])
def list_users():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    with get_db() as conn:
        owned = dict(conn.execute(
            "SELECT owner_id, COUNT(*) FROM servers WHERE owner_id IS NOT NULL GROUP BY owner_id"
        ).fetchall())
    users = [{**u, "server_count": owned.get(u["id"], 0)} for u in auth_manager.list_users()]
    return jsonify({"users": users, "current_user_id": g.current_user["id"]})


# ---------------------------------------------------------------------------
# POST /api/users         body: { "username": "...", "password": "...", "is_admin": false }
#                         -> QR code; the new user scans it
# POST /api/users/verify  body: { "setup_token": "...", "otp": "123456" }
#                         -> creates the user
# ---------------------------------------------------------------------------
@users_bp.route("", methods=["POST"])
def add_user():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    try:
        payload = auth_manager.begin_user_enrollment(
            str(body.get("username", "")), str(body.get("password", "")), is_admin=bool(body.get("is_admin", False))
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 409
    return jsonify({"success": True, **payload}), 202


@users_bp.route("/verify", methods=["POST"])
def verify_user():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    try:
        user = auth_manager.complete_user_enrollment(str(body.get("setup_token", "")), str(body.get("otp", "")).strip())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 409
    log.info("User added: username=%s by=%s", user["username"], g.current_user["username"])
    return jsonify({"success": True, "user": user}), 201


# ---------------------------------------------------------------------------
# DELETE /api/users/<id>
# ---------------------------------------------------------------------------
@users_bp.route("/<int:user_id>", methods=["DELETE"])
def remove_user(user_id: int):
    auth_err = require_admin()
    if auth_err:
        return auth_err
    with get_db() as conn:
        owned = conn.execute("SELECT COUNT(*) FROM servers WHERE owner_id = ?", (user_id,)).fetchone()[0]
    if owned:
        return jsonify({
            "error": f"This user still owns {owned} server(s). Give them to someone else or delete them first."
        }), 409
    try:
        auth_manager.delete_user(user_id, g.current_user["id"])
    except LookupError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    log.info("User removed: id=%d by=%s", user_id, g.current_user["username"])
    return jsonify({"success": True})


# ---------------------------------------------------------------------------
# PATCH /api/users/<id>  body: { "is_admin": true }
# ---------------------------------------------------------------------------
@users_bp.route("/<int:user_id>", methods=["PATCH"])
def update_user(user_id: int):
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("is_admin"), bool):
        return jsonify({"error": "'is_admin' must be true or false"}), 400
    try:
        auth_manager.set_user_admin(user_id, body["is_admin"])
    except LookupError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    log.info("Admin rights changed: user_id=%d is_admin=%s by=%s", user_id, body["is_admin"], g.current_user["username"])
    return jsonify({"success": True, "user": auth_manager.get_user(user_id)})


# ---------------------------------------------------------------------------
# PUT /api/users/me/password  body: { "current_password": "...", "new_password": "..." }
# ---------------------------------------------------------------------------
@users_bp.route("/me/password", methods=["PUT"])
def change_password():
    auth_err = authorize()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    try:
        auth_manager.change_password(
            g.current_user["id"], str(body.get("current_password", "")), str(body.get("new_password", ""))
        )
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    log.info("Password changed: username=%s", g.current_user["username"])
    return jsonify({"success": True})
