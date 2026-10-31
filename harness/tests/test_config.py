"""
Tests for harness configuration and serialization.
"""

import tempfile
import unittest
from pathlib import Path

from harness.config import HarnessConfig, BudgetConfig, SecurityConfig


class TestHarnessConfig(unittest.TestCase):

    def test_default_config(self):
        config = HarnessConfig()
        self.assertEqual(config.budget.max_iterations, 10)
        self.assertEqual(config.budget.command_timeout_seconds, 60.0)
        self.assertTrue(config.security.protect_test_files)
        self.assertTrue(config.security.sanitize_secrets)
        self.assertTrue(config.git_checkpointing)

    def test_serialization_and_deserialization(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg_path = Path(tmpdir) / "config.json"
            cfg = HarnessConfig(
                task_id="test_task_123",
                objective="Refactor FEN parsing",
                budget=BudgetConfig(max_iterations=5, command_timeout_seconds=30.0),
                security=SecurityConfig(require_approval_for_destructive=True)
            )
            cfg.save_json(cfg_path)
            self.assertTrue(cfg_path.exists())

            loaded = HarnessConfig.load_json(cfg_path)
            self.assertEqual(loaded.task_id, "test_task_123")
            self.assertEqual(loaded.objective, "Refactor FEN parsing")
            self.assertEqual(loaded.budget.max_iterations, 5)
            self.assertEqual(loaded.budget.command_timeout_seconds, 30.0)
            self.assertTrue(loaded.security.require_approval_for_destructive)


if __name__ == "__main__":
    unittest.main()

