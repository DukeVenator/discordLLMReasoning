# Troubleshooting Guide

This document lists common issues encountered while setting up or running the LLMcordTS bot and provides potential solutions.

**(Content TBD)**

## Common Issues

*   **Issue:** Bot doesn't come online / "Authentication Failed" errors.
    *   **Possible Causes:** Incorrect Discord token in configuration; Bot not added to the server; Required Gateway Intents not enabled in Discord Developer Portal.
    *   **Solutions:** Verify `discord_token` in `config.yaml` or environment variables; Ensure the bot is invited to the server with necessary permissions; Check enabled Intents (e.g., Message Content, Guild Messages) in the Developer Portal.

*   **Issue:** Commands not responding / "Unknown interaction" errors.
    *   **Possible Causes:** Commands not registered properly on startup; Mismatch between command definition and handler; Discord API outage.
    *   **Solutions:** Check bot startup logs for errors during command registration; Verify command names and options match between definitions and handlers; Check Discord status pages.

*   **Issue:** LLM provider errors (e.g., API key invalid, rate limits).
    *   **Possible Causes:** Incorrect API key in configuration; Exceeded API rate limits; LLM service outage.
    *   **Solutions:** Verify API keys in `config.yaml` or environment variables; Check usage dashboards on the LLM provider's website; Check provider status pages.

*   **Issue:** Memory not persisting / Errors related to database.
    *   **Possible Causes:** Incorrect database path in configuration; File system permissions issues preventing database write access; Corrupted database file.
    *   **Solutions:** Verify `memory.sqlite.database_path` in config; Ensure the bot process has write permissions to the directory containing the database file; Try deleting the database file (caution: loses history) and letting the bot recreate it.

*   **Issue:** High resource usage (CPU/Memory).
    *   **Possible Causes:** Inefficient code in a custom command/feature; Memory leaks; Very high bot activity.
    *   **Solutions:** Profile the application to identify bottlenecks; Review recent code changes; Consider optimizing memory usage settings or scaling deployment resources.

*(This section will be expanded with more specific issues and solutions as they are identified.)*