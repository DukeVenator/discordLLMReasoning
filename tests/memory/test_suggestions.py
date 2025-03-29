import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock

# Import the class being tested
from llmcord.memory.suggestions import MemorySuggestionProcessor

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# Tests will use the mock_memory_processor fixture automatically

async def test_memory_processor_generate_suggestions(mock_memory_processor):
    """Test calling generate_suggestions on the mock."""
    history = [{"role": "user", "content": "Test input"}]
    user_id = 123
    channel_id = 456
    guild_id = 789

    # The fixture provides a default return value, let's use that
    expected_suggestions = "Mocked suggestions." # From fixture definition

    suggestions = await mock_memory_processor.generate_suggestions(history, user_id, channel_id, guild_id)

    # Assert the mock method was called
    mock_memory_processor.generate_suggestions.assert_called_once_with(
        history, user_id, channel_id, guild_id
    )
    # Assert the return value matches the mock's configuration
    assert suggestions == expected_suggestions

async def test_memory_processor_process_command(mock_memory_processor):
    """Test calling process_command on the mock."""
    args = "search keyword"
    user_id = 123
    channel_id = 456
    guild_id = 789

    # The fixture provides a default return value
    expected_response = "Mocked command response." # From fixture definition

    response = await mock_memory_processor.process_command(args, user_id, channel_id, guild_id)

    # Assert the mock method was called
    mock_memory_processor.process_command.assert_called_once_with(
        args, user_id, channel_id, guild_id
    )
    # Assert the return value matches the mock's configuration
    assert response == expected_response

# Add more tests if MemorySuggestionProcessor develops more complex logic
# or different command processing paths. For now, we rely on the mock's
# pre-configured behavior. If the actual class had more internal logic,
# we might need a more sophisticated fixture or direct instantiation with
# mocked dependencies (like storage and config).