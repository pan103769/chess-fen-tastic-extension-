"""
Agent Adapter Interface and implementations for the AI Coding Harness.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import json
import os


@dataclass
class AgentAction:
    """Action produced by an agent in a single iteration."""
    plan: str
    file_writes: Dict[str, str] = field(default_factory=dict)
    file_deletes: List[str] = field(default_factory=list)
    commands_to_run: List[str] = field(default_factory=list)
    raw_response: str = ""


class BaseAgentAdapter(ABC):
    """Abstract Base Class for coding agent adapters."""

    @abstractmethod
    def plan_and_act(
        self,
        objective: str,
        workspace_context: Dict[str, str],
        feedback: Optional[str] = None,
        iteration_index: int = 1
    ) -> AgentAction:
        """Analyzes objective and feedback, and produces code modifications."""
        pass


class MockScriptedAgentAdapter(BaseAgentAdapter):
    """Deterministic scriptable agent used for automated testing, simulation, and verification.

    Allows pre-configuring behaviors for successive iterations to test the autonomous loop.
    """

    def __init__(self, step_actions: Optional[List[AgentAction]] = None):
        self.step_actions: List[AgentAction] = step_actions or []
        self.call_count: int = 0
        self.received_feedbacks: List[Optional[str]] = []

    def add_step(self, action: AgentAction) -> None:
        self.step_actions.append(action)

    def plan_and_act(
        self,
        objective: str,
        workspace_context: Dict[str, str],
        feedback: Optional[str] = None,
        iteration_index: int = 1
    ) -> AgentAction:
        self.received_feedbacks.append(feedback)
        idx = self.call_count
        self.call_count += 1

        if idx < len(self.step_actions):
            return self.step_actions[idx]

        # Default fallback if no steps configured
        return AgentAction(
            plan=f"Default plan for iteration {iteration_index}: objective '{objective[:30]}'",
            file_writes={},
            file_deletes=[],
            raw_response="Default mock fallback response"
        )


class AntigravityAgentAdapter(BaseAgentAdapter):
    """Adapter for Google Antigravity CLI (agy.exe) executing Gemini models."""

    def __init__(self, model: str = "gemini-3.8-flash-low", cli_path: Optional[str] = None):
        self.model = model
        self.cli_path = cli_path or os.environ.get("ANTIGRAVITY_AGENTAPI_EXE", r"C:\Users\user\.gemini\bin\agy.exe")
        self.is_available = os.path.isfile(self.cli_path)

    def _extract_json(self, text: str) -> dict:
        """Robustly extracts JSON object from LLM response text."""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError(f"No JSON object found in response: {text[:200]}")
        return json.loads(text[start:end + 1])

    def plan_and_act(
        self,
        objective: str,
        workspace_context: Dict[str, str],
        feedback: Optional[str] = None,
        iteration_index: int = 1
    ) -> AgentAction:
        if not self.is_available:
            raise RuntimeError(
                f"Antigravity CLI not found at '{self.cli_path}'. "
                "Ensure Antigravity is installed or set ANTIGRAVITY_AGENTAPI_EXE."
            )

        import subprocess

        prompt = f"""
You are an autonomous AI software engineer.
OBJECTIVE:
{objective}

ITERATION: {iteration_index}

PREVIOUS VALIDATION FEEDBACK:
{feedback or "None. This is the first iteration."}

WORKSPACE CONTEXT (Relevant files):
{json.dumps(list(workspace_context.keys()))}

