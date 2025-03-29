import pytest
import pytest_asyncio # Although asyncio_mode=auto, explicit import can be good practice
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
import discord # Import the actual library for spec and type hints
import httpx # Import for httpx client fixture

# Import necessary components from the llmcord project
from llmcord.config import Config
from llmcord.bot import LLMCordBot
from llmcord.commands.memory_commands import MemoryCommandHandler
from llmcord.providers.base import LLMProvider
from llmcord.memory.storage import MemoryStorage
from llmcord.memory.suggestions import MemorySuggestionProcessor
from llmcord.utils.rate_limit import RateLimiter
from llmcord.reasoning.manager import ReasoningManager
from llmcord.utils.slash_commands import SlashCommandHandler


@pytest.fixture
def mock_config(mocker):
    """
    Provides a mocked Config instance that can be easily manipulated
    in tests without loading the actual config file.
    """
    # Create a mock instance of Config
    mock_cfg = mocker.MagicMock(spec=Config)

    # Use a dictionary to store mock config values
    mock_values = {}

    # Define a side effect for the 'get' method
    def get_side_effect(key, default=None):
        # Split key for nested access if needed, e.g., "memory.enabled"
        keys = key.split('.')
        value = mock_values
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            return default

    # Define a side effect for the 'load' method (optional, can just be no-op)
    def load_side_effect(filepath):
        # In tests, we usually set values directly, so load might do nothing
        # Or it could load from a predefined test dictionary if needed
        pass

    # Apply the side effects to the mock
    mock_cfg.get.side_effect = get_side_effect
    mock_cfg.load.side_effect = load_side_effect

    # Add a helper method to the mock for easily setting values in tests
    def set_value(key, value):
        keys = key.split('.')
        d = mock_values
        for k in keys[:-1]:
            d = d.setdefault(k, {})
        d[keys[-1]] = value

    mock_cfg.set_value = set_value
    mock_cfg._test_values = mock_values # Expose for direct inspection if needed

    # Reset the internal dictionary for each test
    mock_values.clear()

    # Set some common defaults that might be expected
    mock_cfg.set_value("allow_dms", True)
    mock_cfg.set_value("permissions", {})
    mock_cfg.set_value("model", "mock-model")
    mock_cfg.set_value("memory.enabled", False)
    mock_cfg.set_value("multimodel.enabled", False)
    mock_cfg.set_value("rate_limit.enabled", False)
    mock_cfg.set_value("use_plain_responses", False)


    return mock_cfg

# --- Discord Object Fixtures ---

@pytest.fixture
def mock_discord_user(mocker):
    """Provides a mocked discord.User."""
    mock = mocker.MagicMock(spec=discord.User)
    mock.id = 123456789012345678
    mock.name = "TestUser"
    mock.discriminator = "1234"
    mock.display_name = "TestUser"
    mock.mention = f"<@{mock.id}>"
    mock.bot = False
    return mock

@pytest.fixture
def mock_discord_role(mocker):
    """Provides a mocked discord.Role."""
    mock = mocker.MagicMock(spec=discord.Role)
    mock.id = 987654321098765432
    mock.name = "TestRole"
    mock.mention = f"<@&{mock.id}>"
    return mock

@pytest.fixture
def mock_discord_channel(mocker):
    """Provides a mocked discord.TextChannel."""
    mock = mocker.MagicMock(spec=discord.TextChannel)
    mock.id = 112233445566778899
    mock.name = "test-channel"
    mock.mention = f"<#{mock.id}>"
    mock.type = discord.ChannelType.text
    mock.send = AsyncMock(spec=discord.TextChannel.send)
    mock.typing = MagicMock() # Context manager for typing indicator
    # Mock the __aenter__ and __aexit__ methods for the context manager
    mock.typing.return_value.__aenter__ = AsyncMock(return_value=None)
    mock.typing.return_value.__aexit__ = AsyncMock(return_value=None)
    # Add parent_id and category_id for permission checks
    mock.parent_id = 998877665544332211
    mock.category_id = 998877665544332211 # Often same as parent for simplicity in tests
    return mock

