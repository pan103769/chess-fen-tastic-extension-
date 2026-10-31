# 🛠️ AI Coding Harness for Chess FEN-tastic

An autonomous development loop and evaluation harness designed to guide AI coding agents through iterative software engineering tasks with independent validation and rigorous security boundaries.

---

## 🎯 Features

- **Autonomous Iteration Cycle**: Repeatedly plans, executes changes, independently evaluates results, and produces targeted feedback until acceptance criteria are satisfied or budget limits are reached.
- **Never Trusts Agent Self-Reports**: Independently executes validation commands in a sandboxed subprocess and parses exit codes and test outputs.
- **Test File Protection & Tamper Detection**: Automatically snapshots protected test files and verifies SHA256 checksums to prevent agents from weakening or bypassing tests to pass validation.
- **Git Checkpoints**: Automatically creates lightweight Git references (`refs/harness/harness-checkpoint-*`) before each iteration, preserving existing uncommitted changes and enabling instant rollback.
- **Safety Sandboxing & Approval Controls**:
  - Restrictive allowlist for binary execution (`python`, `git`, `dir`, `echo`, etc.).
  - Blocklist for destructive patterns (e.g. `rmdir /s`, `rm -rf`, `format`, fork bombs).
  - Optional human approval hooks for destructive commands and deletions.
- **Repetition Prevention**: Computes deterministic approach hashes of plans and diffs; identifies and warns when an agent repeats an approach that already failed.
- **Credential Masking & Sanitization**: Filters API tokens (`sk-...`, `ghp_...`) and environment secrets from all logs and feedback.
- **Pluggable Agent Adapters**:
  - `MockScriptedAgentAdapter`: Deterministic testing and simulation of failing -> fixing cycles without API keys or network.
  - `OllamaAgentAdapter`: Native adapter for local Ollama models (e.g. `gemma4:cloud`).
  - `OpenAIAgentAdapter`: Native adapter for OpenAI / Gemini-compatible REST endpoints.
  - `AntigravityAgentAdapter`: Clean adapter ready to hook into `google-antigravity` if installed.

---

## 📐 Architecture

```
harness/
├── __init__.py           # Package marker
├── config.py             # HarnessConfig, BudgetConfig, SecurityConfig
├── logger.py             # Structured, sanitized logging & secret masking
├── state.py              # TaskState, IterationRecord, JSON persistence
├── execution.py          # ExecutionEnvironment, sandboxing, git checkpoints
├── evaluator.py          # Evaluator, independent test runs & tamper detection
├── feedback.py           # FeedbackManager, traceback analysis & actionable prompts
├── agent.py              # BaseAgentAdapter, Mock, Ollama, OpenAI, Antigravity
├── orchestrator.py       # Orchestrator, core while loop & budget control
├── main.py               # CLI entry point
├── README.md             # This documentation
└── tests/                # Automated unit and integration tests
    ├── test_config.py
    ├── test_logger.py
    ├── test_state.py
    ├── test_execution.py
    ├── test_evaluator.py
    ├── test_feedback.py
    └── test_harness_loop.py
```

### Core Autonomous Loop

```text
       ┌───────────────────────────────┐
       │   Task & Objective Ingestion  │
       └──────────────┬────────────────┘
                      ▼
 ┌────────► 1. Provide Context & Feedback
 │          2. Agent Formulates Plan & Changes
 │          3. Apply Changes Safely (Sandboxed)
 │          4. Independently Run Validation Suite
 │          5. Evaluate Results & Test Integrity
 │                    │
 │            ┌───────┴───────┐
 │            │ Passed Tests? │
 │            └───┬───────┬───┘
 │       NO       │       │       YES
 └────────────────┘       └──────────────► Mark Task COMPLETED
                                           Persist Full History
```

---

## 🚀 Getting Started

### 1. Run Harness Self-Tests

Execute all harness unit tests and end-to-end integration tests:

```bash
python -m unittest discover -s harness/tests -p "test_*.py"
```

### 2. Run the Harness CLI

#### Using Default Mock Backend (Verification / Simulation)
```bash
python -m harness.main --task-id task_01 --objective "Implement helper function in utils.py"
```

#### Using Local Ollama
```bash
python -m harness.main --backend ollama --model gemma4:cloud --task-id task_ollama --objective "Refactor board parser"
```

#### Using OpenAI / Compatible Endpoint
Ensure `OPENAI_API_KEY` is set in your environment:
```bash
python -m harness.main --backend openai --model gpt-4o --task-id task_openai --objective "Add FEN castling rights validation"
```

#### Custom Validation Commands
```bash
python -m harness.main --task-id test_task --validation-cmd "python -m unittest discover -s tests"
```

#### Interactive Human Approval Mode
To require explicit human approval before running potentially destructive commands:
```bash
python -m harness.main --interactive-approval --task-id safe_task
```

### 3. Inspecting Saved State History

To view the complete execution history, iterations, diffs, and test results from a previous task run:

```bash
python -m harness.main --status .harness_state/task_01_state.json
```

---

## 🔒 Security & Safe Operation

1. **Test Protection**: Never allows agents to write or delete files matching test patterns (`test_*.py`, `tests/**`).
2. **Command Confinement**: Commands are executed within the workspace root; directory traversal (`../`) is blocked.
3. **Execution Limits**: Per-command timeouts and maximum total run timeouts prevent runaway processes or infinite loops.
4. **Credential Redaction**: Secrets matching API key patterns or environment variable secret names are automatically replaced with `[REDACTED_SECRET]` before logging.

