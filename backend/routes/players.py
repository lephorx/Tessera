"""Player management routes: online list, whitelist, ops, bans, kick."""

from flask import Blueprint, g, jsonify, request

import player_lists
import player_manager
from auth_helpers import authorize
from db import get_db
from logger import get_logger

log = get_logger("api")

players_bp = Blueprint("players", __name__, url_prefix="/api")


def _server_exists(server_id: int) -> bool:
    with get_db() as conn:
        return conn.execute("SELECT 1 FROM servers WHERE id = ?", (server_id,)).fetchone() is not None


def _require_server(server_id: int):
    if not _server_exists(server_id):
        return jsonify({"success": False, "message": "Server not found"}), 404
    return None


def _require_username(body: dict):
    username = str(body.get("username", "")).strip()
    if not username:
        return None, (jsonify({"success": False, "message": "'username' is required"}), 400)
    return username, None


def _ban_on_other_servers(server_id: int, username: str, reason: str | None) -> None:
    """A ban on one server goes on the owner's global list and to their other servers."""
    owner_id = player_lists.owner_of(server_id)
    if owner_id is not None:
        player_lists.ban_everywhere(owner_id, username, reason, except_server=server_id)


# ---------------------------------------------------------------------------
# Default players and global bans of the signed-in user
# GET    /api/players/lists                       -> { whitelist, ops, bans }
# POST   /api/players/lists/<whitelist|ops>       body: { username }
# DELETE /api/players/lists/<whitelist|ops>/<name>
# POST   /api/players/lists/apply                 -> add the defaults to all servers
# POST   /api/players/bans                        body: { username, reason? }
# DELETE /api/players/bans/<name>                 -> off the list; servers stay banned
# ---------------------------------------------------------------------------
def _valid_name(name: str):
    if not player_lists.USERNAME_RE.fullmatch(name):
        return jsonify({"success": False,
                        "message": "Minecraft names are 3 to 16 letters, digits or underscores"}), 400
    return None


@players_bp.route("/players/lists", methods=["GET"])
def get_player_lists():
    auth_err = authorize()
    if auth_err:
        return auth_err
    return jsonify({"success": True, **player_lists.get_lists(g.current_user["id"])}), 200


