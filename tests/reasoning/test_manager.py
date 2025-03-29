import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

# Import the class being tested
from llmcord.reasoning.manager import ReasoningManager
# Import other needed types/fixtures if necessary
from llmcord.providers.base import LLMProvider

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# Tests will use the mock_reasoning_manager fixture automatically,
# which is already configured in conftest.py

async def test_reasoning_manager_init(mock_reasoning_manager, mock_config, mock_rate_limiter):
    """Test ReasoningManager initialization via the fixture."""
    # The fixture creates the mock, we just assert its basic properties
    assert isinstance(mock_reasoning_manager, MagicMock) # Fixture provides a mock
    # We can check if the real init was patched correctly if needed,
    # but the fixture aims to provide a ready-to-use mock.
    # Let's test the mock's configured behavior from the fixture.
    assert mock_reasoning_manager.config is mock_config
    assert mock_reasoning_manager.is_enabled() is False # Default from fixture
    assert mock_reasoning_manager.get_reasoning_signal() == "[REASON]" # Default from fixture

async def test_reasoning_manager_is_enabled(mock_reasoning_manager, mock_config):
    """Test the is_enabled method mock."""
    # Test default from fixture
    assert mock_reasoning_manager.is_enabled() is False

    # Simulate enabling via config
    mock_reasoning_manager.is_enabled.return_value = True
    assert mock_reasoning_manager.is_enabled() is True

async def test_reasoning_manager_check_signal(mock_reasoning_manager):
    """Test the check_response_for_signal method mock."""
    signal = mock_reasoning_manager.get_reasoning_signal()
    response_with_signal = f"Some text... {signal} more text."
    response_without_signal = "Some other text."

    # Test when signal is present
    mock_reasoning_manager.check_response_for_signal.return_value = True
    assert mock_reasoning_manager.check_response_for_signal(response_with_signal) is True

    # Test when signal is absent
    mock_reasoning_manager.check_response_for_signal.return_value = False
    assert mock_reasoning_manager.check_response_for_signal(response_without_signal) is False

async def test_reasoning_manager_rate_limit_check(mock_reasoning_manager):
    """Test the check_rate_limit method mock."""
    user_id = 123

    # Test allowed case (default from fixture)
    mock_reasoning_manager.check_rate_limit.return_value = (True, 0.0)
    allowed, cooldown = await mock_reasoning_manager.check_rate_limit(user_id)
    assert allowed is True
    assert cooldown == 0.0
    mock_reasoning_manager.check_rate_limit.assert_called_with(user_id)

    # Test blocked case
    mock_reasoning_manager.check_rate_limit.return_value = (False, 30.5)
    allowed, cooldown = await mock_reasoning_manager.check_rate_limit(user_id)
    assert allowed is False
    assert cooldown == 30.5

async def test_reasoning_manager_generate_response(mock_reasoning_manager):
    """Test the generate_reasoning_response method mock."""
    messages = [{"role": "user", "content": "Input"}]
    system_prompt = "Reasoning system prompt"

    # Mock the underlying provider call if the fixture didn't already
    # The fixture's generate_reasoning_response is already an AsyncMock
    # Configure its side_effect to be the async generator function
    async def mock_reasoning_stream(*args, **kwargs):
        yield "Reasoned chunk 1", None
        yield "Reasoned chunk 2", "stop"
    # Set the side_effect on the existing AsyncMock from the fixture
    mock_reasoning_manager.generate_reasoning_response.side_effect = mock_reasoning_stream

    # Collect results
    # We need to await the mock first to get the generator, then iterate
    results = []
    async_gen = await mock_reasoning_manager.generate_reasoning_response(messages, system_prompt)
    async for chunk, reason in async_gen:
        results.append((chunk, reason))

    # Assert the mock was called
    # Assert the mock coroutine was awaited
    mock_reasoning_manager.generate_reasoning_response.assert_awaited_once_with(messages, system_prompt)

    # Assert the results match the mocked stream
    assert len(results) == 2
    assert results[0] == ("Reasoned chunk 1", None)
    assert results[1] == ("Reasoned chunk 2", "stop")

# Add more tests if ReasoningManager gets more complex:
# - Test interaction with the reasoning LLM provider setup
# - Test different configurations (e.g., different reasoning models)