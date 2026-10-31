"""
Safe execution environment, command sandboxing, and Git checkpoint manager.
"""

from pathlib import Path
from typing import List, Optional, Callable, Tuple
import difflib
import hashlib
import os
import re
import shlex
import subprocess
import time

from harness.config import HarnessConfig
from harness.logger import SecretSanitizer
from harness.state import CommandExecution, FileChangeRecord


class SecurityViolationError(Exception):
    """Raised when an execution violates harness security boundaries."""
    pass


class ExecutionEnvironment:
    """Manages command execution, git checkpoints, and safe workspace file modifications."""

    def __init__(
        self,
        config: HarnessConfig,
        approval_callback: Optional[Callable[[str, str], bool]] = None
    ):
        self.config = config
        self.workspace_root = config.workspace_root.resolve()
        self.approval_callback = approval_callback
        self.sanitizer = SecretSanitizer()

    def _resolve_safe_path(self, relative_path: str) -> Path:
        """Resolves path and guarantees it stays inside workspace_root."""
        target = (self.workspace_root / relative_path).resolve()
        try:
            target.relative_to(self.workspace_root)
        except ValueError:
            raise SecurityViolationError(
                f"Path traversal detected: '{relative_path}' points outside workspace root '{self.workspace_root}'"
            )
        return target

    def is_command_safe(self, command: str) -> Tuple[bool, str]:
        """Validates command against allowlists, blocklists, and safety criteria."""
        cmd_stripped = command.strip()
        if not cmd_stripped:
            return False, "Empty command."

        # Check blocked dangerous patterns
        for pattern in self.config.security.blocked_patterns:
            if re.search(pattern, cmd_stripped, re.IGNORECASE):
                return False, f"Command contains prohibited destructive pattern: {pattern}"

        # Parse the command tokens to extract binary
        try:
            tokens = shlex.split(cmd_stripped, posix=(os.name != "nt"))
        except Exception:
            tokens = cmd_stripped.split()

        if not tokens:
            return False, "Unable to parse command."

        binary = Path(tokens[0]).name.lower()
        if binary.endswith(".exe"):
            binary_base = binary[:-4]
        else:
            binary_base = binary

        # Check allowed binary prefixes
        allowed = False
        for prefix in self.config.security.allowed_command_prefixes:
            p = prefix.lower()
            if p.endswith(".exe"):
                p = p[:-4]
            if binary_base == p or tokens[0].lower().startswith(p):
                allowed = True
                break

        if not allowed:
            return False, f"Binary '{tokens[0]}' is not in the allowed command prefixes: {self.config.security.allowed_command_prefixes}"

        return True, "Safe"

    def execute_command(
        self,
        command: str,
        timeout: Optional[float] = None,
        is_validation: bool = False
    ) -> CommandExecution:
        """Executes a permitted shell command within the workspace."""
        is_safe, reason = self.is_command_safe(command)
        if not is_safe:
            raise SecurityViolationError(f"Command blocked by security policy: {reason}")

        # Check if approval needed
        destructive_keywords = ["git reset", "git clean", "del", "erase", "rmdir"]
        is_potentially_destructive = any(kw in command.lower() for kw in destructive_keywords)

        if is_potentially_destructive and self.config.security.require_approval_for_destructive and not is_validation:
            if self.approval_callback:
                approved = self.approval_callback("command", command)
                if not approved:
                    raise SecurityViolationError(f"Potentially destructive command '{command}' rejected by human approval.")
            else:
                raise SecurityViolationError(f"Command '{command}' is destructive and no approval callback was provided.")

        timeout_sec = timeout or self.config.budget.command_timeout_seconds
        start_time = time.time()

        try:
            result = subprocess.run(
                command,
                cwd=str(self.workspace_root),
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                encoding="utf-8",
                errors="replace"
            )
            duration = time.time() - start_time
            stdout = self.sanitizer.mask(result.stdout)
            stderr = self.sanitizer.mask(result.stderr)
            exit_code = result.returncode
        except subprocess.TimeoutExpired as exc:
            duration = time.time() - start_time
            stdout = self.sanitizer.mask(exc.stdout or "")
            stderr = self.sanitizer.mask(f"Execution timed out after {timeout_sec} seconds.\n{exc.stderr or ''}")
            exit_code = -1
        except Exception as exc:
            duration = time.time() - start_time
            stdout = ""
            stderr = f"Execution failed to launch: {str(exc)}"
            exit_code = -2

        return CommandExecution(
            command=self.sanitizer.mask(command),
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            duration_seconds=duration,
            timestamp=start_time
        )

    def is_test_file(self, file_path: str) -> bool:
        """Determines if a relative file path matches configured test patterns."""
        norm_path = Path(file_path).as_posix()
        for pattern in self.config.test_files_patterns:
            if Path(norm_path).match(pattern) or f"/{norm_path}".endswith(pattern.replace("*", "")):
                return True
            if "test" in norm_path.lower():
                return True
        return False

    def read_file(self, relative_path: str) -> str:
        """Safely reads file contents from the workspace."""
        path = self._resolve_safe_path(relative_path)
        if not path.is_file():
            raise FileNotFoundError(f"File not found: {relative_path}")
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def write_file(self, relative_path: str, content: str, is_agent_action: bool = True) -> FileChangeRecord:
        """Safely creates or modifies a file, verifying permissions and test file integrity."""
        path = self._resolve_safe_path(relative_path)

        if is_agent_action and self.config.security.protect_test_files and self.is_test_file(relative_path):
            raise SecurityViolationError(
                f"Agent is prohibited from creating or modifying test files: '{relative_path}'"
            )

        original_content = ""
        change_type = "modify" if path.exists() else "create"
        if path.exists():
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                original_content = f.read()

        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

        # Generate unified diff
        diff_lines = list(difflib.unified_diff(
            original_content.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile=f"a/{relative_path}",
            tofile=f"b/{relative_path}",
            lineterm=""
        ))
        diff_str = "".join(diff_lines)
        checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()

        return FileChangeRecord(
            file_path=relative_path,
            change_type=change_type,
            diff=diff_str,
            checksum_after=checksum
        )

    def delete_file(self, relative_path: str, is_agent_action: bool = True) -> FileChangeRecord:
        """Safely deletes a file after necessary security and approval checks."""
        path = self._resolve_safe_path(relative_path)
        if not path.exists():
            raise FileNotFoundError(f"Cannot delete non-existent file: {relative_path}")

        if is_agent_action and self.config.security.protect_test_files and self.is_test_file(relative_path):
            raise SecurityViolationError(f"Agent cannot delete test files: '{relative_path}'")

        if self.config.security.require_approval_for_destructive:
            if self.approval_callback:
                if not self.approval_callback("delete_file", relative_path):
                    raise SecurityViolationError(f"Deletion of '{relative_path}' rejected by human approval.")
            else:
                raise SecurityViolationError(f"Deletion of '{relative_path}' requires human approval.")

        original_content = ""
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            original_content = f.read()

        path.unlink()

        diff_lines = list(difflib.unified_diff(
            original_content.splitlines(keepends=True),
            [],
            fromfile=f"a/{relative_path}",
            tofile="/dev/null",
            lineterm=""
        ))

        return FileChangeRecord(
            file_path=relative_path,
            change_type="delete",
            diff="".join(diff_lines),
            checksum_after=""
        )

    # Git checkpointing
    def create_git_checkpoint(self, checkpoint_name: str) -> Optional[str]:
        """Creates a lightweight Git checkpoint commit or stash without disrupting work."""
        if not self.config.git_checkpointing:
            return None

        # Check if git is available
        git_dir = self.workspace_root / ".git"
        if not git_dir.exists():
            return None

        try:
            # Check current status
            res = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(self.workspace_root),
                capture_output=True,
                text=True,
                timeout=10
            )
            # Create a stash or a custom checkpoint tag/ref
            timestamp = int(time.time())
            tag_name = f"harness-checkpoint-{timestamp}-{checkpoint_name}"

            # Create an internal git tree object or ref
            stash_res = subprocess.run(
                ["git", "stash", "create", tag_name],
                cwd=str(self.workspace_root),
                capture_output=True,
                text=True,
                timeout=10
            )
            commit_hash = stash_res.stdout.strip()
            if commit_hash:
                subprocess.run(
                    ["git", "update-ref", f"refs/harness/{tag_name}", commit_hash],
                    cwd=str(self.workspace_root),
                    capture_output=True,
                    timeout=10
                )
                return f"refs/harness/{tag_name}"
            return "working_tree_clean"
        except Exception:
            return None

