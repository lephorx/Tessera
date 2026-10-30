"""Tessera Cloud link (Settings → Cloud). Admin-only, and only on this machine:
the connector refuses these routes when they come through the cloud."""

import requests
from flask import Blueprint, g, jsonify, request

import cloud_connector
from auth_helpers import require_admin
from logger import get_logger

log = get_logger("api")

cloud_bp = Blueprint("cloud", __name__, url_prefix="/api/cloud")


# ---------------------------------------------------------------------------
# GET /api/cloud — link state, connection, pairing code in progress
# ---------------------------------------------------------------------------
@cloud_bp.route("", methods=["GET"])
def cloud_status():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    return jsonify(cloud_connector.connector().status())


# ---------------------------------------------------------------------------
# POST /api/cloud/pair — body: { "cloud_url": "https://..." } → a pairing code
# ---------------------------------------------------------------------------
@cloud_bp.route("/pair", methods=["POST"])
def cloud_pair():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    cloud_url = str(body.get("cloud_url") or cloud_connector.DEFAULT_CLOUD_URL).strip()
    try:
        status = cloud_connector.connector().start_pairing(cloud_url, g.current_user["id"])
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"success": False, "message": str(exc)}), 409
    except requests.RequestException as exc:
        log.warning("Pairing request failed: %s", exc)
        return jsonify({"success": False, "message": f"Can't reach {cloud_url}."}), 502
    return jsonify(status)


# ---------------------------------------------------------------------------
# POST /api/cloud/pair/cancel
# ---------------------------------------------------------------------------
@cloud_bp.route("/pair/cancel", methods=["POST"])
def cloud_pair_cancel():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    cloud_connector.connector().cancel_pairing()
    return jsonify(cloud_connector.connector().status())


# ---------------------------------------------------------------------------
# DELETE /api/cloud — disconnect and forget the credential
# ---------------------------------------------------------------------------
@cloud_bp.route("", methods=["DELETE"])
def cloud_unlink():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    cloud_connector.connector().unlink()
    log.info("Cloud link removed by %s", g.current_user["username"])
    return jsonify(cloud_connector.connector().status())


# ---------------------------------------------------------------------------
# PUT /api/cloud/settings — body: { "allow_remote_admin": bool }
# ---------------------------------------------------------------------------
@cloud_bp.route("/settings", methods=["PUT"])
def cloud_settings():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("allow_remote_admin"), bool):
        return jsonify({"success": False, "message": "'allow_remote_admin' must be true or false"}), 400
    cloud_connector.set_remote_admin_allowed(body["allow_remote_admin"])
    return jsonify(cloud_connector.connector().status())


# ---------------------------------------------------------------------------
# GET /api/cloud/audit — the last requests that came through the cloud
# ---------------------------------------------------------------------------
@cloud_bp.route("/audit", methods=["GET"])
def cloud_audit():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    return jsonify({"entries": cloud_connector.audit_entries()})
