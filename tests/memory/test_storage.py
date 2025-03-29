import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, call

# Import the class being tested and potentially related types
from llmcord.memory.storage import MemoryStorage

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# Tests will use the mock_memory_storage fixture automatically

async def test_memory_storage_init_db(mock_memory_storage):
    """Test that init_db is called (or at least mock exists)."""
    # The fixture itself provides the mock. We can test if methods exist.
    assert hasattr(mock_memory_storage, 'init_db')
    # If the fixture called init_db, we could check that, but the
    # llmcord_bot fixture doesn't call it by default.
    # We can call it here to ensure the mock method is awaitable.
    await mock_memory_storage.init_db()
    mock_memory_storage.init_db.assert_called_once()

async def test_memory_storage_add_memory(mock_memory_storage):
    """Test calling add_memory on the mock."""
    user_id = 123
    channel_id = 456
    guild_id = 789
    content = "Test memory content"
    role = "user"

    await mock_memory_storage.add_memory(user_id, channel_id, guild_id, content, role)

    # Assert that the mock's add_memory method was called with the correct args
    mock_memory_storage.add_memory.assert_called_once_with(
        user_id, channel_id, guild_id, content, role
    )

async def test_memory_storage_fetch_memories(mock_memory_storage):
    """Test calling fetch_memories on the mock."""
    user_id = 123
    channel_id = 456
    guild_id = 789
    limit = 10

    # Configure the mock's return value for this test
    mock_return_value = [
        (1, user_id, channel_id, guild_id, "Memory 1", "user", "ts1"),
        (2, user_id, channel_id, guild_id, "Memory 2", "assistant", "ts2"),
    ]
    mock_memory_storage.fetch_memories = AsyncMock(return_value=mock_return_value)

    memories = await mock_memory_storage.fetch_memories(user_id, channel_id, guild_id, limit)

    # Assert the method was called correctly
    mock_memory_storage.fetch_memories.assert_called_once_with(
        user_id, channel_id, guild_id, limit
    )
    # Assert the return value is what we configured
    assert memories == mock_return_value

async def test_memory_storage_fetch_memories_empty(mock_memory_storage):
    """Test fetch_memories when the mock returns an empty list (default)."""
    user_id = 123
    channel_id = 456
    guild_id = 789
    limit = 10

    # Reset mock if needed, or rely on fixture default return value ([])
    mock_memory_storage.fetch_memories = AsyncMock(return_value=[])

    memories = await mock_memory_storage.fetch_memories(user_id, channel_id, guild_id, limit)

    mock_memory_storage.fetch_memories.assert_called_once_with(
        user_id, channel_id, guild_id, limit
    )
    assert memories == []

async def test_memory_storage_delete_memory(mock_memory_storage):
    """Test calling delete_memory on the mock."""
    memory_id = 42
    await mock_memory_storage.delete_memory(memory_id)
    mock_memory_storage.delete_memory.assert_called_once_with(memory_id)

async def test_memory_storage_delete_all_memory(mock_memory_storage):
    """Test calling delete_all_memory on the mock."""
    user_id = 123
    channel_id = 456
    guild_id = 789
    await mock_memory_storage.delete_all_memory(user_id, channel_id, guild_id)
    mock_memory_storage.delete_all_memory.assert_called_once_with(user_id, channel_id, guild_id)

# Add more tests if MemoryStorage develops more complex logic
# e.g., error handling, specific query variations.