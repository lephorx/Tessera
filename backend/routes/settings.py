"""Connection settings and first-run setup routes (admin-only, except reading the setup state)."""

import os

from flask import Blueprint, jsonify, request

import server_manager
import settings_manager
from cloudflare_manager import cloudflare_enabled, verify_zone
from auth_helpers import authorize, require_admin
from logger import get_logger

log = get_logger("api")

settings_bp = Blueprint("settings", __name__, url_prefix="/api")

CF_KEYS = ("CLOUDFLARE_ENABLED", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_BASE_DOMAIN")
CF_FIELDS = {"CLOUDFLARE_API_TOKEN": "API token", "CLOUDFLARE_ZONE_ID": "zone ID", "CLOUDFLARE_BASE_DOMAIN": "base domain"}


def _check_cloudflare(values: dict) -> str | None:
    """Refuse Cloudflare settings that are incomplete or don't fit together."""
    current = {k: os.getenv(k, "") for k in CF_KEYS}
    final = {k: (values[k] if values.get(k) is not None else current[k]).strip() for k in CF_KEYS}
    if final["CLOUDFLARE_ENABLED"].lower() in {"false", "0", "no", "off"}:
        return None
    missing = [label for key, label in CF_FIELDS.items() if not final[key]]
    if len(missing) == len(CF_FIELDS):
        return None  # Cloudflare isn't used
    if missing:
        return f"Enter the Cloudflare {' and '.join(missing)} too, or turn the custom domain off."
    if current["CLOUDFLARE_BASE_DOMAIN"] and final["CLOUDFLARE_BASE_DOMAIN"] != current["CLOUDFLARE_BASE_DOMAIN"] \
            and values.get("CLOUDFLARE_ZONE_ID") is None:
        return "A new domain needs its zone ID."
    if final == current:
        return None
    return verify_zone(final["CLOUDFLARE_API_TOKEN"], final["CLOUDFLARE_ZONE_ID"], final["CLOUDFLARE_BASE_DOMAIN"])


def _cloudflare_target() -> tuple[bool, str, str]:
    """Whether Cloudflare is used, and with which zone and domain."""
    return cloudflare_enabled(), os.getenv("CLOUDFLARE_ZONE_ID", ""), os.getenv("CLOUDFLARE_BASE_DOMAIN", "")


# ---------------------------------------------------------------------------
# GET /api/settings  — current values; secrets are only reported as set/unset
# PUT /api/settings  — body: { "values": { "PLAYIT_EMAIL": "...", ... } }
#                      null or missing = unchanged, "" = clear
# ---------------------------------------------------------------------------
@settings_bp.route("/settings", methods=["GET"])
def get_settings():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    return jsonify({**settings_manager.public_view(), "setup": settings_manager.setup_state()})


@settings_bp.route("/settings", methods=["PUT"])
def put_settings():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    values = body.get("values") or {}
    if not isinstance(values, dict) or not all(isinstance(v, (str, type(None))) for v in values.values()):
        return jsonify({"success": False, "message": "'values' must map keys to strings"}), 400
    unknown = sorted(set(values) - set(settings_manager.EDITABLE_KEYS))
    if unknown:
        return jsonify({"success": False, "message": f"Unknown settings: {', '.join(unknown)}"}), 400
    problem = _check_cloudflare(values)
    if problem:
        return jsonify({"success": False, "message": problem}), 400
    if server_manager.dns_sync_status()["running"] and any(values.get(k) is not None for k in CF_KEYS):
        return jsonify({"success": False, "message": "DNS records are still being moved. Try again in a moment."}), 409

    old = {k: os.getenv(k, "") for k in CF_KEYS}
    before = _cloudflare_target()
    try:
        settings_manager.save(values)
    except (RuntimeError, ValueError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 409

    # a new domain or zone, or Cloudflare turned on or off: move every
    # server's records over
    dns_sync = False
    after = _cloudflare_target()
    if (before[0] or after[0]) and before != after:
        server_manager.start_dns_resync(old)
        dns_sync = True
    return jsonify({
        "success": True,
        **settings_manager.public_view(),
        "setup": settings_manager.setup_state(),
        "dns_sync": dns_sync,
    })


# ---------------------------------------------------------------------------
# GET /api/settings/dns-sync — progress of moving the DNS records
# ---------------------------------------------------------------------------
@settings_bp.route("/settings/dns-sync", methods=["GET"])
def get_dns_sync():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    return jsonify(server_manager.dns_sync_status())


# ---------------------------------------------------------------------------
# POST   /api/settings/agent — start the Playit agent with the saved SECRET_KEY
# DELETE /api/settings/agent — remove it
# ---------------------------------------------------------------------------
@settings_bp.route("/settings/agent", methods=["POST"])
def start_agent():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    try:
        settings_manager.start_agent()
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        log.exception("Could not start the Playit agent")
        return jsonify({"success": False, "message": f"Could not start the Playit agent: {exc}"}), 500
    return jsonify({"success": True, "agent": settings_manager.agent_status()})


@settings_bp.route("/settings/agent", methods=["DELETE"])
def stop_agent():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    settings_manager.stop_agent()
    return jsonify({"success": True, "agent": settings_manager.agent_status()})


# ---------------------------------------------------------------------------
# GET /api/setup — wizard progress
# PUT /api/setup — body: { "step"?: "...", "mode"?: "public"|"local", "completed"?: bool }
# ---------------------------------------------------------------------------
@settings_bp.route("/setup", methods=["GET"])
def get_setup():
    auth_err = authorize()
    if auth_err:
        return auth_err
    return jsonify(settings_manager.setup_state())


@settings_bp.route("/setup", methods=["PUT"])
def put_setup():
    auth_err = require_admin()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    state = settings_manager.update_setup(
        step=body.get("step"),
        mode=body.get("mode"),
        completed=body.get("completed"),
    )
    return jsonify(state)
