"""
End-to-End Integration Tests for the Autonomous Harness Loop.
Demonstrates the full autonomous cycle:
1. Receives task.
2. Agent makes code change.
3. Harness independently runs validation.
4. Failed validation produces actionable feedback.
5. Agent receives feedback and fixes implementation.
6. Harness independently re-validates and passes.
7. Complete execution history is preserved.
8. Enforces iteration limits when task cannot be solved.
"""

import tempfile
import unittest
from pathlib import Path

from harness.config import HarnessConfig, BudgetConfig
from harness.agent import MockScriptedAgentAdapter, AgentAction
from harness.orchestrator import Orchestrator
from harness.state import TaskStatus, IterationStatus


class TestAutonomousHarnessLoop(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp_dir.name).resolve()
        self.state_dir = self.workspace / ".harness_state"

        # Set up a target validation test file in the workspace
        self.test_file = self.workspace / "test_fen_utils.py"
        self.test_file.write_text(
            """import unittest
from chess_utils import count_fen_rank

class TestFENUtils(unittest.TestCase):
    def test_full_pieces(self):
        self.assertEqual(count_fen_rank("rnbqkbnr"), 8)

    def test_all_empty(self):
        self.assertEqual(count_fen_rank("8"), 8)

    def test_mixed(self):
        self.assertEqual(count_fen_rank("4p3"), 8)

if __name__ == "__main__":
    unittest.main()
""",
            encoding="utf-8"
        )

    def tearDown(self):
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_full_autonomous_cycle_fail_then_fix(self):
        """Validates that a failed iteration produces feedback and the agent fixes it on next iteration."""
        config = HarnessConfig(
            task_id="autonomous_fix_task",
            objective="Implement count_fen_rank(rank_str) in chess_utils.py to count 8 squares per rank.",
            workspace_root=self.workspace,
            state_dir=self.state_dir,
            log_file=self.state_dir / "test_run.log",
            validation_commands=["python -m unittest test_fen_utils.py"],
            test_files_patterns=["test_*.py"],
            git_checkpointing=False,
            budget=BudgetConfig(max_iterations=5, command_timeout_seconds=10.0)
        )

        agent = MockScriptedAgentAdapter()

        # Step 1: Flawed implementation (fails for digit characters like "8" or "4p3")
        step1_code = """def count_fen_rank(rank_str: str) -> int:
    # Flawed: just counts character length without parsing digits
    return len(rank_str)
"""
        agent.add_step(AgentAction(
            plan="Initial draft: return length of rank string.",
            file_writes={"chess_utils.py": step1_code}
        ))

        # Step 2: Corrective implementation after receiving failure feedback
        step2_code = """def count_fen_rank(rank_str: str) -> int:
    count = 0
    for c in rank_str:
        if c.isdigit():
            count += int(c)
        else:
            count += 1
    return count
"""
        agent.add_step(AgentAction(
            plan="Fix according to feedback: expand digit numbers to their integer values.",
            file_writes={"chess_utils.py": step2_code}
        ))

        orchestrator = Orchestrator(config, agent)
        final_state = orchestrator.run()

        # 1. Task completed successfully
        self.assertEqual(final_state.status, TaskStatus.COMPLETED)

        # 2. Exactly 2 iterations occurred
        self.assertEqual(final_state.current_iteration, 2)
        self.assertEqual(len(final_state.iterations), 2)

        # 3. Iteration 1 failed validation independently
        it1 = final_state.iterations[0]
        self.assertEqual(it1.status, IterationStatus.VALIDATION_FAILED)
        self.assertTrue(len(it1.validation_runs) > 0)
        self.assertNotEqual(it1.validation_runs[0].exit_code, 0)
        self.assertIn("AssertionError", it1.feedback_generated)

        # 4. Agent received the feedback in Iteration 2
        it2 = final_state.iterations[1]
        self.assertIn("AssertionError", it2.feedback_received)
        self.assertEqual(it2.status, IterationStatus.SUCCESS)
        self.assertEqual(it2.validation_runs[0].exit_code, 0)

        # 5. Persistent state file was created and is valid
        state_path = self.state_dir / "autonomous_fix_task_state.json"
        self.assertTrue(state_path.exists())

    def test_iteration_limit_enforced_preventing_infinite_loop(self):
        """Validates that harness stops at max_iterations if validation never passes."""
        config = HarnessConfig(
            task_id="budget_exceeded_task",
            objective="An impossible objective that never passes tests.",
            workspace_root=self.workspace,
            state_dir=self.state_dir,
            log_file=self.state_dir / "budget_test.log",
            validation_commands=["python -m unittest test_fen_utils.py"],
            git_checkpointing=False,
            budget=BudgetConfig(max_iterations=3, command_timeout_seconds=5.0)
        )

        agent = MockScriptedAgentAdapter()
        # Keep writing invalid code
        broken_code = "def count_fen_rank(r): return 0\n"
        for i in range(5):
            agent.add_step(AgentAction(
                plan=f"Attempt {i+1} with same broken logic",
                file_writes={"chess_utils.py": broken_code}
            ))

        orchestrator = Orchestrator(config, agent)
        final_state = orchestrator.run()

        # Must hit BUDGET_EXCEEDED
        self.assertEqual(final_state.status, TaskStatus.BUDGET_EXCEEDED)
        self.assertEqual(final_state.current_iteration, 3)


if __name__ == "__main__":
    unittest.main()
