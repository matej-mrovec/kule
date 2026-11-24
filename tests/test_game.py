"""Rychlé testy fyziky a pravidel: python -m unittest discover -s tests"""

import math
import unittest

from game import (
    BALL_R, GROUND_Y, GRAVITY, PLAYER_H, Ball, Player, Room,
    circle_hits_rect, step_player,
)


class PhysicsTests(unittest.TestCase):
    def test_circle_rect_collision(self):
        self.assertTrue(circle_hits_rect(10, 10, 5, 8, 8, 10, 10))
        self.assertFalse(circle_hits_rect(10, 10, 2, 30, 30, 10, 10))

    def test_ball_falls_parabolically(self):
        ball = Ball(active=True, x=0, y=0, vx=100, vy=0)
        half_y = 0.0
        for step in range(1, 61):
            ball.vy += GRAVITY / 60
            ball.x += ball.vx / 60
            ball.y += ball.vy / 60
            if step == 30:
                half_y = ball.y
        self.assertAlmostEqual(ball.x, 100, places=1)
        self.assertAlmostEqual(ball.y / half_y, 4.0, delta=0.2)  # y ~ t^2

    def test_throw_is_not_a_straight_line(self):
        room = Room('TEST')
        for i, x in enumerate((70, 800)):
            room.players[i] = Player(id=str(i), name=f'P{i}', index=i, x=x, y=GROUND_Y - PLAYER_H)
        room.status = 'playing'
        room.turn = 0
        self.assertTrue(room.try_throw(room.players[0], angle=0.0, power=1.0))
        y0 = room.ball.y
        for _ in range(12):  # 0,2 s – ještě před dopadem na zem
            room.step_ball(1 / 60)
        self.assertGreater(room.ball.y - y0, 8)  # gravitace kouli stáhne dolů

    def test_crouch_lowers_hitbox(self):
        p = Player(id='p', name='P', index=0, x=100, y=GROUND_Y - PLAYER_H)
        step_player(p, 1 / 60)
        standing = p.h
        p.crouch = True
        step_player(p, 1 / 60)
        self.assertLess(p.h, standing)
        self.assertAlmostEqual(p.y + p.h, GROUND_Y, places=1)

    def test_jump_lifts_player_and_lands(self):
        p = Player(id='p', name='P', index=0, x=100, y=GROUND_Y - PLAYER_H)
        start = p.y
        p.jump_queued = True
        for _ in range(12):
            step_player(p, 1 / 60)
        self.assertLess(p.y, start - 20)
        for _ in range(180):
            step_player(p, 1 / 60)
        self.assertAlmostEqual(p.y + p.h, GROUND_Y, places=1)

    def test_hit_scores_point_and_switches_turn(self):
        room = Room('TEST')
        room.players[0] = Player(id='a', name='A', index=0, x=70, y=GROUND_Y - PLAYER_H)
        room.players[1] = Player(id='b', name='B', index=1, x=140, y=GROUND_Y - PLAYER_H)
        room.status = 'playing'
        room.turn = 0
        room.try_throw(room.players[0], angle=0.0, power=1.0)
        for _ in range(60):
            room.step(1 / 60)
        self.assertEqual(room.scores, [1, 0])
        for _ in range(60):
            room.step(1 / 60)
        self.assertEqual(room.phase, 'aim')
        self.assertEqual(room.turn, 1)


if __name__ == '__main__':
    unittest.main()