@pytest.fixture
def mock_discord_guild(mocker):
    """Provides a mocked discord.Guild."""
    mock = mocker.MagicMock(spec=discord.Guild)
    mock.id = 555555555555555555
    mock.name = "Test Guild"
    return mock

@pytest.fixture
def mock_discord_member(mocker, mock_discord_user, mock_discord_role, mock_discord_guild):
    """Provides a mocked discord.Member inheriting from mock_discord_user."""
    # Use the mock_discord_user as the base
    mock = mock_discord_user
    # Add Member specific attributes/methods
    mock.__class__ = discord.Member # Make it look like a Member
    mock.roles = [mock_discord_role] # List of roles
    mock.guild = mock_discord_guild
    mock.display_name = "TestMemberNickname" # Can differ from user.name
    return mock

@pytest.fixture
def mock_discord_message(mocker, mock_discord_member, mock_discord_channel):
    """Provides a mocked discord.Message."""
    mock = mocker.MagicMock(spec=discord.Message)
    mock.id = 101010101010101010
    mock.content = "Hello bot!"
    mock.author = mock_discord_member
    mock.channel = mock_discord_channel
    mock.guild = mock_discord_member.guild # Message guild comes from author member
    mock.attachments = []
    mock.mentions = []
    mock.reference = None # No reply by default
    mock.reply = AsyncMock(spec=discord.Message.reply)
    mock.edit = AsyncMock(spec=discord.Message.edit)
    mock.delete = AsyncMock(spec=discord.Message.delete)
    # Add created_at if needed for time-based logic
    # mock.created_at = datetime.now(timezone.utc)
    return mock

@pytest.fixture
def mock_discord_client(mocker, mock_discord_user):
    """Provides a mocked discord.Client."""
    mock = mocker.MagicMock(spec=discord.Client)
    mock.user = mock_discord_user # The bot's own user
    mock.user.bot = True # Make sure the client's user is marked as a bot
    mock.user.id = 999999999999999999 # Different ID for the bot
    mock.user.name = "TestBot"
    mock.user.mention = f"<@{mock.user.id}>"

    mock.wait_for = AsyncMock(spec=discord.Client.wait_for)
    mock.get_channel = MagicMock(spec=discord.Client.get_channel)
    mock.get_guild = MagicMock(spec=discord.Client.get_guild)
    mock.get_user = MagicMock(spec=discord.Client.get_user)
    mock.fetch_channel = AsyncMock(spec=discord.Client.fetch_channel)
    mock.fetch_guild = AsyncMock(spec=discord.Client.fetch_guild)
    mock.fetch_user = AsyncMock(spec=discord.Client.fetch_user)
    # Add http mock needed by CommandTree init
    mock.http = AsyncMock(spec=discord.http.HTTPClient)
    # Add _connection mock needed by CommandTree init
    mock._connection = AsyncMock(spec=discord.state.ConnectionState)
    # Add _command_tree attribute to the connection mock state
    mock._connection._command_tree = None # CommandTree checks if it's None

    # Mock the interaction tree if needed for slash commands later
    mock.tree = AsyncMock(spec=discord.app_commands.CommandTree)
    mock.tree.sync = AsyncMock(return_value=[]) # Return empty list for synced commands
    mock.tree.get_commands = MagicMock(return_value=[])

    return mock

# --- LLMCord Component Fixtures ---

@pytest.fixture
def mock_httpx_client(mocker):
    """Provides a mocked httpx.AsyncClient."""
    mock = mocker.MagicMock(spec=httpx.AsyncClient)
    mock.get = AsyncMock()
    mock.post = AsyncMock()
    # Add other methods like put, delete, stream if needed
    return mock

@pytest.fixture
def mock_llm_provider(mocker):
    """Provides a mocked LLM Provider (BaseProvider)."""
    mock = mocker.MagicMock(spec=LLMProvider)
    # Mock the primary method used by the bot
    mock.generate_stream = AsyncMock()
    # Set a default return value for the async generator
    async def default_stream(*args, **kwargs):
        yield "Test response chunk 1", None
        yield "Test response chunk 2", "stop" # Example finish reason
    mock.generate_stream.side_effect = default_stream
    return mock