@players_bp.route("/players/lists/<string:list_name>", methods=["POST"])
def add_default_player(list_name: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if list_name not in player_lists.LISTS:
        return jsonify({"success": False, "message": "Unknown list"}), 404
    username, err = _require_username(request.get_json(silent=True) or {})
    if err:
        return err
    err = _valid_name(username)
    if err:
        return err
    player_lists.add_default(g.current_user["id"], list_name, username)
    return jsonify({"success": True, **player_lists.get_lists(g.current_user["id"])}), 200


@players_bp.route("/players/lists/<string:list_name>/<string:username>", methods=["DELETE"])
def remove_default_player(list_name: str, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    if list_name not in player_lists.LISTS:
        return jsonify({"success": False, "message": "Unknown list"}), 404
    player_lists.remove_default(g.current_user["id"], list_name, username)
    return jsonify({"success": True, **player_lists.get_lists(g.current_user["id"])}), 200


@players_bp.route("/players/lists/apply", methods=["POST"])
def apply_default_players():
    auth_err = authorize()
    if auth_err:
        return auth_err
    report = player_lists.apply_defaults_to_all(g.current_user["id"])
    return jsonify({"success": True, "servers": report}), 200


@players_bp.route("/players/bans", methods=["POST"])
def add_global_ban():
    auth_err = authorize()
    if auth_err:
        return auth_err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    err = _valid_name(username)
    if err:
        return err
    reason = (body.get("reason") or "").strip() or None
    player_lists.ban_everywhere(g.current_user["id"], username, reason)
    return jsonify({"success": True, **player_lists.get_lists(g.current_user["id"])}), 200


@players_bp.route("/players/bans/<string:username>", methods=["DELETE"])
def remove_global_ban(username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    player_lists.remove_global_ban(g.current_user["id"], username)
    return jsonify({"success": True, **player_lists.get_lists(g.current_user["id"])}), 200


@players_bp.route("/servers/<int:server_id>/players", methods=["GET"])
def get_players(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    return jsonify({"success": True, **player_manager.get_players(server_id)}), 200


@players_bp.route("/servers/<int:server_id>/whitelist", methods=["POST"])
def whitelist_add(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    result = player_manager.whitelist_add(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/whitelist", methods=["DELETE"])
def whitelist_remove(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    result = player_manager.whitelist_remove(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/ops", methods=["POST"])
def op_add(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    result = player_manager.op_add(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/ops", methods=["DELETE"])
def op_remove(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    result = player_manager.op_remove(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/bans", methods=["GET"])
def get_bans(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    return jsonify({"success": True, "bans": player_manager.get_bans_detailed(server_id)}), 200


@players_bp.route("/servers/<int:server_id>/bans", methods=["POST"])
def ban_add(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    reason = body.get("reason")
    result = player_manager.ban_add(server_id, username, reason)
    if result["success"]:
        _ban_on_other_servers(server_id, username, reason)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/bans/<string:username>", methods=["DELETE"])
def ban_remove(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.ban_remove(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/kick", methods=["POST"])
def kick_player(server_id: int):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    username, err = _require_username(body)
    if err:
        return err
    reason = body.get("reason")
    result = player_manager.kick(server_id, username, reason)
    return jsonify(result), 200 if result["success"] else 409


# ── Player history ────────────────────────────────────────────────────────────

@players_bp.route("/servers/<int:server_id>/players/history", methods=["GET"])
def player_history(server_id: int):
    """All players who have ever joined (from usercache.json)."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    return jsonify({"success": True, "players": player_manager.get_player_history(server_id)}), 200


# ── Per-player NBT data ───────────────────────────────────────────────────────

@players_bp.route("/servers/<int:server_id>/players/<string:username>/data", methods=["GET"])
def get_player_data(server_id: int, username: str):
    """Health, food, XP, game mode, inventory, and ender chest from the player's .dat file."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.get_player_data(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/gamemode", methods=["POST"])
def set_player_gamemode(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    game_mode = body.get("game_mode")
    result = player_manager.set_player_gamemode(server_id, username, game_mode)
    return jsonify(result), 200 if result["success"] else 400


@players_bp.route("/servers/<int:server_id>/players/<string:username>/kill", methods=["POST"])
def kill_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    message = body.get("message")
    if message is not None and not isinstance(message, str):
        return jsonify({"success": False, "message": "'message' must be a string"}), 400
    result = player_manager.kill_player(server_id, username, message)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/heal", methods=["POST"])
def heal_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.heal_player(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/starve", methods=["POST"])
def starve_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.starve_player(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/feed", methods=["POST"])
def feed_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.feed_player(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/effects", methods=["POST"])
def add_player_effect(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    effect = body.get("effect")
    if not str(effect or "").strip():
        return jsonify({"success": False, "message": "'effect' is required"}), 400
    seconds = body.get("seconds", 30)
    amplifier = body.get("amplifier", 0)
    hide_particles = body.get("hide_particles", True)
    if not isinstance(seconds, int) or not isinstance(amplifier, int):
        return jsonify({"success": False, "message": "'seconds' and 'amplifier' must be integers"}), 400
    result = player_manager.add_player_effect(server_id, username, effect, seconds, amplifier, bool(hide_particles))
    return jsonify(result), 200 if result["success"] else (409 if "running" in result["message"].lower() else 400)


@players_bp.route("/servers/<int:server_id>/players/<string:username>/effects", methods=["DELETE"])
def clear_all_player_effects(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.clear_all_player_effects(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/effects/<string:effect_id>", methods=["DELETE"])
def clear_player_effect(server_id: int, username: str, effect_id: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.clear_player_effect(server_id, username, effect_id)
    return jsonify(result), 200 if result["success"] else (409 if "running" in result["message"].lower() else 400)


@players_bp.route("/servers/<int:server_id>/players/<string:username>/position", methods=["GET"])
def get_player_position(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.get_player_position(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/teleport", methods=["POST"])
def teleport_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        x = float(body.get("x"))
        y = float(body.get("y"))
        z = float(body.get("z"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Body must include numeric x, y, z"}), 400
    result = player_manager.teleport_player(server_id, username, x, y, z)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/whitelist", methods=["POST"])
def whitelist_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.whitelist_add(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/ban", methods=["POST"])
def ban_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    reason = body.get("reason")
    result = player_manager.ban_add(server_id, username, reason)
    if result["success"]:
        _ban_on_other_servers(server_id, username, reason)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/ban", methods=["DELETE"])
def unban_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.ban_remove(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/op", methods=["POST"])
def op_player(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.op_add(server_id, username)
    return jsonify(result), 200 if result["success"] else 409


@players_bp.route("/servers/<int:server_id>/players/<string:username>/statistics", methods=["GET"])
def player_statistics(server_id: int, username: str):
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.get_player_statistics(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/data", methods=["DELETE"])
def delete_player_data(server_id: int, username: str):
    """Selective reset/delete for player data files.

    Body supports either:
      - {"targets": ["xp", "inventory"]}
      - {"target": "everything"}
    """
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    targets = body.get("targets")
    if targets is None:
        single_target = body.get("target")
        targets = [single_target] if single_target is not None else []
    if not isinstance(targets, list):
        return jsonify({"success": False, "message": "'targets' must be a list or use 'target'"}), 400
    result = player_manager.delete_player_data(server_id, username, targets)
    return jsonify(result), 200 if result["success"] else 400


# ── Inventory endpoints ───────────────────────────────────────────────────────

@players_bp.route("/servers/<int:server_id>/players/<string:username>/inventory", methods=["DELETE"])
def clear_inventory(server_id: int, username: str):
    """Clear a player's entire inventory."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.clear_inventory(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/inventory/<int:slot>", methods=["DELETE"])
def remove_inventory_item(server_id: int, username: str, slot: int):
    """Remove the item at the given inventory slot."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.remove_inventory_item(server_id, username, slot)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/inventory", methods=["POST"])
def give_inventory_item(server_id: int, username: str):
    """Add an item to a player's inventory.

    Body: ``{"item_id": "minecraft:diamond", "count": 64, "slot": 0}``
    ``slot`` is optional — the first free slot (0-35) is used if omitted.
    """
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    item_id = str(body.get("item_id", "")).strip()
    if not item_id:
        return jsonify({"success": False, "message": "'item_id' is required"}), 400
    count = int(body.get("count", 1))
    slot = body.get("slot")
    if slot is not None:
        slot = int(slot)
    result = player_manager.give_inventory_item(server_id, username, item_id, count, slot)
    return jsonify(result), 200 if result["success"] else 400


# ── Ender chest endpoints ─────────────────────────────────────────────────────

@players_bp.route("/servers/<int:server_id>/players/<string:username>/enderchest", methods=["DELETE"])
def clear_enderchest(server_id: int, username: str):
    """Clear a player's entire ender chest."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.clear_enderchest(server_id, username)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/enderchest/<int:slot>", methods=["DELETE"])
def remove_enderchest_item(server_id: int, username: str, slot: int):
    """Remove the item at the given ender chest slot (0-26)."""
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    result = player_manager.remove_enderchest_item(server_id, username, slot)
    return jsonify(result), 200 if result["success"] else 404


@players_bp.route("/servers/<int:server_id>/players/<string:username>/enderchest", methods=["POST"])
def give_enderchest_item(server_id: int, username: str):
    """Add an item to a player's ender chest.

    Body: ``{"item_id": "minecraft:diamond", "count": 1, "slot": 0}``
    ``slot`` is optional — the first free slot (0-26) is used if omitted.
    """
    auth_err = authorize()
    if auth_err:
        return auth_err
    err = _require_server(server_id)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    item_id = str(body.get("item_id", "")).strip()
    if not item_id:
        return jsonify({"success": False, "message": "'item_id' is required"}), 400
    count = int(body.get("count", 1))
    slot = body.get("slot")
    if slot is not None:
        slot = int(slot)
    result = player_manager.give_enderchest_item(server_id, username, item_id, count, slot)
    return jsonify(result), 200 if result["success"] else 400
