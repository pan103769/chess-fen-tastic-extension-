"""
Tests for state tracking, persistence, and approach repetition detection.
"""

import tempfile
import unittest
from pathlib import Path

from harness.state import (
    TaskState,
    TaskStatus,
    IterationStatus,
    FileChangeRecord,
    CommandExecution
)


class TestStateManagement(unittest.TestCase):

    def test_state_lifecycle_and_persistence(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = Path(tmpdir) / "state.json"

            state = TaskState(task_id="task_001", objective="Add FEN validator test")
            self.assertEqual(state.status, TaskStatus.NOT_STARTED)

            # Start iteration 1
            it1 = state.start_new_iteration(plan="First try", feedback_received="")
            self.assertEqual(state.current_iteration, 1)
            self.assertEqual(it1.iteration_index, 1)

            # Add file change
            it1.file_changes.append(
                FileChangeRecord(file_path="utils.py", change_type="create", diff="+ def helper(): pass")
            )
            # Add command execution
            it1.validation_runs.append(
                CommandExecution(command="python -m unittest", exit_code=1, stdout="", stderr="Fail", duration_seconds=0.5)
            )

            state.finish_current_iteration(
                status=IterationStatus.VALIDATION_FAILED,
                feedback_generated="Fix the assertion"
            )

            # Save and reload
            state.save(state_file)
            self.assertTrue(state_file.exists())

            loaded = TaskState.load(state_file)
            self.assertEqual(loaded.task_id, "task_001")
            self.assertEqual(loaded.current_iteration, 1)
            self.assertEqual(len(loaded.iterations), 1)
            self.assertEqual(loaded.iterations[0].status, IterationStatus.VALIDATION_FAILED)
            self.assertEqual(len(loaded.iterations[0].file_changes), 1)
            self.assertEqual(loaded.iterations[0].file_changes[0].file_path, "utils.py")

    def test_repetition_detection(self):
        state = TaskState(task_id="task_rep", objective="Test repetition prevention")

        # Iteration 1: fails
        it1 = state.start_new_iteration(plan="Change A")
        it1.file_changes.append(FileChangeRecord(file_path="a.py", change_type="modify", diff="- old\n+ new"))
        hash1 = it1.compute_approach_hash()
        state.finish_current_iteration(status=IterationStatus.VALIDATION_FAILED)

        # Iteration 2 starts
        it2 = state.start_new_iteration(plan="Change A")
        it2.file_changes.append(FileChangeRecord(file_path="a.py", change_type="modify", diff="- old\n+ new"))
        hash2 = it2.compute_approach_hash()

        self.assertEqual(hash1, hash2)
        # Should detect repetition
        self.assertTrue(state.has_repeated_approach(hash2))

        # Distinct change should not be marked repeated
        it3 = state.start_new_iteration(plan="Change B")
        it3.file_changes.append(FileChangeRecord(file_path="a.py", change_type="modify", diff="- old\n+ different"))
        hash3 = it3.compute_approach_hash()
        self.assertFalse(state.has_repeated_approach(hash3))


if __name__ == "__main__":
    unittest.main()

