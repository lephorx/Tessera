"""User management routes (all require a login; every user has full access)."""

from flask import Blueprint, g, jsonify, request

import auth_manager
from auth_helpers import authorize
from logger import get_logger

log = get_logger("api")

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


# ---------------------------------------------------------------------------
# GET /api/users
# ---------------------------------------------------------------------------
@users_bp.route("", methods=["GET"])
def list_users():
    auth_err = authorize()
    if auth_err:
        return auth_err
    return jsonify({"users": auth_manager.list_users(), "current_user_id": g.current_user["id"]})


# ---------------------------------------------------------------------------
# POST /api/users         body: { "username": "...", "password": "..." }
#                         -> QR code; the new user scans it
# POST /api/users/verify  body: { "setup_token": "...", "otp": "123456" }
#                         -> creates the user
# ---------------------------------------------------------------------------
@users_bp.route("", methods=["POST"])
def add_user():
    auth_err = authorize()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    try:
        payload = auth_manager.begin_user_enrollment(str(body.get("username", "")), str(body.get("password", "")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 409
    return jsonify({"success": True, **payload}), 202


@users_bp.route("/verify", methods=["POST"])
def verify_user():
    auth_err = authorize()
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
    auth_err = authorize()
    if auth_err:
        return auth_err
    try:
        auth_manager.delete_user(user_id, g.current_user["id"])
    except LookupError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    log.info("User removed: id=%d by=%s", user_id, g.current_user["username"])
    return jsonify({"success": True})


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
