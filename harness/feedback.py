"""
Feedback Manager: collects test failures, runtime errors, and formats actionable feedback.
"""

from dataclasses import dataclass, field
from typing import List, Optional
import re

from harness.evaluator import EvaluationResult
from harness.state import IterationRecord, TaskState


@dataclass
class DiagnosticIssue:
    """Parsed error or failure detail."""
    category: str  # "syntax_error", "assertion_error", "import_error", "test_tampering", "timeout", "general"
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    error_message: str = ""
    raw_snippet: str = ""


class FeedbackManager:
    """Analyzes test failures, tracebacks, and generates targeted, actionable feedback."""

    def __init__(self):
        self.traceback_pattern = re.compile(r'File "([^"]+)", line (\d+), in (\S+)')
        self.syntax_error_pattern = re.compile(r'SyntaxError: (.+)')
        self.assertion_pattern = re.compile(r'AssertionError:? ?(.*)')
        self.import_pattern = re.compile(r'(?:ModuleNotFoundError|ImportError): (.+)')
        self.failed_test_pattern = re.compile(r'FAIL: (\S+)')
        self.error_test_pattern = re.compile(r'ERROR: (\S+)')

    def analyze_output(self, text: str) -> List[DiagnosticIssue]:
        """Parses output text and extracts structured diagnostic issues."""
        issues: List[DiagnosticIssue] = []

        # Check for tracebacks
        tb_matches = list(self.traceback_pattern.finditer(text))
        if tb_matches:
            last_match = tb_matches[-1]
            file_path = last_match.group(1)
            line_no = int(last_match.group(2))

            # Look for following error lines
            end_pos = last_match.end()
            remaining = text[end_pos:end_pos + 400]
            err_line = remaining.strip().splitlines()[0] if remaining.strip() else ""

            cat = "general_error"
            if "AssertionError" in remaining:
                cat = "assertion_error"
            elif "ImportError" in remaining or "ModuleNotFoundError" in remaining:
                cat = "import_error"
            elif "TypeError" in remaining or "NameError" in remaining:
                cat = "runtime_error"

            issues.append(DiagnosticIssue(
                category=cat,
                file_path=file_path,
                line_number=line_no,
                error_message=err_line,
                raw_snippet=text[last_match.start():min(len(text), last_match.start() + 600)]
            ))

        # Check for SyntaxError
        syn = self.syntax_error_pattern.search(text)
        if syn:
            issues.append(DiagnosticIssue(
                category="syntax_error",
                error_message=f"SyntaxError: {syn.group(1)}",
                raw_snippet=syn.group(0)
            ))

        # Check for test failures
        for fail_match in self.failed_test_pattern.finditer(text):
            issues.append(DiagnosticIssue(
                category="test_failure",
                error_message=f"Test failed: {fail_match.group(1)}",
                raw_snippet=fail_match.group(0)
            ))

        for err_match in self.error_test_pattern.finditer(text):
            issues.append(DiagnosticIssue(
                category="test_error",
                error_message=f"Test errored: {err_match.group(1)}",
                raw_snippet=err_match.group(0)
            ))

        return issues

    def generate_feedback(
        self,
        eval_result: EvaluationResult,
        state: TaskState,
        repeated_approach: bool = False
    ) -> str:
        """Constructs rich, actionable feedback for the next iteration."""
        if eval_result.passed:
            return "All acceptance criteria and tests passed successfully."

        sections: List[str] = []
        sections.append("### VALIDATION FEEDBACK ###")
        sections.append(f"Status: FAILED")
        sections.append(f"Summary: {eval_result.summary}")

        if repeated_approach:
            sections.append(
                "\n[CRITICAL WARNING] You repeated an identical code change/plan that already failed in a previous iteration! "
                "Analyze why the approach failed and choose an alternative fix instead of repeating the same action."
            )

        if eval_result.tampered_test_files:
            sections.append("\n[SECURITY VIOLATION - TEST TAMPERING DETECTED]")
            sections.append("You modified or deleted protected test files:")
            for f in eval_result.tampered_test_files:
                sections.append(f"  - {f}")
            sections.append("RULE: Never modify or weaken tests merely to make them pass! Adjust implementation code only.")

        # Parse diagnostics from failures
        all_diagnostics: List[DiagnosticIssue] = []
        for failure in eval_result.failure_details:
            issues = self.analyze_output(failure)
            all_diagnostics.extend(issues)

        if all_diagnostics:
            sections.append("\nDiagnostic Issues Identified:")
            for idx, issue in enumerate(all_diagnostics, 1):
                loc = f" at {issue.file_path}:{issue.line_number}" if issue.file_path and issue.line_number else ""
                sections.append(f"{idx}. [{issue.category.upper()}]{loc}: {issue.error_message}")

        sections.append("\nDetailed Failure Outputs:")
        for idx, failure in enumerate(eval_result.failure_details, 1):
            sections.append(f"--- Command Output #{idx} ---\n{failure.strip()}\n")

        # History context
        previous_iterations = [it for it in state.iterations if it.status != "IN_PROGRESS"]
        if previous_iterations:
            sections.append("Previous Attempts Summary:")
            for it in previous_iterations[-3:]:
                sections.append(f"  Iteration #{it.iteration_index}: {it.status.value if hasattr(it.status, 'value') else it.status} (Plan: {it.plan[:80]}...)")

        sections.append("\nAction Required:")
        sections.append("1. Carefully inspect the errors and line locations above.")
        sections.append("2. Identify the root cause in the implementation logic.")
        sections.append("3. Formulate a specific corrective plan and apply modifications.")
        sections.append("4. Do not repeat failed assumptions.")

        return "\n".join(sections)

