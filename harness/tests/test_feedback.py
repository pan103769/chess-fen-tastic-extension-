"""
Tests for FeedbackManager: error parsing and actionable feedback formatting.
"""

import unittest
from harness.evaluator import EvaluationResult
from harness.feedback import FeedbackManager
from harness.state import TaskState


class TestFeedbackManager(unittest.TestCase):

    def setUp(self):
        self.mgr = FeedbackManager()

    def test_parses_python_traceback(self):
        tb_output = """
Traceback (most recent call last):
  File "chess_logic.py", line 42, in parse_fen
    raise ValueError("Invalid rank count")
ValueError: Invalid rank count
"""
        issues = self.mgr.analyze_output(tb_output)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].file_path, "chess_logic.py")
        self.assertEqual(issues[0].line_number, 42)

    def test_parses_unittest_failure(self):
        output = """
======================================================================
FAIL: test_fen_validation (test_chess.TestChess)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "test_chess.py", line 15, in test_fen_validation
    self.assertTrue(False)
AssertionError: False is not true
"""
        issues = self.mgr.analyze_output(output)
        self.assertTrue(any(iss.category == "test_failure" for iss in issues))
        self.assertTrue(any(iss.category == "assertion_error" for iss in issues))

    def test_generates_actionable_feedback_with_repetition_warning(self):
        eval_res = EvaluationResult(
            passed=False,
            summary="1 test failed",
            failure_details=["AssertionError: expected 'rnbqkbnr' but got 'rnb' at board.py:20"]
        )
        state = TaskState(task_id="t1", objective="Fix board parser")

        feedback = self.mgr.generate_feedback(eval_res, state, repeated_approach=True)

        self.assertIn("### VALIDATION FEEDBACK ###", feedback)
        self.assertIn("CRITICAL WARNING", feedback)
        self.assertIn("repeated an identical code change", feedback)
        self.assertIn("board.py:20", feedback)
        self.assertIn("Action Required:", feedback)


if __name__ == "__main__":
    unittest.main()

