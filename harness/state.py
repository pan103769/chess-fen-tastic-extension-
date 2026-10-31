"""
State management and execution history persistence for the AI Coding Harness.
"""

from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import List, Optional, Dict, Any
import hashlib
import json
import time


class IterationStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    SUCCESS = "SUCCESS"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    ERROR = "ERROR"
    BLOCKED = "BLOCKED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"


class TaskStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"


@dataclass
class CommandExecution:
    """Record of an executed shell command."""
    command: str
    exit_code: int
    stdout: str
    stderr: str
    duration_seconds: float
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FileChangeRecord:
    """Record of a file modification."""
    file_path: str
    change_type: str  # "create", "modify", "delete"
    diff: str = ""
    checksum_after: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class IterationRecord:
    """Detailed record of a single iteration step."""
    iteration_index: int
    status: IterationStatus = IterationStatus.PENDING
    plan: str = ""
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    file_changes: List[FileChangeRecord] = field(default_factory=list)
    validation_runs: List[CommandExecution] = field(default_factory=list)
    feedback_received: str = ""
    feedback_generated: str = ""
    error_message: Optional[str] = None
    approach_hash: str = ""

    def compute_approach_hash(self) -> str:
        """Computes a deterministic hash of changes and plan to detect repetitive loops."""
        content = [self.plan.strip()]
        for fc in sorted(self.file_changes, key=lambda x: x.file_path):
            content.append(f"{fc.file_path}:{fc.change_type}:{fc.diff}")
        raw = "|".join(content)
        self.approach_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
        return self.approach_hash

    def to_dict(self) -> dict:
        return {
            "iteration_index": self.iteration_index,
            "status": self.status.value if isinstance(self.status, IterationStatus) else self.status,
            "plan": self.plan,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "file_changes": [fc.to_dict() for fc in self.file_changes],
            "validation_runs": [vr.to_dict() for vr in self.validation_runs],
            "feedback_received": self.feedback_received,
            "feedback_generated": self.feedback_generated,
            "error_message": self.error_message,
            "approach_hash": self.approach_hash,
        }


@dataclass
class TaskState:
    """Master state representing the entire lifecycle of a development objective."""
    task_id: str
    objective: str
    status: TaskStatus = TaskStatus.NOT_STARTED
    current_iteration: int = 0
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    iterations: List[IterationRecord] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def start_new_iteration(self, plan: str = "", feedback_received: str = "") -> IterationRecord:
        self.current_iteration += 1
        record = IterationRecord(
            iteration_index=self.current_iteration,
            status=IterationStatus.IN_PROGRESS,
            plan=plan,
            feedback_received=feedback_received,
            start_time=time.time()
        )
        self.iterations.append(record)
        self.status = TaskStatus.IN_PROGRESS
        return record

    def get_current_iteration(self) -> Optional[IterationRecord]:
        if self.iterations:
            return self.iterations[-1]
        return None

    def has_repeated_approach(self, approach_hash: str) -> bool:
        """Checks if the same approach was previously attempted and failed."""
        if not approach_hash:
            return False
        # Look back through previous completed iterations (excluding currently running one)
        previous_iterations = self.iterations[:-1]
        for it in previous_iterations:
            if it.approach_hash == approach_hash and it.status != IterationStatus.SUCCESS:
                return True
        return False

    def finish_current_iteration(
        self,
        status: IterationStatus,
        feedback_generated: str = "",
        error_message: Optional[str] = None
    ) -> None:
        current = self.get_current_iteration()
        if current:
            current.status = status
            current.end_time = time.time()
            current.feedback_generated = feedback_generated
            current.error_message = error_message
            current.compute_approach_hash()

    def finish_task(self, status: TaskStatus) -> None:
        self.status = status
        self.end_time = time.time()

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "objective": self.objective,
            "status": self.status.value if isinstance(self.status, TaskStatus) else self.status,
            "current_iteration": self.current_iteration,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "metadata": self.metadata,
            "iterations": [it.to_dict() for it in self.iterations]
        }

    def save(self, filepath: Path) -> None:
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, filepath: Path) -> "TaskState":
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        state = cls(
            task_id=data.get("task_id", "default_task"),
            objective=data.get("objective", ""),
            status=TaskStatus(data.get("status", TaskStatus.NOT_STARTED.value)),
            current_iteration=data.get("current_iteration", 0),
            start_time=data.get("start_time", time.time()),
            end_time=data.get("end_time"),
            metadata=data.get("metadata", {})
        )

        for it_data in data.get("iterations", []):
            it = IterationRecord(
                iteration_index=it_data.get("iteration_index", 1),
                status=IterationStatus(it_data.get("status", IterationStatus.PENDING.value)),
                plan=it_data.get("plan", ""),
                start_time=it_data.get("start_time", 0.0),
                end_time=it_data.get("end_time"),
                feedback_received=it_data.get("feedback_received", ""),
                feedback_generated=it_data.get("feedback_generated", ""),
                error_message=it_data.get("error_message"),
                approach_hash=it_data.get("approach_hash", ""),
            )
            for fc in it_data.get("file_changes", []):
                it.file_changes.append(FileChangeRecord(**fc))
            for vr in it_data.get("validation_runs", []):
                it.validation_runs.append(CommandExecution(**vr))
            state.iterations.append(it)

        return state

