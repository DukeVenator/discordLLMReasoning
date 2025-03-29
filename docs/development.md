# Development Guide

Interested in contributing to LLMCord? This guide provides information to help you get started.

## Getting Started

1.  **Set up Development Environment:** Follow the "Standard Installation" steps in the [Installation Guide](./installation.md). Using `pip install -e .` installs the project in editable mode, which is ideal for development.
2.  **Fork the Repository:** Create your own fork of the main LLMCord repository on GitHub.
3.  **Create a Branch:** Create a new branch in your fork for your feature or bug fix (e.g., `git checkout -b feature/new-provider` or `git checkout -b fix/memory-bug`).

## Codebase Architecture Overview

The project is structured into several key components within the `llmcord/` directory:

*   **`main.py`:** Entry point for the application, initializes and runs the bot using the `llmcord` console script.
*   **`bot.py` (`LLMCordBot` class):** The core class managing the Discord client, message handling, event processing, interaction with other modules, and conversation context.
*   **`config.py` (`Config` class):** Handles loading, validation, and access to settings from `config.yaml`.
*   **`providers/`:** Contains the implementations for different LLM providers (`base.py`, `openai.py`, `gemini.py`) and a factory (`__init__.py`) for creating provider instances based on the configuration.
*   **`memory/`:** Manages persistent user memory (`storage.py`) and LLM-suggested memory updates (`suggestions.py`).
*   **`reasoning/`:** Handles the logic for the optional multimodel/reasoning feature (`manager.py`).
*   **`utils/`:** Contains utility classes and functions, such as rate limiting (`rate_limit.py`), slash command handling (`slash_commands.py`), and caching (`cache.py`).

## Contribution Guidelines

*   **Issues:** Use GitHub Issues to report bugs or suggest features. Check existing issues before creating a new one.
*   **Pull Requests (PRs):**
    *   Submit PRs from your feature/bugfix branch in your fork to the `main` branch of the upstream repository.
    *   Provide a clear description of the changes in your PR.
    *   Ensure your code is reasonably clean and follows the general style of the existing codebase. (Note: A formal style guide like Black or Flake8 is not currently enforced but may be adopted later).
*   **Testing:** (Currently, there is no formal test suite). Test your changes manually by running the bot and verifying the functionality. Consider adding tests if you are comfortable doing so.

## License

LLMCord is licensed under the MIT License. See the [LICENSE.md](../LICENSE.md) file for details.