@pytest.fixture
def mock_memory_storage(mocker):
    """Provides a mocked MemoryStorage."""
    mock = mocker.MagicMock(spec=MemoryStorage)
    mock.enabled = True # Assume enabled by default for most tests
    mock.get_user_memory = AsyncMock(return_value="Existing memory.")
    mock.save_user_memory = AsyncMock(return_value=True)
    mock.delete_user_memory = AsyncMock(return_value=True)
    mock.append_memory = AsyncMock(return_value=True)
    mock.edit_memory = AsyncMock(return_value=True)
    mock.init_db = AsyncMock() # Add mock for init_db if needed
    # Add mocks for methods causing AttributeErrors in test_storage.py
    mock.add_memory = AsyncMock(return_value=1) # Assuming it returns an ID
    mock.delete_memory = AsyncMock(return_value=True)
    mock.delete_all_memory = AsyncMock(return_value=1) # Assuming it returns count deleted
    return mock
    mock = mocker.MagicMock(spec=MemoryStorage)
    mock.init_db = AsyncMock()
    mock.add_memory = AsyncMock()
    mock.fetch_memories = AsyncMock(return_value=[]) # Return empty list by default
    mock.delete_memory = AsyncMock()
    mock.delete_all_memory = AsyncMock()
    return mock

@pytest.fixture
def mock_memory_processor(mocker, mock_memory_storage, mock_config):
    """Provides a mocked MemorySuggestionProcessor."""
    # Note: This often doesn't need much mocking itself if its dependencies
    # (config, storage) are mocked. We mock the class instance.
    mock = mocker.MagicMock(spec=MemorySuggestionProcessor)
    # Configure the 'enabled' attribute using PropertyMock
    type(mock).enabled = PropertyMock(return_value=mock_config.get("memory.enabled", False))
    mock.generate_suggestions = AsyncMock(return_value="Mocked suggestions.") # Example return
    mock.process_command = AsyncMock(return_value="Mocked command response.") # Example return
    return mock

@pytest.fixture
def mock_rate_limiter(mocker):
    """Provides a mocked RateLimiter."""
    mock = mocker.MagicMock(spec=RateLimiter)
    # Default to allowing requests
    mock.check_rate_limit = AsyncMock(return_value=(True, None)) # (allowed, reason)
    mock.get_cooldown_remaining = MagicMock(return_value=0.0)
    return mock

@pytest.fixture
def mock_reasoning_manager(mocker, mock_config, mock_rate_limiter):
    """Provides a mocked ReasoningManager."""
    mock = mocker.MagicMock(spec=ReasoningManager)
    type(mock).config = PropertyMock(return_value=mock_config) # Link mock config
    mock.is_enabled = MagicMock(return_value=False) # Default to disabled
    mock.should_notify_user = MagicMock(return_value=False)
    mock.check_response_for_signal = MagicMock(return_value=False)
    mock.get_reasoning_signal = MagicMock(return_value="[REASON]")
    mock.check_rate_limit = AsyncMock(return_value=(True, 0.0)) # (allowed, cooldown)
    # Mock the generator similar to the main provider
    mock.generate_reasoning_response = AsyncMock()
    async def default_reasoning_stream(*args, **kwargs):
        yield "Reasoning chunk 1", None
        yield "Reasoning chunk 2", "stop"
    mock.generate_reasoning_response.side_effect = default_reasoning_stream
    return mock

@pytest.fixture
def mock_slash_handler(mocker, llmcord_bot_instance): # Depends on a bot instance
    """Provides a mocked SlashCommandHandler."""
    mock = mocker.MagicMock(spec=SlashCommandHandler)
    # Add the 'bot' attribute, linking to the bot instance
    mock.bot = llmcord_bot_instance
    # Mock the methods that are decorated as commands
    mock.setup = MagicMock()
    # Use the tree from the bot's mocked discord client
    mock.tree = llmcord_bot_instance.discord_client.tree
    # Ensure the client's tree has add_command mocked for setup testing
    # This might be redundant if the client fixture already mocks it, but ensures safety
    if not isinstance(mock.tree.add_command, MagicMock):
         mock.tree.add_command = MagicMock()
    return mock