INSTRUCTIONS:
- Analyze the objective and previous feedback carefully.
- If previous feedback indicates test failures or errors, modify your code specifically to address them.
- Output your response strictly as a JSON object with this schema:
{{
  "plan": "Detailed explanation of your approach and changes",
  "file_writes": {{
     "filename.py": "complete code content to write"
  }},
  "commands_to_run": []
}}
Do not add explanatory text outside the JSON object.
"""

        try:
            res = subprocess.run(
                [self.cli_path, "-p", prompt, "--model", self.model, "--dangerously-skip-permissions"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Antigravity CLI call timed out after 120 seconds using model {self.model}.")
        except Exception as e:
            raise RuntimeError(f"Failed to execute Antigravity CLI: {str(e)}")

        if res.returncode != 0 or not res.stdout.strip():
            raise RuntimeError(
                f"Antigravity CLI exited with code {res.returncode}. "
                f"Stdout: {repr(res.stdout[:200])}, Stderr: {repr(res.stderr[:300])}"
            )

        raw_output = res.stdout
        try:
            data = self._extract_json(raw_output)
        except Exception as e:
            raise ValueError(f"Failed to parse JSON from Antigravity output ({e}). Raw output: {raw_output[:300]}")

        return AgentAction(
            plan=data.get("plan", "No plan provided"),
            file_writes=data.get("file_writes", {}),
            file_deletes=data.get("file_deletes", []),
            commands_to_run=data.get("commands_to_run", []),
            raw_response=raw_output
        )


class OllamaAgentAdapter(BaseAgentAdapter):
    """Adapter for local or remote Ollama models (such as gemma4:cloud, llama3, etc.)."""

    def __init__(self, model: str = "gemma4:cloud", host: Optional[str] = None):
        self.model = model
        self.host = host

    def _check_connection(self):
        try:
            import ollama
            client = ollama.Client(host=self.host) if self.host else ollama
            client.list()
            return True, None
        except Exception as e:
            return False, str(e)

    def plan_and_act(
        self,
        objective: str,
        workspace_context: Dict[str, str],
        feedback: Optional[str] = None,
        iteration_index: int = 1
    ) -> AgentAction:
        import ollama

        is_connected, err = self._check_connection()
        if not is_connected:
            raise ConnectionError(
                f"Cannot connect to Ollama daemon ({err}). Please ensure Ollama is running or use mock adapter."
            )

        client = ollama.Client(host=self.host) if self.host else ollama

        prompt = f"""
You are an expert AI software engineer operating inside an autonomous development loop.

OBJECTIVE:
{objective}

ITERATION: {iteration_index}

PREVIOUS FEEDBACK:
{feedback or "None. This is the first iteration."}

WORKSPACE CONTEXT FILES:
{json.dumps(list(workspace_context.keys()))}

Produce your response as valid JSON with the following structure:
{{
  "plan": "Detailed explanation of your approach and changes",
  "file_writes": {{
     "path/to/file.py": "full file content to write"
  }},
  "commands_to_run": []
}}
"""

        response = client.chat(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            format="json",
            options={"temperature": 0.1}
        )

        content = response["message"]["content"]
        data = json.loads(content)

        return AgentAction(
            plan=data.get("plan", "No plan provided"),
            file_writes=data.get("file_writes", {}),
            file_deletes=data.get("file_deletes", []),
            commands_to_run=data.get("commands_to_run", []),
            raw_response=content
        )


class OpenAIAgentAdapter(BaseAgentAdapter):
    """Adapter for OpenAI-compatible LLM endpoints."""

    def __init__(self, model: str = "gpt-4o", api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.base_url = base_url

    def plan_and_act(
        self,
        objective: str,
        workspace_context: Dict[str, str],
        feedback: Optional[str] = None,
        iteration_index: int = 1
    ) -> AgentAction:
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        import openai
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)

        prompt = f"""
You are an autonomous AI coding assistant.
Objective: {objective}
Iteration: {iteration_index}
Feedback from last run:
{feedback or 'None'}

Provide your response strictly as JSON with keys:
- "plan": string
- "file_writes": object mapping relative path to full file content
- "commands_to_run": list of safe shell commands
"""

        response = client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        return AgentAction(
            plan=data.get("plan", ""),
            file_writes=data.get("file_writes", {}),
            file_deletes=data.get("file_deletes", []),
            commands_to_run=data.get("commands_to_run", []),
            raw_response=raw
        )

