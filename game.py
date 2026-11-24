"""Serverová herní logika pro Koulovanou.

Stav hry je autoritativní na serveru. Klienti jen posílají stisknuté klávesy,
úhel a sílu hodu a dostávají zpět snímek světa. Simulace se posouvá podle
reálného času při každém dotazu, takže není potřeba žádné extra vlákno.
"""

from __future__ import annotations

import math
import random
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

# Rozměry arény v pixelech (souřadnice y rostou dolů jako v canvasu).
WIDTH = 960
HEIGHT = 540
GROUND_Y = 470
PLAYER_W = 28
PLAYER_H = 56
CROUCH_H = 32
BALL_R = 8

GRAVITY = 620.0        # px/s^2 - koule	letí parabolou, ne rovně
JUMP_SPEED = 390.0     # px/s
WALK_SPEED = 190.0     # px/s
CROUCH_SPEED = 90.0    # px/s
MAX_SCORE = 5
TICK = 1.0 / 60.0
ROOM_TTL = 300.0       # místnosti bez aktivity se smažou


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def circle_hits_rect(cx: float, cy: float, r: float,
                     rx: float, ry: float, rw: float, rh: float) -> bool:
    """Kolize kruhu (koule) s obdélníkem (postavička)."""
    nx = clamp(cx, rx, rx + rw)
    ny = clamp(cy, ry, ry + rh)
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r


@dataclass
class Player:
    id: str
    name: str
    index: int
    x: float
    y: float = 0.0
    h: float = PLAYER_H
    vy: float = 0.0
    crouch: bool = False
    left: bool = False
    right: bool = False
    jump_queued: bool = False
    last_seen: float = field(default_factory=time.monotonic)

    def rect(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, PLAYER_W, self.h)

    def on_ground(self) -> bool:
        return self.y + self.h >= GROUND_Y - 0.01


@dataclass
class Ball:
    active: bool = False
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    age: float = 0.0
    bounces: int = 0
    owner: int = 0
    trail: list = field(default_factory=list)


def step_player(player: Player, dt: float) -> None:
    """Jeden fyzikální krok postavičky."""
    on_ground = player.on_ground()

    if player.jump_queued:
        if on_ground:
            player.vy = -JUMP_SPEED
            on_ground = False
        player.jump_queued = False

    crouched = player.crouch and on_ground
    target_h = CROUCH_H if crouched else PLAYER_H
    speed = CROUCH_SPEED if crouched else WALK_SPEED
    direction = (1 if player.right else 0) - (1 if player.left else 0)

    # Při změně výšky hitboxu držet nohy na zemi (jinak by postavička „visěla").
    if on_ground:
        player.y = GROUND_Y - target_h

    player.x = clamp(player.x + direction * speed * dt, 8.0, WIDTH - PLAYER_W - 8.0)
    player.vy += GRAVITY * dt
    player.y += player.vy * dt

    if player.y + target_h >= GROUND_Y:
        player.y = GROUND_Y - target_h
        player.vy = 0.0

    player.h = target_h


