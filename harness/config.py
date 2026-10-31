"""
Configuration definitions for the AI Coding Harness.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional
import json


@dataclass
class BudgetConfig:
    """Resource limits and cost controls."""
    max_iterations: int = 10
    max_execution_time_seconds: float = 600.0
    command_timeout_seconds: float = 60.0
    max_llm_calls: int = 20
    max_cost_usd: float = 5.0


@dataclass
class SecurityConfig:
    """Security boundaries and command restrictions."""
    allowed_command_prefixes: List[str] = field(default_factory=lambda: [
        "python", "python.exe",
        "git",
        "echo", "dir", "type", "cat", "ls",
        "mkdir", "md",
    ])
    blocked_patterns: List[str] = field(default_factory=lambda: [
        r"rmdir\s+/[sS]",
        r"del\s+/[fF]?[sS]?[qQ]?\s+[cC]:",
        r"rm\s+-rf\s+/",
        r"format\s+",
        r"mkfs",
        r"dd\s+if=",
        r"shutdown",
        r":\(\)\{",  # fork bomb
    ])
    require_approval_for_destructive: bool = True
    protect_test_files: bool = True
    sanitize_secrets: bool = True


@dataclass
class HarnessConfig:
    """Master configuration for an autonomous harness execution."""
    task_id: str = "default_task"
    objective: str = ""
    workspace_root: Path = field(default_factory=lambda: Path(".").resolve())
    state_dir: Path = field(default_factory=lambda: Path(".harness_state").resolve())
    log_file: Optional[Path] = field(default_factory=lambda: Path(".harness_state/harness.log").resolve())
    validation_commands: List[str] = field(default_factory=lambda: [
        'python -m unittest discover -s harness/tests -p "test_*.py"'
    ])
    test_files_patterns: List[str] = field(default_factory=lambda: [
        "test_*.py", "*_test.py", "tests/**/*.py"
    ])
    git_checkpointing: bool = True
    budget: BudgetConfig = field(default_factory=BudgetConfig)
    security: SecurityConfig = field(default_factory=SecurityConfig)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "objective": self.objective,
            "workspace_root": str(self.workspace_root),
            "state_dir": str(self.state_dir),
            "log_file": str(self.log_file) if self.log_file else None,
            "validation_commands": self.validation_commands,
            "test_files_patterns": self.test_files_patterns,
            "git_checkpointing": self.git_checkpointing,
            "budget": {
                "max_iterations": self.budget.max_iterations,
                "max_execution_time_seconds": self.budget.max_execution_time_seconds,
                "command_timeout_seconds": self.budget.command_timeout_seconds,
                "max_llm_calls": self.budget.max_llm_calls,
                "max_cost_usd": self.budget.max_cost_usd,
            },
            "security": {
                "allowed_command_prefixes": self.security.allowed_command_prefixes,
                "blocked_patterns": self.security.blocked_patterns,
                "require_approval_for_destructive": self.security.require_approval_for_destructive,
                "protect_test_files": self.security.protect_test_files,
                "sanitize_secrets": self.security.sanitize_secrets,
            }
        }

    @classmethod
    def from_dict(cls, data: dict) -> "HarnessConfig":
        budget_data = data.get("budget", {})
        security_data = data.get("security", {})
        return cls(
            task_id=data.get("task_id", "default_task"),
            objective=data.get("objective", ""),
            workspace_root=Path(data.get("workspace_root", ".")).resolve(),
            state_dir=Path(data.get("state_dir", ".harness_state")).resolve(),
            log_file=Path(data["log_file"]).resolve() if data.get("log_file") else None,
            validation_commands=data.get("validation_commands", []),
            test_files_patterns=data.get("test_files_patterns", ["test_*.py"]),
            git_checkpointing=data.get("git_checkpointing", True),
            budget=BudgetConfig(**budget_data),
            security=SecurityConfig(**security_data),
        )

    def save_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_json(cls, path: Path) -> "HarnessConfig":
        with open(path, "r", encoding="utf-8") as f:
            return cls.from_dict(json.load(f))
