"""
CLI Entry Point for the AI Coding Harness.
"""

import argparse
import sys
import time
from pathlib import Path
from typing import Optional

from harness.config import HarnessConfig, BudgetConfig
from harness.state import TaskState, TaskStatus
from harness.orchestrator import Orchestrator
from harness.agent import (
    BaseAgentAdapter,
    MockScriptedAgentAdapter,
    OllamaAgentAdapter,
    OpenAIAgentAdapter,
    AntigravityAgentAdapter
)


def interactive_approval(action_type: str, details: str) -> bool:
    """Prompts human operator for approval before executing destructive actions."""
    print(f"\n[APPROVAL REQUEST] Action: {action_type}")
    print(f"Details: {details}")
    try:
        ans = input("Approve this action? [y/N]: ").strip().lower()
        return ans in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        return False


def create_agent(backend: str, model: Optional[str] = None) -> BaseAgentAdapter:
    """Instantiates the specified agent backend adapter."""
    b = backend.lower()
    if b == "mock":
        return MockScriptedAgentAdapter()
    elif b == "ollama":
        return OllamaAgentAdapter(model=model or "gemma4:cloud")
    elif b == "openai":
        return OpenAIAgentAdapter(model=model or "gpt-4o")
    elif b == "antigravity":
        return AntigravityAgentAdapter(model=model or "gemini-3.8-flash-low")
    else:
        raise ValueError(f"Unknown agent backend: '{backend}'. Choose from: mock, ollama, openai, antigravity.")


def parse_args(args=None):
    parser = argparse.ArgumentParser(
        prog="python -m harness.main",
        description="Autonomous AI Coding Harness for Chess FEN-tastic"
    )
    parser.add_argument("--task-id", type=str, default=None, help="Unique identifier for the task run")
    parser.add_argument("--objective", type=str, default="", help="Natural language objective for the agent")
    parser.add_argument("--backend", type=str, default="mock", choices=["mock", "ollama", "openai", "antigravity"],
                        help="LLM agent backend adapter (default: mock)")
    parser.add_argument("--model", type=str, default=None, help="LLM model name (e.g. gemma4:cloud, gpt-4o)")
    parser.add_argument("--max-iterations", type=int, default=10, help="Maximum iteration limit (default: 10)")
    parser.add_argument("--timeout", type=float, default=60.0, help="Command timeout in seconds")
    parser.add_argument("--validation-cmd", type=str, action="append", default=None,
                        help="Command to validate task (can be specified multiple times)")
    parser.add_argument("--config", type=str, default=None, help="Path to a JSON configuration file")
    parser.add_argument("--interactive-approval", action="store_true",
                        help="Require explicit interactive confirmation for destructive operations")
    parser.add_argument("--status", type=str, default=None, help="Print summary of an existing task state JSON")
    return parser.parse_args(args)


def show_state_summary(state_path: Path):
    if not state_path.exists():
        print(f"Error: State file not found at {state_path}")
        sys.exit(1)
    state = TaskState.load(state_path)
    print("=" * 60)
    print(f"Task ID: {state.task_id}")
    print(f"Objective: {state.objective}")
    print(f"Status: {state.status.value}")
    print(f"Total Iterations: {state.current_iteration}")
    print("-" * 60)
    for it in state.iterations:
        print(f"Iteration #{it.iteration_index}: {it.status.value}")
        print(f"  Plan: {it.plan[:100]}")
        print(f"  Files modified: {[fc.file_path for fc in it.file_changes]}")
        print(f"  Validation runs: {len(it.validation_runs)} (Exit codes: {[vr.exit_code for vr in it.validation_runs]})")
        if it.error_message:
            print(f"  Error: {it.error_message[:120]}")
    print("=" * 60)


def main(args=None):
    parsed = parse_args(args)

    if parsed.status:
        show_state_summary(Path(parsed.status))
        return 0

    workspace_root = Path.cwd().resolve()
    state_dir = workspace_root / ".harness_state"
    state_dir.mkdir(parents=True, exist_ok=True)

    if parsed.config:
        config = HarnessConfig.load_json(Path(parsed.config))
    else:
        task_id = parsed.task_id or f"task_{int(time.time())}"
        val_cmds = parsed.validation_cmd or ['python -m unittest discover -s harness/tests -p "test_*.py"']
        config = HarnessConfig(
            task_id=task_id,
            objective=parsed.objective or "Execute self-tests and verify project consistency",
            workspace_root=workspace_root,
            state_dir=state_dir,
            log_file=state_dir / f"{task_id}.log",
            validation_commands=val_cmds,
            budget=BudgetConfig(
                max_iterations=parsed.max_iterations,
                command_timeout_seconds=parsed.timeout
            )
        )

    approval_cb = interactive_approval if parsed.interactive_approval else None
    agent = create_agent(parsed.backend, parsed.model)
    orchestrator = Orchestrator(config, agent, approval_callback=approval_cb)

    final_state = orchestrator.run()

    print("\n" + "=" * 60)
    print("HARNESS EXECUTION COMPLETE")
    print(f"Task Status: {final_state.status.value}")
    print(f"Iterations:  {final_state.current_iteration} / {config.budget.max_iterations}")
    print(f"State saved: {config.state_dir / f'{config.task_id}_state.json'}")
    print("=" * 60)

    return 0 if final_state.status == TaskStatus.COMPLETED else 1


if __name__ == "__main__":
    sys.exit(main())
