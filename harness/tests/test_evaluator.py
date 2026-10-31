"""
Tests for Evaluator: independent validation and test tampering detection.
"""

import tempfile
import unittest
from pathlib import Path

from harness.config import HarnessConfig
from harness.execution import ExecutionEnvironment
from harness.evaluator import Evaluator


class TestEvaluator(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp_dir.name).resolve()

        # Create a sample test file
        self.test_file = self.workspace / "test_sample.py"
        self.test_file.write_text("import unittest\nclass T(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n", encoding="utf-8")

        self.config = HarnessConfig(
            workspace_root=self.workspace,
            validation_commands=[f"python -m unittest test_sample.py"],
            test_files_patterns=["test_*.py"]
        )
        self.env = ExecutionEnvironment(self.config)
        self.evaluator = Evaluator(self.config, self.env)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_evaluation_passes_when_tests_succeed(self):
        result = self.evaluator.evaluate()
        self.assertTrue(result.passed)
        self.assertEqual(len(result.failure_details), 0)

    def test_evaluation_fails_when_command_fails(self):
        self.config.validation_commands = ["python -c \"import sys; sys.exit(1)\""]
        result = self.evaluator.evaluate()
        self.assertFalse(result.passed)
        self.assertEqual(len(result.failure_details), 1)
        self.assertIn("exit code 1", result.failure_details[0])

    def test_evaluation_detects_test_tampering(self):
        # Tamper with the test file directly
        self.test_file.write_text("modified weakened content", encoding="utf-8")

        tampered = self.evaluator.check_test_integrity()
        self.assertEqual(len(tampered), 1)
        self.assertIn("test_sample.py (modified)", tampered[0])

        result = self.evaluator.evaluate()
        self.assertFalse(result.passed)
        self.assertEqual(len(result.tampered_test_files), 1)
        self.assertIn("TEST TAMPERING", result.summary.upper())


if __name__ == "__main__":
    unittest.main()

