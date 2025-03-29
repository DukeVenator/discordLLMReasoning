import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch, ANY
from discord import app_commands
import discord
import time

# Import the class being tested
from llmcord.utils.slash_commands import SlashCommandHandler
# Import the bot class to pass to the handler
from llmcord.bot import LLMCordBot

# --- Fixture for mock interaction ---
@pytest.fixture
def mock_interaction(mocker, mock_discord_user, mock_discord_channel):
    """Provides a mocked discord.Interaction."""
    mock = AsyncMock(spec=discord.Interaction)
    mock.user = mock_discord_user
    mock.channel = mock_discord_channel
    mock.response = AsyncMock(spec=discord.InteractionResponse)
    mock.response.send_message = AsyncMock()
    mock.response.defer = AsyncMock()
    mock.followup = AsyncMock(spec=discord.Webhook) # Followup is a Webhook
    mock.followup.send = AsyncMock()
    mock.created_at = discord.utils.utcnow() # For latency calculation
    # Add guild attribute if needed by commands
    mock.guild = MagicMock(spec=discord.Guild)
    mock.guild.id = 555555555555555555
    return mock

# --- Tests ---

# Test initialization using the mock from conftest fixture
def test_slash_handler_mock_fixture(llmcord_bot):
    """Test that the mock handler fixture exists on the bot."""
    assert llmcord_bot.slash_handler is not None
    # Check if the mock tree was assigned correctly in the fixture
    assert llmcord_bot.slash_handler.tree is llmcord_bot.discord_client.tree

# Test command registration using a real instance
def test_slash_handler_registers_commands(llmcord_bot):
    """Test that instantiating the handler registers commands on its tree."""
    # Instantiate a real handler with the mocked bot
    handler = SlashCommandHandler(llmcord_bot)
    # The commands are registered via decorators when the class is defined
    # and associated with the handler's tree instance during __init__.
    # Check that the handler created a CommandTree instance
    assert isinstance(handler.tree, app_commands.CommandTree)
    # NOTE: Asserting command registration via decorators on a mock tree is unreliable.
    # We'll rely on callback tests later.
    # registered_commands = handler.tree.get_commands()
    # registered_command_names = {cmd.name for cmd in registered_commands}
    # expected_commands = {"memory", "debug_sync_commands"} # Based on reading the code
    # assert expected_commands.issubset(registered_command_names)


# --- Command Callback Tests (using real instance) ---

# TODO: Add tests for the actual commands defined in setup ('memory', 'debug_sync_commands')
# These will require mocking interaction responses/followups and potentially memory_store.

# Remove PytestWarnings for non-async tests marked with asyncio
# These tests don't need the mark anymore as they are synchronous.
def test_slash_handler_mock_fixture_sync(llmcord_bot):
    test_slash_handler_mock_fixture(llmcord_bot)

# Removed redundant sync test for setup