@pytest.fixture
def mock_memory_command_handler(mocker):
    """Provides a mocked MemoryCommandHandler."""
    mock = mocker.MagicMock(spec=MemoryCommandHandler)
    mock.handle_legacy_command = AsyncMock()
    # Add mocks for other methods if needed by tests
    return mock

    mock.ping_command = AsyncMock()
    mock.help_command = AsyncMock()
    mock.info_command = AsyncMock()
    mock.reset_command = AsyncMock()
    # Use the tree from the bot's mocked discord client
    mock.tree = llmcord_bot_instance.discord_client.tree
    # Ensure the client's tree has add_command mocked for setup testing
    if not isinstance(mock.tree.add_command, MagicMock):
         mock.tree.add_command = MagicMock() # Add if not already mocked by client fixture
    return mock

# --- Intermediate fixture for bot instance needed by slash handler ---
# This avoids circular dependency: llmcord_bot needs mock_slash_handler,
# but mock_slash_handler needs the bot instance.

@pytest.fixture
def llmcord_bot_instance(mocker, mock_config, mock_discord_client, mock_httpx_client,
                         mock_llm_provider, mock_memory_storage, # Removed mock_memory_processor
                         mock_rate_limiter, mock_reasoning_manager,
                         mock_memory_command_handler): # Added mock_memory_command_handler
                         # Removed mock_slash_handler dependency
    """Provides a basic LLMCordBot instance without the slash handler assigned yet."""
    # Patch dependencies needed for basic bot instantiation
    with patch('llmcord.bot.Config', return_value=mock_config), \
         patch('llmcord.bot.discord.Client', return_value=mock_discord_client), \
         patch('llmcord.bot.httpx.AsyncClient', return_value=mock_httpx_client), \
         patch('llmcord.bot.ProviderFactory.create_provider', return_value=mock_llm_provider), \
         patch('llmcord.bot.MemoryStorage', return_value=mock_memory_storage), \
         patch('llmcord.bot.RateLimiter', return_value=mock_rate_limiter), \
         patch('llmcord.bot.ReasoningManager', return_value=mock_reasoning_manager):
         # Note: SlashCommandHandler is NOT patched here

            bot = LLMCordBot()
            # Manually assign mocks
            bot.config = mock_config
            bot.discord_client = mock_discord_client
            bot.httpx_client = mock_httpx_client
            bot.llm_provider = mock_llm_provider
            bot.memory_store = mock_memory_storage
            # Removed bot.memory_processor assignment
            bot.rate_limiter = mock_rate_limiter
            bot.reasoning_manager = mock_reasoning_manager
            bot.memory_command_handler = mock_memory_command_handler # Assign the mock
            bot.slash_handler = None # Explicitly None here, assigned in llmcord_bot fixture
            return bot


# --- Main Bot Fixture (Updated) ---
# Now depends on llmcord_bot_instance and mock_slash_handler

@pytest_asyncio.fixture
async def llmcord_bot(llmcord_bot_instance, mock_slash_handler):
    """
    Provides a fully initialized LLMCordBot instance with mocked dependencies,
    including the slash handler.
    """
    bot = llmcord_bot_instance
    # Assign the slash handler mock to the bot instance
    bot.slash_handler = mock_slash_handler

    # Patch SlashCommandHandler lookup specifically for the llmcord_bot context
    # This ensures that if LLMCordBot() itself tries to instantiate SlashCommandHandler,
    # it gets our mock. This might be redundant if the instance is passed correctly,
    # but provides extra safety.
    with patch('llmcord.bot.SlashCommandHandler', return_value=mock_slash_handler):
        # No need to re-create the bot, just yield the instance
        yield bot

        # Teardown can happen here if needed after the test runs