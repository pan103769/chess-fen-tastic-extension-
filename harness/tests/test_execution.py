"""
Tests for ExecutionEnvironment: sandboxing, security, path traversal, and command timeouts.
"""

import tempfile
import unittest
from pathlib import Path

from harness.config import HarnessConfig, SecurityConfig, BudgetConfig
from harness.execution import ExecutionEnvironment, SecurityViolationError


class TestExecutionEnvironment(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp_dir.name).resolve()
        self.config = HarnessConfig(
            workspace_root=self.workspace,
            security=SecurityConfig(
                allowed_command_prefixes=["python", "echo"],
                blocked_patterns=[r"rmdir\s+/[sS]", r"format\s+"],
                protect_test_files=True,
                require_approval_for_destructive=True
            ),
            budget=BudgetConfig(command_timeout_seconds=2.0)
        )
        self.env = ExecutionEnvironment(self.config)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_path_traversal_blocked(self):
        with self.assertRaises(SecurityViolationError):
            self.env.read_file("../../secret.txt")

        with self.assertRaises(SecurityViolationError):
            self.env.write_file("../outside.txt", "evil")

    def test_disallowed_command_blocked(self):
        is_safe, reason = self.env.is_command_safe("powershell.exe -Command Get-Process")
        self.assertFalse(is_safe)
        self.assertIn("not in the allowed command prefixes", reason)

        with self.assertRaises(SecurityViolationError):
            self.env.execute_command("curl http://malicious.com")

    def test_destructive_command_pattern_blocked(self):
        is_safe, reason = self.env.is_command_safe("rmdir /s /q testdir")
        self.assertFalse(is_safe)
        self.assertIn("prohibited destructive pattern", reason)

    def test_protect_test_files_prevents_agent_modification(self):
        # Creating a test file as agent should be blocked
        with self.assertRaises(SecurityViolationError):
            self.env.write_file("test_something.py", "assert True", is_agent_action=True)

        with self.assertRaises(SecurityViolationError):
            self.env.write_file("tests/my_test.py", "assert True", is_agent_action=True)

    def test_safe_file_write_and_read(self):
        fc = self.env.write_file("src/calculator.py", "def add(a, b): return a + b\n")
        self.assertEqual(fc.file_path, "src/calculator.py")
        self.assertEqual(fc.change_type, "create")

        content = self.env.read_file("src/calculator.py")
        self.assertIn("def add", content)

    def test_command_execution_timeout(self):
        # Run a python command that sleeps longer than timeout
        res = self.env.execute_command("python -c \"import time; time.sleep(5)\"", timeout=1.0)
        self.assertEqual(res.exit_code, -1)
        self.assertIn("timed out", res.stderr)

    def test_approval_callback_for_destructive_action(self):
        calls = []

        def mock_approval(action_type, details):
            calls.append((action_type, details))
            return False  # Deny

        env_with_approval = ExecutionEnvironment(self.config, approval_callback=mock_approval)
        test_file = self.workspace / "temp.txt"
        test_file.write_text("sample", encoding="utf-8")

        with self.assertRaises(SecurityViolationError):
            env_with_approval.delete_file("temp.txt")

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "delete_file")


if __name__ == "__main__":
    unittest.main()