class Room:
    """Jeden zápas dvou hráčů."""

    def __init__(self, code: str):
        self.code = code
        self.players: list[Optional[Player]] = [None, None]
        self.scores = [0, 0]
        self.turn = 0
        self.phase = "aim"          # aim -> flight -> resolve -> aim
        self.status = "waiting"     # waiting | playing | finished
        self.winner: Optional[int] = None
        self.message = "Čekám na soupeře…"
        self.ball = Ball()
        self.resolve_timer = 0.0
        self.last_thrower = 0
        self.last_tick = time.monotonic()
        self.created_at = self.last_tick

    def reset(self) -> None:
        for i, player in enumerate(self.players):
            if player:
                player.x = 70.0 if i == 0 else float(WIDTH - PLAYER_W - 70)
                player.y = GROUND_Y - PLAYER_H
                player.h = PLAYER_H
                player.vy = 0.0
                player.crouch = False
                player.left = False
                player.right = False
                player.jump_queued = False
        self.scores = [0, 0]
        self.turn = 0
        self.phase = "aim"
        self.winner = None
        self.ball = Ball()
        self.resolve_timer = 0.0
        self.status = "playing" if self.players[0] and self.players[1] else "waiting"
        self.message = "Začíná hráč 1" if self.status == "playing" else "Čekám na soupeře…"

    def try_throw(self, player: Player, angle: float, power: float) -> bool:
        if self.status != "playing" or self.phase != "aim" or self.turn != player.index:
            return False
        if not math.isfinite(angle) or not math.isfinite(power):
            return False

        angle = clamp(angle, -math.pi, math.pi)
        power = clamp(power, 0.15, 1.0)
        speed = 170.0 + power * 560.0

        ball = self.ball
        ball.active = True
        ball.x = player.x + PLAYER_W / 2
        ball.y = player.y + player.h * 0.35
        ball.vx = math.cos(angle) * speed
        ball.vy = math.sin(angle) * speed
        ball.age = 0.0
        ball.bounces = 0
        ball.owner = player.index
        ball.trail = []

        self.phase = "flight"
        self.last_thrower = player.index
        self.message = f"{player.name} hází!"
        return True

    def advance(self, now: Optional[float] = None) -> None:
        """Posune simulaci o čas od posledního dotazu (max 250 ms najednou)."""
        now = time.monotonic() if now is None else now
        elapsed = clamp(now - self.last_tick, 0.0, 0.25)
        self.last_tick = now
        if elapsed < 0.001:
            return
        steps = max(1, math.ceil(elapsed / TICK))
        dt = elapsed / steps
        for _ in range(steps):
            self.step(dt)

    def step(self, dt: float) -> None:
        for player in self.players:
            if player:
                step_player(player, dt)

        if self.phase == "flight" and self.ball.active:
            self.step_ball(dt)
        elif self.phase == "resolve":
            self.resolve_timer -= dt
            if self.resolve_timer <= 0:
                self.finish_resolution()

    def step_ball(self, dt: float) -> None:
        ball = self.ball
        ball.vy += GRAVITY * dt
        ball.x += ball.vx * dt
        ball.y += ball.vy * dt
        ball.age += dt

        ball.trail.append((round(ball.x, 1), round(ball.y, 1)))
        if len(ball.trail) > 14:
            ball.trail.pop(0)

        target = self.players[1 - ball.owner]
        if target and ball.age > 0.04 and circle_hits_rect(ball.x, ball.y, BALL_R, *target.rect()):
            self.scores[ball.owner] += 1
            ball.active = False
            self.phase = "resolve"
            self.resolve_timer = 0.9
            self.message = f"Zásah! +1 pro {self.players[ball.owner].name}"
            return

        if ball.y + BALL_R >= GROUND_Y:
            ball.y = GROUND_Y - BALL_R
            if abs(ball.vy) > 80 and ball.bounces < 2:
                ball.vy = -ball.vy * 0.45
                ball.vx *= 0.72
                ball.bounces += 1
            else:
                self.miss()
                return

        if (ball.x < -BALL_R * 2 or ball.x > WIDTH + BALL_R * 2
                or ball.y > HEIGHT + BALL_R * 2 or ball.age > 7.0):
            self.miss()

    def miss(self) -> None:
        self.ball.active = False
        self.phase = "resolve"
        self.resolve_timer = 0.65
        self.message = "Mimo! Střídání hráčů."

    def finish_resolution(self) -> None:
        self.ball.active = False
        best = max(self.scores)
        if best >= MAX_SCORE:
            self.status = "finished"
            self.winner = self.scores.index(best)
            self.phase = "aim"
            self.message = f"Vítězí {self.players[self.winner].name}!"
            return
        self.turn = 1 - self.last_thrower
        self.phase = "aim"
        active = self.players[self.turn]
        self.message = f"Na řadě je {active.name if active else 'hráč'}"

    def snapshot(self, viewer_id: Optional[str] = None) -> dict:
        you = next((p.index for p in self.players if p and p.id == viewer_id), None)
        return {
            "room": self.code,
            "you": you,
            "status": self.status,
            "phase": self.phase,
            "turn": self.turn,
            "scores": list(self.scores),
            "winner": self.winner,
            "message": self.message,
            "players": [
                {
                    "name": p.name,
                    "index": p.index,
                    "x": round(p.x, 2),
                    "y": round(p.y, 2),
                    "h": round(p.h, 2),
                    "crouch": p.crouch,
                    "onGround": p.on_ground(),
                    "connected": True,
                } if p else None
                for p in self.players
            ],
            "ball": {
                "active": self.ball.active,
                "x": round(self.ball.x, 2),
                "y": round(self.ball.y, 2),
                "owner": self.ball.owner,
                "trail": self.ball.trail,
            },
            "config": {
                "width": WIDTH,
                "height": HEIGHT,
                "ground": GROUND_Y,
                "gravity": GRAVITY,
                "playerW": PLAYER_W,
                "playerH": PLAYER_H,
                "crouchH": CROUCH_H,
                "ballR": BALL_R,
                "maxScore": MAX_SCORE,
            },
        }


