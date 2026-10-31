"""
Orchestrator: Controls the autonomous development loop, budget limits, and feedback integration.
"""

from pathlib import Path
from typing import Dict, Optional, Callable
import time

from harness.config import HarnessConfig
from harness.logger import setup_logger, close_logger
from harness.state import TaskState, TaskStatus, IterationStatus, IterationRecord
from harness.execution import ExecutionEnvironment, SecurityViolationError
from harness.evaluator import Evaluator, EvaluationResult
from harness.feedback import FeedbackManager
from harness.agent import BaseAgentAdapter, AgentAction


class BudgetExceededError(Exception):
    """Raised when an execution exceeds budget or time limits."""
    pass


class Orchestrator:
    """Manages the autonomous AI development lifecycle and feedback loop."""

    def __init__(
        self,
        config: HarnessConfig,
        agent_adapter: BaseAgentAdapter,
        approval_callback: Optional[Callable[[str, str], bool]] = None
    ):
        self.config = config
        self.agent = agent_adapter
        self.logger = setup_logger(
            name=f"harness.{config.task_id}",
            log_file=config.log_file
        )
        self.env = ExecutionEnvironment(config, approval_callback=approval_callback)
        self.evaluator = Evaluator(config, self.env)
        self.feedback_mgr = FeedbackManager()
        self.state = TaskState(
            task_id=config.task_id,
            objective=config.objective,
            status=TaskStatus.NOT_STARTED
        )
        self.state_file = config.state_dir / f"{config.task_id}_state.json"

    def _gather_workspace_context(self) -> Dict[str, str]:
        """Collects relevant workspace files and their contents for agent context."""
        context: Dict[str, str] = {}
        # Collect non-ignored files in workspace root
        for path in self.config.workspace_root.glob("*.py"):
            if path.is_file() and not path.name.startswith("."):
                try:
                    rel = str(path.relative_to(self.config.workspace_root))
                    context[rel] = path.read_text(encoding="utf-8", errors="replace")[:3000]
                except Exception:
                    pass
        return context

    def run(self) -> TaskState:
        """Executes the autonomous loop until validation passes or budget limits are reached."""
        self.logger.info(f"=== Starting Autonomous Development Loop for Task: {self.config.task_id} ===")
        self.logger.info(f"Objective: {self.config.objective}")
        self.logger.info(f"Max iterations: {self.config.budget.max_iterations}")

        self.state.status = TaskStatus.IN_PROGRESS
        self.state.start_time = time.time()
        self.state.save(self.state_file)

        feedback_for_agent: Optional[str] = None
        start_wall_time = time.time()

        while self.state.status == TaskStatus.IN_PROGRESS:
            iter_index = self.state.current_iteration + 1

            # 1. Budget & Time Limit Checks
            elapsed_time = time.time() - start_wall_time
            if iter_index > self.config.budget.max_iterations:
                self.logger.warning(
                    f"Iteration limit ({self.config.budget.max_iterations}) reached without achieving success."
                )
                self.state.finish_task(TaskStatus.BUDGET_EXCEEDED)
                break

            if elapsed_time > self.config.budget.max_execution_time_seconds:
                self.logger.warning(
                    f"Maximum execution time ({self.config.budget.max_execution_time_seconds}s) exceeded."
                )
                self.state.finish_task(TaskStatus.BUDGET_EXCEEDED)
                break

            self.logger.info(f"\n--- [Iteration {iter_index} / {self.config.budget.max_iterations}] ---")

            # 2. Git Checkpoint
            if self.config.git_checkpointing:
                cp_ref = self.env.create_git_checkpoint(f"iter-{iter_index}")
                if cp_ref:
                    self.logger.info(f"Git checkpoint created: {cp_ref}")

            # 3. Initialize Iteration Record
            record = self.state.start_new_iteration(
                feedback_received=feedback_for_agent or ""
            )

            # 4. Agent Planning and Action
            workspace_context = self._gather_workspace_context()
            self.logger.info("Invoking agent for plan and code modifications...")
            try:
                action: AgentAction = self.agent.plan_and_act(
                    objective=self.config.objective,
                    workspace_context=workspace_context,
                    feedback=feedback_for_agent,
                    iteration_index=iter_index
                )
            except Exception as e:
                err_msg = f"Agent execution failed with error: {str(e)}"
                self.logger.error(err_msg)
                self.state.finish_current_iteration(
                    status=IterationStatus.ERROR,
                    error_message=err_msg
                )
                self.state.save(self.state_file)
                feedback_for_agent = f"Agent invocation crashed: {str(e)}"
                continue

            record.plan = action.plan
            self.logger.info(f"Agent Plan: {action.plan}")

            # 5. Apply File Modifications
            for rel_path, content in action.file_writes.items():
                try:
                    fc = self.env.write_file(rel_path, content, is_agent_action=True)
                    record.file_changes.append(fc)
                    self.logger.info(f"Applied change: {fc.change_type} {fc.file_path}")
                except SecurityViolationError as sec_err:
                    self.logger.error(f"Security violation on write: {sec_err}")
                    record.error_message = str(sec_err)
                except Exception as ex:
                    self.logger.error(f"Failed to write file {rel_path}: {ex}")
                    record.error_message = str(ex)

            for rel_path in action.file_deletes:
                try:
                    fc = self.env.delete_file(rel_path, is_agent_action=True)
                    record.file_changes.append(fc)
                    self.logger.info(f"Applied deletion: {fc.file_path}")
                except Exception as ex:
                    self.logger.error(f"Failed to delete file {rel_path}: {ex}")

            # Check if agent repeated an identical failed approach
            current_hash = record.compute_approach_hash()
            repeated = self.state.has_repeated_approach(current_hash)
            if repeated:
                self.logger.warning(
                    f"[Repetition Detected] Agent repeated an approach with hash {current_hash} that previously failed."
                )

            # 6. Execute Permitted Agent Commands (if any)
            for cmd in action.commands_to_run:
                try:
                    self.logger.info(f"Executing agent command: {cmd}")
                    cmd_res = self.env.execute_command(cmd, is_validation=False)
                    if cmd_res.exit_code != 0:
                        self.logger.warning(f"Command returned exit code {cmd_res.exit_code}")
                except SecurityViolationError as sec_err:
                    self.logger.error(f"Command blocked by security: {sec_err}")

            # 7. Independent Validation Evaluation (Never trust the agent's claim)
            self.logger.info("Executing independent validation checks...")
            eval_result: EvaluationResult = self.evaluator.evaluate()

            for vr in eval_result.command_executions:
                record.validation_runs.append(vr)

            # 8. Handle Validation Outcome
            if eval_result.passed:
                self.logger.info("SUCCESS: All acceptance criteria and tests passed independently!")
                self.state.finish_current_iteration(
                    status=IterationStatus.SUCCESS,
                    feedback_generated="Success"
                )
                self.state.finish_task(TaskStatus.COMPLETED)
                self.state.save(self.state_file)
                break
            else:
                self.logger.warning(f"Validation FAILED: {eval_result.summary}")
                feedback_for_agent = self.feedback_mgr.generate_feedback(
                    eval_result=eval_result,
                    state=self.state,
                    repeated_approach=repeated
                )
                self.state.finish_current_iteration(
                    status=IterationStatus.VALIDATION_FAILED,
                    feedback_generated=feedback_for_agent,
                    error_message=eval_result.summary
                )
                self.state.save(self.state_file)

        # Loop finished
        total_time = time.time() - start_wall_time
        self.logger.info(f"=== Task Finished: {self.state.status.value} in {self.state.current_iteration} iterations ({total_time:.2f}s) ===")
        self.state.save(self.state_file)
        close_logger(self.logger)
        return self.state
