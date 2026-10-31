"""
Structured and sanitized logging for the AI Coding Harness.
"""

import logging
import os
import re
from pathlib import Path
from typing import Optional, List


# Patterns that indicate secrets or API credentials
SECRET_KEY_VALUE_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password|auth|bearer)\s*[:=]\s*['\"]?([A-Za-z0-9_\-\.]{8,})['\"]?"),
]

SECRET_TOKEN_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
]


class SecretSanitizer(logging.Filter):
    """Filter that masks sensitive tokens, API keys, and environment secrets."""

    def __init__(self, additional_secrets: Optional[List[str]] = None):
        super().__init__()
        self.exact_secrets = set(additional_secrets or [])

        # Auto-discover secrets from environment variables
        for key, val in os.environ.items():
            if any(term in key.upper() for term in ("KEY", "SECRET", "TOKEN", "PASSWORD", "AUTH")):
                if len(val) >= 6:
                    self.exact_secrets.add(val)

    def mask(self, text: str) -> str:
        if not text:
            return text

        masked = str(text)

        # Mask known environment secret values
        for secret in self.exact_secrets:
            if secret in masked:
                masked = masked.replace(secret, "[REDACTED_SECRET]")

        # Mask key=value patterns
        for pattern in SECRET_KEY_VALUE_PATTERNS:
            masked = pattern.sub(r"\1=[REDACTED_SECRET]", masked)

        # Mask standalone token patterns
        for pattern in SECRET_TOKEN_PATTERNS:
            masked = pattern.sub("[REDACTED_SECRET]", masked)

        return masked

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.mask(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: self.mask(str(v)) for k, v in record.args.items()}
            elif isinstance(record.args, (list, tuple)):
                record.args = tuple(self.mask(str(a)) for a in record.args)
        return True


def setup_logger(
    name: str = "harness",
    log_file: Optional[Path] = None,
    level: int = logging.INFO,
    console: bool = True
) -> logging.Logger:
    """Configures and returns a sanitized logger."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Clear existing handlers to avoid duplicates
    if logger.hasHandlers():
        logger.handlers.clear()

    sanitizer = SecretSanitizer()
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    if console:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        console_handler.addFilter(sanitizer)
        logger.addHandler(console_handler)

    if log_file:
        log_file = Path(log_file)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(sanitizer)
        logger.addHandler(file_handler)

    return logger


def close_logger(logger: logging.Logger) -> None:
    """Closes and removes all handlers to release file locks (especially on Windows)."""
    for handler in list(logger.handlers):
        try:
            handler.flush()
            handler.close()
        except Exception:
            pass
        logger.removeHandler(handler)
