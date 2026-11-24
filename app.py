"""Webový server pro Koulovanou (Flask + gunicorn)."""

from flask import Flask, jsonify, render_template, request

from game import HEIGHT, WIDTH, WORLD

app = Flask(__name__)


def body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@app.get("/")
def index():
    return render_template("index.html", width=WIDTH, height=HEIGHT)


@app.get("/healthz")
def health():
    """Liveness/readiness probe pro Kubernetes."""
    return jsonify(status="ok")


@app.post("/api/join")
def join():
    data = body()
    name = str(data.get("name") or "Hráč").strip()[:20] or "Hráč"
    room, player, error = WORLD.join(name, data.get("room"))
    if error:
        return jsonify(error=error), 400
    return jsonify(
        room=room.code,
        playerId=player.id,
        side=player.index,
        state=room.snapshot(player.id),
    )


@app.post("/api/update")
def update():
    data = body()
    state = WORLD.apply(str(data.get("room") or ""), str(data.get("playerId") or ""), data)
    if state is None:
        return jsonify(error="Hra nebyla nalezena."), 404
    return jsonify(state)


@app.get("/api/state")
def state():
    snapshot = WORLD.state(
        str(request.args.get("room") or ""),
        str(request.args.get("playerId") or ""),
    )
    if snapshot is None:
        return jsonify(error="Hra nebyla nalezena."), 404
    return jsonify(snapshot)


@app.post("/api/newgame")
def newgame():
    data = body()
    snapshot = WORLD.reset(str(data.get("room") or ""), str(data.get("playerId") or ""))
    if snapshot is None:
        return jsonify(error="Hra nebyla nalezena."), 404
    return jsonify(snapshot)


@app.post("/api/leave")
def leave():
    data = body()
    if not WORLD.leave(str(data.get("room") or ""), str(data.get("playerId") or "")):
        return jsonify(error="Hra nebyla nalezena."), 404
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)
