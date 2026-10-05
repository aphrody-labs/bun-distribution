# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Automated local secrets and environment configuration script."""

from __future__ import annotations

import sys

from aphrody_cli.setup import setup_secrets


def main() -> None:
    """Run automated credentials and secrets environment configuration."""
    success = setup_secrets()
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
