"""
Tests for logger secret sanitization.
"""

import os
import unittest
from harness.logger import SecretSanitizer


class TestLoggerSanitization(unittest.TestCase):

    def test_masks_known_token_formats(self):
        sanitizer = SecretSanitizer()

        text = "Calling API with bearer token: Bearer: sk-abcdef123456789012345678 and token=ghp_12345678901234567890"
        masked = sanitizer.mask(text)

        self.assertNotIn("sk-abcdef123456789012345678", masked)
        self.assertNotIn("ghp_12345678901234567890", masked)
        self.assertIn("[REDACTED_SECRET]", masked)

    def test_masks_injected_secrets_from_env(self):
        os.environ["CUSTOM_TEST_API_KEY"] = "super_confidential_secret_value_999"
        sanitizer = SecretSanitizer()

        text = "Error response from endpoint super_confidential_secret_value_999 while connecting"
        masked = sanitizer.mask(text)

        self.assertNotIn("super_confidential_secret_value_999", masked)
        self.assertIn("[REDACTED_SECRET]", masked)


if __name__ == "__main__":
    unittest.main()

