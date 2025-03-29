# LLMCord Unit Testing Plan

## Goal

Establish a robust unit testing foundation for the `llmcord` project to ensure code quality, prevent regressions, and facilitate future development.

## Testing Framework & Strategy

*   **Framework:** `pytest`
*   **Async Handling:** `pytest-asyncio`
*   **Mocking:** `pytest-mock`
*   **Coverage:** `pytest-cov` (Recommended)
*   **External Dependencies:** All external interactions (Discord API, LLM APIs, HTTP calls, Database via `aiosqlite`) will be mocked to ensure tests are fast, reliable, and independent.

## Phase 1: Setup and Core Utilities

1.  **Establish Test Directory Structure:**
    *   Create a top-level `tests/` directory.
    *   Inside `tests/`, mirror the `llmcord/` structure (e.g., `tests/providers/`, `tests/memory/`).
    *   Add an empty `tests/__init__.py` file.
2.  **Add Testing Dependencies:**
    *   Create/update `requirements-dev.txt`.
    *   Add: `pytest`, `pytest-asyncio`, `pytest-mock`, `pytest-cov`.
3.  **Configure `pytest`:**
    *   Create `pytest.ini` or update `pyproject.toml`.
    *   Configure `pytest` for test discovery and asyncio mode.
    *   Example (`pytest.ini`):
        ```ini
        [pytest]
        asyncio_mode = auto
        testpaths = tests
        python_files = test_*.py
        ```
4.  **Create Core Test Fixtures (`tests/conftest.py`):**
    *   `mock_config`: Mocked `Config` object.
    *   `mock_discord_objects`: Mocked `discord.Client`, `discord.Message`, `discord.User`, etc.
    *   `mock_llm_provider`: Mocked LLM provider instance.
    *   `mock_memory_storage`: Mocked `MemoryStorage` instance.
    *   `mock_httpx_client`: Mocked `httpx.AsyncClient`.
    *   `mock_rate_limiter`: Mocked `RateLimiter`.
    *   `mock_reasoning_manager`: Mocked `ReasoningManager`.
    *   `mock_slash_handler`: Mocked `SlashCommandHandler`.
    *   `llmcord_bot`: Fixture initializing `LLMCordBot` with mocked components.

## Phase 2: Initial Test Implementation (Broad Coverage)

Write initial unit tests focusing on core components, using the fixtures from Phase 1.

1.  **`tests/test_config.py`:** Test config loading, defaults, `get()` method.
2.  **`tests/test_bot.py`:**
    *   Test `LLMCordBot.initialize()` success/failure.
    *   Test `LLMCordBot.has_permission()` logic.
    *   Test `on_message` basic filtering (bots, rate limits, permissions).
    *   Test `LLMCordBot.build_message_history()`.
    *   Test `LLMCordBot.prepare_system_prompt()`.
    *   Test `process_message` high-level flow (mocking sub-calls).
    *   Test `handle_memory_command` and `handle_forget_command`.
3.  **`tests/providers/test_*.py`:** Test `ProviderFactory` and basic provider methods (mocking APIs).
4.  **`tests/memory/test_*.py`:** Test `MemoryStorage` (mocking `aiosqlite`) and `MemorySuggestionProcessor`.
5.  **`tests/utils/test_*.py`:** Test `RateLimiter`, `SlashCommandHandler` setup, etc.
6.  **`tests/reasoning/test_manager.py`:** Test `ReasoningManager` basics (init, signal detection, rate limits, flow).

## Phase 3: Refinement and Continuous Integration (CI)

1.  **Coverage Analysis:** Run `pytest --cov=llmcord` to identify gaps.
2.  **Add More Tests:** Incrementally improve coverage based on analysis and new features.
3.  **Continuous Integration (CI) - Multi-OS:**
    *   **Platform:** GitHub Actions (`.github/workflows/python-tests.yml`).
    *   **Triggers:** `push` to `main`, `pull_request` to `main`.
    *   **Strategy:** Use a matrix to test on:
        *   OS: `ubuntu-latest`, `windows-latest`, `macos-latest`
        *   Python: `3.10`, `3.11` (or agreed versions)
    *   **Fail Fast:** `fail-fast: false` (to get results from all matrix jobs).
    *   **Steps:**
        *   Checkout code (`actions/checkout`).
        *   Setup Python (`actions/setup-python`).
        *   Install dependencies (`requirements.txt`, `requirements-dev.txt`).
        *   Run tests (`pytest --cov=llmcord --cov-report=xml`).
        *   (Optional) Upload coverage report (`codecov/codecov-action`).

## Visual Plan

```mermaid
graph TD
    subgraph Phase 1: Setup
        A[Create tests/ dir] --> B(Add requirements-dev.txt);
        B --> C(Configure pytest);
        C --> D(Create Core Fixtures in conftest.py);
    end

    subgraph Phase 2: Initial Tests
        E[Test config.py]
        F[Test bot.py Core]
        G[Test providers/]
        H[Test memory/]
        I[Test utils/]
        J[Test reasoning/]
    end

    subgraph Phase 3: Refinement & CI
        K[Run Coverage Analysis] --> L(Add More Tests);
        M[Setup CI Workflow - Multi OS] --> N(Run Tests Automatically);
        L --> K;
    end

    D --> E;
    D --> F;
    D --> G;
    D --> H;
    D --> I;
    D --> J;

    E & F & G & H & I & J --> K;
    E & F & G & H & I & J --> M;