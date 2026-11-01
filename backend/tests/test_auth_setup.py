"""Registration must not activate an account before TOTP verification."""

import tempfile
import unittest
from pathlib import Path

import pyotp

import auth_manager


class InitialSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = auth_manager.AUTH_DB_PATH
        auth_manager.AUTH_DB_PATH = Path(self.temp_dir.name) / "auth.db"
        auth_manager.initialize_auth_storage()
        self.code = auth_manager.setup_code()

    def tearDown(self):
        auth_manager.AUTH_DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_account_is_created_only_after_valid_code(self):
        pending = auth_manager.begin_initial_user_setup("admin", "a-very-long-password", self.code)
        self.assertFalse(auth_manager.has_users())

        code = pyotp.TOTP(pending["totp_secret"]).now()
        wrong_code = f"{(int(code) + 500000) % 1000000:06d}"
        with self.assertRaisesRegex(ValueError, "Invalid one-time code"):
            auth_manager.complete_initial_user_setup(pending["setup_token"], wrong_code)
        self.assertFalse(auth_manager.has_users())

        user = auth_manager.complete_initial_user_setup(pending["setup_token"], code)
        self.assertEqual(user["username"], "admin")
        self.assertTrue(auth_manager.has_users())
        self.assertEqual(
            auth_manager.authenticate_user("admin", "a-very-long-password", code), user
        )

        with self.assertRaisesRegex(RuntimeError, "already been completed"):
            auth_manager.complete_initial_user_setup(pending["setup_token"], code)

    def test_setup_needs_the_setup_code(self):
        self.assertRegex(self.code, r"^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$")
        # the same code on every start until setup is done
        self.assertEqual(auth_manager.setup_code(), self.code)
        for wrong in ("", "AAAA-AAAA-AAAA", self.code[:-1]):
            with self.assertRaises(PermissionError):
                auth_manager.begin_initial_user_setup("admin", "a-very-long-password", wrong)
        # dashes, spaces and case don't matter
        loose = " " + self.code.replace("-", "").lower() + " "
        pending = auth_manager.begin_initial_user_setup("admin", "a-very-long-password", loose)
        auth_manager.complete_initial_user_setup(pending["setup_token"], pyotp.TOTP(pending["totp_secret"]).now())
        # used up: gone once the account exists
        self.assertIsNone(auth_manager.setup_code())
        self.assertIsNone(auth_manager.get_config_value(auth_manager.SETUP_CODE_KEY))

    def test_expired_setup_can_be_restarted(self):
        pending = auth_manager.begin_initial_user_setup("admin", "a-very-long-password", self.code)
        with auth_manager._connect() as connection:
            connection.execute(
                "UPDATE pending_setups SET expires_at = 0 WHERE token = ?",
                (pending["setup_token"],),
            )

        code = pyotp.TOTP(pending["totp_secret"]).now()
        with self.assertRaisesRegex(ValueError, "expired"):
            auth_manager.complete_initial_user_setup(pending["setup_token"], code)
        self.assertFalse(auth_manager.has_users())
        replacement = auth_manager.begin_initial_user_setup("admin", "a-very-long-password", self.code)
        self.assertNotEqual(replacement["setup_token"], pending["setup_token"])


if __name__ == "__main__":
    unittest.main()