class World:
    """Správa místností. Všechny operace jsou pod zámkem."""

    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = threading.RLock()

    def new_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        while True:
            code = "".join(random.choice(alphabet) for _ in range(4))
            if code not in self.rooms:
                return code

    def cleanup(self) -> None:
        now = time.monotonic()
        for code, room in list(self.rooms.items()):
            if all(p is None or now - p.last_seen > ROOM_TTL for p in room.players):
                del self.rooms[code]

    def join(self, name: str, requested_code: Optional[str] = None):
        with self.lock:
            self.cleanup()
            code = requested_code.strip().upper() if requested_code else ""

            if code:
                room = self.rooms.get(code)
                if not room:
                    return None, None, "Místnost nenalezena."
                if room.players[0] and room.players[1]:
                    return None, None, "Místnost je už plná."
                slot = 0 if room.players[0] is None else 1
            else:
                room = None
                for candidate in self.rooms.values():
                    if candidate.status == "waiting" and candidate.players[0] and not candidate.players[1]:
                        room = candidate
                        slot = 1
                        break
                if room is None:
                    code = self.new_code()
                    room = Room(code)
                    self.rooms[code] = room
                    slot = 0

            player = Player(
                id=secrets.token_urlsafe(9),
                name=(name or "Hráč").strip()[:20] or "Hráč",
                index=slot,
                x=70.0 if slot == 0 else float(WIDTH - PLAYER_W - 70),
                y=GROUND_Y - PLAYER_H,
            )
            room.players[slot] = player
            room.last_tick = time.monotonic()
            if room.players[0] and room.players[1]:
                room.reset()  # nový pár = nový zápas
            else:
                room.status = "waiting"
                room.message = "Čekám na soupeře…"
            return room, player, None

    def find(self, code: str, player_id: str) -> Optional[Room]:
        with self.lock:
            room = self.rooms.get((code or "").upper())
            if not room:
                return None
            if not any(p and p.id == player_id for p in room.players):
                return None
            return room

    def state(self, code: str, player_id: str):
        with self.lock:
            room = self.find(code, player_id)
            if not room:
                return None
            room.advance()
            return room.snapshot(player_id)

    def apply(self, code: str, player_id: str, data: dict):
        with self.lock:
            room = self.find(code, player_id)
            if not room:
                return None
            player = next(p for p in room.players if p and p.id == player_id)

            player.left = bool(data.get("left"))
            player.right = bool(data.get("right"))
            player.crouch = bool(data.get("crouch"))
            player.last_seen = time.monotonic()
            if data.get("jump"):
                player.jump_queued = True

            if data.get("throw"):
                try:
                    angle = float(data.get("angle", 0.0))
                    power = float(data.get("power", 0.6))
                except (TypeError, ValueError):
                    angle, power = 0.0, 0.6
                room.try_throw(player, angle, power)

            room.advance()
            return room.snapshot(player_id)

    def reset(self, code: str, player_id: str):
        with self.lock:
            room = self.find(code, player_id)
            if not room:
                return None
            room.reset()
            return room.snapshot(player_id)

    def leave(self, code: str, player_id: str) -> bool:
        with self.lock:
            room = self.find(code, player_id)
            if not room:
                return False
            for i, player in enumerate(room.players):
                if player and player.id == player_id:
                    room.players[i] = None
                    break
            if not any(room.players):
                self.rooms.pop(room.code, None)
            else:
                room.reset()
            return True


WORLD = World()
