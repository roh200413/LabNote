import os

# Tests create many accounts and log in repeatedly; a low PBKDF2 round count keeps them fast.
os.environ.setdefault("PASSWORD_HASH_ITERATIONS", "1000")
