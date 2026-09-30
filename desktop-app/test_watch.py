"""Unit tests for watch.py's pure pieces. No Windows, screen or network.

Run from this folder:  python -m unittest test_watch
"""

import unittest

import watch


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class ControlTests(unittest.TestCase):
    def test_only_mya_allows_input(self):
        self.assertTrue(watch.may_issue_input("mya"))
        for v in ("user", "paused", None, "", "MYA", "shared"):
            self.assertFalse(watch.may_issue_input(v), v)

    def test_autonomous_input_needs_a_fresh_mya_answer(self):
        clock = FakeClock()
        gate = watch.ControlGate(clock)
        self.assertFalse(gate.allows_autonomous_input())  # never heard from the server
        gate.update("mya")
        self.assertTrue(gate.allows_autonomous_input())
        clock.t += watch.GATE_MAX_AGE_S + 0.1
        self.assertFalse(gate.allows_autonomous_input())  # stale: fail safe

    def test_confirmed_actions_blocked_when_owner_paused_or_took_control(self):
        gate = watch.ControlGate(FakeClock())
        self.assertTrue(gate.allows_confirmed_action())  # Watch Mya never answered: legacy flow unchanged
        for c in ("user", "paused"):
            gate.update(c)
            self.assertFalse(gate.allows_confirmed_action(), c)
            self.assertIn("not touching", gate.blocked_reason())
        gate.update("mya")
        self.assertTrue(gate.allows_confirmed_action())

    def test_yield_is_local_and_immediate(self):
        gate = watch.ControlGate(FakeClock())
        gate.update("mya")
        gate.yield_to_user()
        self.assertEqual(gate.control, "user")
        self.assertFalse(gate.allows_autonomous_input())

    def test_unknown_control_values_are_not_trusted(self):
        gate = watch.ControlGate(FakeClock())
        gate.update("root")
        self.assertIsNone(gate.control)
        self.assertFalse(gate.allows_autonomous_input())


class TakeoverTests(unittest.TestCase):
    def test_user_moved(self):
        self.assertFalse(watch.user_moved((100, 100), (103, 102)))
        self.assertTrue(watch.user_moved((100, 100), (140, 100)))
        self.assertFalse(watch.user_moved(None, (1, 1)))


class ReportTests(unittest.TestCase):
    def test_report_only_ever_yields(self):
        body = watch.build_report({"task": "t", "app": "Chrome", "control": "mya", "secret": "x"}, yield_control=True)
        self.assertEqual(body["control"], "user")
        self.assertNotIn("secret", body)
        self.assertNotIn("control", watch.build_report({"task": "t"}))

    def test_events_capped(self):
        body = watch.build_report({}, events=[{"kind": "step", "text": "x"}] * 50)
        self.assertEqual(len(body["events"]), 20)

    def test_watch_is_opt_in(self):
        self.assertFalse(watch.watch_enabled({}))
        self.assertTrue(watch.watch_enabled({"MYA_WATCH": "on"}))
        self.assertFalse(watch.watch_enabled({"MYA_WATCH": "off"}))


if __name__ == "__main__":
    unittest.main()
