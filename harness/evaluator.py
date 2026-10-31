"""
Independent evaluation and acceptance verification for the AI Coding Harness.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Optional
import hashlib

from harness.config import HarnessConfig
from harness.execution import ExecutionEnvironment
from harness.state import CommandExecution


@dataclass
class EvaluationResult:
    """Outcome of an independent evaluation cycle."""
    passed: bool
    summary: str
    command_executions: List[CommandExecution] = field(default_factory=list)
    tampered_test_files: List[str] = field(default_factory=list)
    failure_details: List[str] = field(default_factory=list)


class Evaluator:
    """Independently evaluates agent implementations against criteria and test suites."""

    def __init__(self, config: HarnessConfig, environment: ExecutionEnvironment):
        self.config = config
        self.env = environment
        self._test_file_snapshots: Dict[str, str] = {}
        self.snapshot_test_files()

    def snapshot_test_files(self) -> None:
        """Records initial checksums of all test files to ensure agent cannot tamper with or weaken tests."""
        self._test_file_snapshots.clear()
        for pattern in self.config.test_files_patterns:
            for path in self.config.workspace_root.glob(pattern):
                if path.is_file():
                    try:
                        content = path.read_bytes()
                        checksum = hashlib.sha256(content).hexdigest()
                        rel_path = str(path.relative_to(self.config.workspace_root))
                        self._test_file_snapshots[rel_path] = checksum
                    except Exception:
                        pass

    def check_test_integrity(self) -> List[str]:
        """Detects whether any protected test file was modified or weakened."""
        if not self.config.security.protect_test_files:
            return []

        tampered = []
        for rel_path, original_checksum in self._test_file_snapshots.items():
            full_path = self.config.workspace_root / rel_path
            if not full_path.exists():
                tampered.append(f"{rel_path} (deleted)")
                continue

            try:
                current_checksum = hashlib.sha256(full_path.read_bytes()).hexdigest()
                if current_checksum != original_checksum:
                    tampered.append(f"{rel_path} (modified)")
            except Exception as e:
                tampered.append(f"{rel_path} (read error: {e})")

        return tampered

    def evaluate(self) -> EvaluationResult:
        """Executes independent validation commands and verifies test integrity.

        Does not trust any agent claims or self-reports.
        """
        # Step 1: Verify test file integrity
        tampered_files = self.check_test_integrity()
        if tampered_files:
            summary = f"Evaluation FAILED: [TEST TAMPERING DETECTED] Protected test files were modified or weakened: {', '.join(tampered_files)}"
            return EvaluationResult(
                passed=False,
                summary=summary,
                tampered_test_files=tampered_files,
                failure_details=[summary]
            )

        # Step 2: Execute all configured validation commands independently
        executions: List[CommandExecution] = []
        failures: List[str] = []

        for cmd in self.config.validation_commands:
            exec_res = self.env.execute_command(cmd, is_validation=True)
            executions.append(exec_res)

            if exec_res.exit_code != 0:
                failure_msg = f"Command '{cmd}' failed with exit code {exec_res.exit_code}."
                if exec_res.stderr.strip():
                    failure_msg += f"\nStderr:\n{exec_res.stderr.strip()}"
                if exec_res.stdout.strip():
                    failure_msg += f"\nStdout:\n{exec_res.stdout.strip()}"
                failures.append(failure_msg)

        all_passed = (len(failures) == 0)
        summary = "All independent validation checks passed successfully." if all_passed else (
            f"Validation failed: {len(failures)} out of {len(self.config.validation_commands)} commands failed."
        )

        return EvaluationResult(
            passed=all_passed,
            summary=summary,
            command_executions=executions,
            failure_details=failures
        )
