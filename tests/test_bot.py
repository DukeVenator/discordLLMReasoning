import pytest
import pytest_asyncio
from unittest.mock import MagicMock, AsyncMock, call, patch
from unittest.mock import MagicMock, AsyncMock, call, ANY
import time
import discord # Import for type hints and enums

# Import the bot class and fixtures
from llmcord.bot import LLMCordBot, COMMAND_PREFIX
# Fixtures like llmcord_bot, mock_config, mock_discord_message etc. are automatically available from conftest.py

# Mark all tests in this module as asyncio
pytestmark = pytest.mark.asyncio

# --- Basic Initialization Test ---

async def test_bot_initialization(llmcord_bot):
    """Test that the llmcord_bot fixture provides a bot instance."""
    assert isinstance(llmcord_bot, LLMCordBot)
    assert llmcord_bot.config is not None
    assert llmcord_bot.discord_client is not None
    # Add more basic checks if needed

# --- has_permission Tests ---

async def test_has_permission_allow_all_default(llmcord_bot, mock_discord_message):
    """Test default behavior: allow all users/channels when no restrictions are set."""
    # Ensure config has default empty permissions
    mock_config = llmcord_bot.config
    mock_config.set_value("permissions", {})
    mock_config.set_value("allow_dms", True)

    # Test in a guild channel
    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is True

    # Test in DMs
    mock_discord_message.channel.type = discord.ChannelType.private
    mock_discord_message.guild = None # No guild in DMs
    mock_discord_message.author.__class__ = discord.User # Author is User in DMs
    mock_discord_message.author.roles = [] # No roles in DMs
    assert await llmcord_bot.has_permission(mock_discord_message) is True

async def test_has_permission_block_dms(llmcord_bot, mock_discord_message):
    """Test blocking DMs via config."""
    mock_config = llmcord_bot.config
    mock_config.set_value("permissions", {})
    mock_config.set_value("allow_dms", False)

    # Test in DMs - should be blocked
    mock_discord_message.channel.type = discord.ChannelType.private
    mock_discord_message.guild = None
    mock_discord_message.author.__class__ = discord.User
    mock_discord_message.author.roles = []
    assert await llmcord_bot.has_permission(mock_discord_message) is False

    # Test in a guild channel - should still be allowed
    # Need to reset the message author/channel type for guild context
    # (Fixtures might need adjustment for easier context switching or use separate message fixtures)
    # For now, assume message fixture is reset or re-fetched if needed per test scope.
    # Let's manually reset parts of the mock message for this test:
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.guild = MagicMock(spec=discord.Guild) # Re-add guild
    mock_discord_message.author.__class__ = discord.Member # Re-set author type
    mock_discord_message.author.roles = [MagicMock(spec=discord.Role)] # Re-add roles
    assert await llmcord_bot.has_permission(mock_discord_message) is True


async def test_has_permission_allowed_user(llmcord_bot, mock_discord_message):
    """Test allowing a specific user ID."""
    mock_config = llmcord_bot.config
    allowed_user_id = mock_discord_message.author.id
    mock_config.set_value("permissions", {"users": {"allowed_ids": [allowed_user_id]}})
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is True

async def test_has_permission_blocked_user(llmcord_bot, mock_discord_message):
    """Test blocking a specific user ID."""
    mock_config = llmcord_bot.config
    blocked_user_id = mock_discord_message.author.id
    mock_config.set_value("permissions", {"users": {"blocked_ids": [blocked_user_id]}})
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False

async def test_has_permission_allowed_role(llmcord_bot, mock_discord_message):
    """Test allowing a specific role ID."""
    mock_config = llmcord_bot.config
    # Ensure the mock message author has roles
    if not hasattr(mock_discord_message.author, 'roles') or not mock_discord_message.author.roles:
         mock_discord_message.author.roles = [MagicMock(spec=discord.Role, id=987654321)]
    allowed_role_id = mock_discord_message.author.roles[0].id
    mock_config.set_value("permissions", {"roles": {"allowed_ids": [allowed_role_id]}})
    mock_config.set_value("allow_dms", True) # Roles don't apply to DMs anyway

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is True

async def test_has_permission_blocked_role(llmcord_bot, mock_discord_message):
    """Test blocking a specific role ID."""
    mock_config = llmcord_bot.config
    # Ensure the mock message author has roles
    if not hasattr(mock_discord_message.author, 'roles') or not mock_discord_message.author.roles:
         mock_discord_message.author.roles = [MagicMock(spec=discord.Role, id=987654321)]
    blocked_role_id = mock_discord_message.author.roles[0].id
    mock_config.set_value("permissions", {"roles": {"blocked_ids": [blocked_role_id]}})
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False

async def test_has_permission_allowed_channel(llmcord_bot, mock_discord_message):
    """Test allowing a specific channel ID."""
    mock_config = llmcord_bot.config
    allowed_channel_id = mock_discord_message.channel.id
    mock_config.set_value("permissions", {"channels": {"allowed_ids": [allowed_channel_id]}})
    mock_config.set_value("allow_dms", True) # Channel settings don't apply to DMs

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is True

async def test_has_permission_blocked_channel(llmcord_bot, mock_discord_message):
    """Test blocking a specific channel ID."""
    mock_config = llmcord_bot.config
    blocked_channel_id = mock_discord_message.channel.id
    mock_config.set_value("permissions", {"channels": {"blocked_ids": [blocked_channel_id]}})
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False

async def test_has_permission_blocked_channel_parent(llmcord_bot, mock_discord_message):
    """Test blocking a channel by its parent/category ID."""
    mock_config = llmcord_bot.config
    blocked_parent_id = mock_discord_message.channel.parent_id
    mock_config.set_value("permissions", {"channels": {"blocked_ids": [blocked_parent_id]}})
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False

async def test_has_permission_user_allow_overrides_role_block(llmcord_bot, mock_discord_message):
    """Test that a specific user allow overrides a role block."""
    mock_config = llmcord_bot.config
    user_id = mock_discord_message.author.id
    # Ensure the mock message author has roles
    if not hasattr(mock_discord_message.author, 'roles') or not mock_discord_message.author.roles:
         mock_discord_message.author.roles = [MagicMock(spec=discord.Role, id=987654321)]
    role_id = mock_discord_message.author.roles[0].id
    mock_config.set_value("permissions", {
        "users": {"allowed_ids": [user_id]},
        "roles": {"blocked_ids": [role_id]}
    })
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False

async def test_has_permission_user_block_overrides_role_allow(llmcord_bot, mock_discord_message):
    """Test that a specific user block overrides a role allow."""
    mock_config = llmcord_bot.config
    user_id = mock_discord_message.author.id
    # Ensure the mock message author has roles
    if not hasattr(mock_discord_message.author, 'roles') or not mock_discord_message.author.roles:
         mock_discord_message.author.roles = [MagicMock(spec=discord.Role, id=987654321)]
    role_id = mock_discord_message.author.roles[0].id
    mock_config.set_value("permissions", {
        "users": {"blocked_ids": [user_id]},
        "roles": {"allowed_ids": [role_id]}
    })
    mock_config.set_value("allow_dms", True)

    mock_discord_message.channel.type = discord.ChannelType.text
    assert await llmcord_bot.has_permission(mock_discord_message) is False


# --- on_message Basic Filtering Tests ---

async def test_on_message_ignore_bots(llmcord_bot, mock_discord_message):
    """Test that messages from bots are ignored."""
    mock_discord_message.author.bot = True
    # We need to spy on process_message to ensure it wasn't called
    llmcord_bot.process_message = AsyncMock()
    # Also spy on rate limiter check to ensure it's not called for bots
    llmcord_bot.rate_limiter.check_rate_limit = AsyncMock()

    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_ignore_no_mention_or_reply(llmcord_bot, mock_discord_message):
    """Test ignoring messages in guilds without mention or reply."""
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.mentions = [] # No mentions
    mock_discord_message.reference = None # No reply
    llmcord_bot.process_message = AsyncMock()
    # Ensure rate limiter allows the message initially
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot for this test run
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once()
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called() # Should still be ignored

async def test_on_message_allow_mention(llmcord_bot, mock_discord_message):
    """Test allowing messages in guilds with a mention."""
    mock_discord_message.channel.type = discord.ChannelType.text
    # Ensure the bot's user is in mentions
    mock_discord_message.mentions = [llmcord_bot.discord_client.user]
    mock_discord_message.reference = None
    # Mock has_permission to return True for this test
    llmcord_bot.has_permission = AsyncMock(return_value=True)
    llmcord_bot.process_message = AsyncMock()
    # Ensure rate limiter allows
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once()
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.has_permission.assert_called_once_with(mock_discord_message)
    llmcord_bot.process_message.assert_called_once_with(mock_discord_message)

async def test_on_message_allow_reply(llmcord_bot, mock_discord_message):
    """Test allowing messages in guilds that are replies."""
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.mentions = []
    # Set a mock reference
    mock_discord_message.reference = MagicMock(spec=discord.MessageReference)
    llmcord_bot.has_permission = AsyncMock(return_value=True)
    llmcord_bot.process_message = AsyncMock()
    # Ensure rate limiter allows
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once()
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.has_permission.assert_called_once_with(mock_discord_message)
    llmcord_bot.process_message.assert_called_once_with(mock_discord_message)

async def test_on_message_allow_dm(llmcord_bot, mock_discord_message):
    """Test allowing messages in DMs."""
    mock_discord_message.channel.type = discord.ChannelType.private
    mock_discord_message.guild = None
    mock_discord_message.author.__class__ = discord.User
    mock_discord_message.author.roles = []
    mock_discord_message.mentions = []
    mock_discord_message.reference = None
    llmcord_bot.has_permission = AsyncMock(return_value=True) # Assume allowed by default DM setting
    llmcord_bot.process_message = AsyncMock()
    # Ensure rate limiter allows
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once()
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.has_permission.assert_called_once_with(mock_discord_message)
    llmcord_bot.process_message.assert_called_once_with(mock_discord_message)


async def test_on_message_block_permission_denied(llmcord_bot, mock_discord_message):
    """Test blocking messages when has_permission returns False."""
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.mentions = [llmcord_bot.discord_client.user] # Ensure it would normally process
    # Mock has_permission to return False
    llmcord_bot.has_permission = AsyncMock(return_value=False)
    llmcord_bot.process_message = AsyncMock()
    # Ensure rate limiter allows initially
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once()
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.has_permission.assert_called_once_with(mock_discord_message)
    llmcord_bot.process_message.assert_not_called() # Should be blocked by permission


# --- on_message Rate Limiting Tests ---

async def test_on_message_rate_limit_user_hit(llmcord_bot, mock_discord_message):
    """Test behavior when user rate limit is hit."""
    # Configure rate limiter mock
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (False, "user") # Blocked, reason: user
    llmcord_bot.rate_limiter.get_cooldown_remaining.return_value = 5.5 # 5.5s cooldown

    # Spy on process_message and message.reply
    llmcord_bot.process_message = AsyncMock()
    mock_discord_message.reply = AsyncMock()
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    # Assertions
    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once_with(mock_discord_message.author.id)
    llmcord_bot.rate_limiter.get_cooldown_remaining.assert_called_once_with(mock_discord_message.author.id)
    # Check that reply was called with the correct message format
    mock_discord_message.reply.assert_called_once()
    args, kwargs = mock_discord_message.reply.call_args
    assert "User rate limit reached" in args[0]
    assert "wait 5.5 seconds" in args[0]
    assert kwargs.get("mention_author") is False
    assert kwargs.get("delete_after") == 5.5 # Should be max(5.0, min(5.5, 15.0))
    # Ensure processing did not continue
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_rate_limit_global_hit(llmcord_bot, mock_discord_message):
    """Test behavior when global rate limit is hit."""
    # Configure rate limiter mock
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (False, "global") # Blocked, reason: global
    llmcord_bot.rate_limiter.get_cooldown_remaining.return_value = 12.3 # 12.3s cooldown

    # Spy on process_message and message.reply
    llmcord_bot.process_message = AsyncMock()
    mock_discord_message.reply = AsyncMock()
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    # Assertions
    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once_with(mock_discord_message.author.id)
    llmcord_bot.rate_limiter.get_cooldown_remaining.assert_called_once_with(mock_discord_message.author.id)
    # Check reply
    mock_discord_message.reply.assert_called_once()
    args, kwargs = mock_discord_message.reply.call_args
    assert "Global rate limit reached" in args[0]
    assert "wait 12.3 seconds" in args[0]
    assert kwargs.get("mention_author") is False
    assert kwargs.get("delete_after") == 12.3 # Should be max(5.0, min(12.3, 15.0))
    # Ensure processing did not continue
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_rate_limit_reply_fails(llmcord_bot, mock_discord_message, mocker):
    """Test that processing stops even if sending the rate limit reply fails."""
    # Configure rate limiter mock
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (False, "user")
    llmcord_bot.rate_limiter.get_cooldown_remaining.return_value = 5.0

    # Make message.reply raise an exception (e.g., Forbidden)
    mock_discord_message.reply = AsyncMock(side_effect=discord.Forbidden(MagicMock(), "Missing permissions"))

    # Spy on process_message
    llmcord_bot.process_message = AsyncMock()
    # Spy on the module-level logger
    mock_log_warning = mocker.patch('llmcord.bot.log.warning')
    # Spy command handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    # Assertions
    llmcord_bot.rate_limiter.check_rate_limit.assert_called_once_with(mock_discord_message.author.id)
    mock_discord_message.reply.assert_called_once() # Reply was attempted
    # Check that the warning was logged (RateLimiter might log first, then the bot)
    assert mock_log_warning.call_count >= 1 # Ensure it was called at least once
    # Check the *last* call for the specific message about missing permissions
    assert "Missing permissions to send rate limit message" in mock_log_warning.call_args_list[-1][0][0]
    # Ensure processing still stopped
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()


# --- on_message Memory Command Tests ---

async def test_on_message_memory_command_called(llmcord_bot, mock_discord_message):
    """Test that !memory command calls handle_memory_command."""
    llmcord_bot.config.set_value("memory.enabled", True)
    mock_discord_message.content = f"{COMMAND_PREFIX}memory some arguments"
    # Ensure rate limiter allows and basic filtering passes
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    mock_discord_message.channel.type = discord.ChannelType.text # Ensure not ignored
    mock_discord_message.mentions = []
    mock_discord_message.reference = None

    # Spy on handlers
    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.handle_memory_command.assert_called_once_with(mock_discord_message, "some arguments")
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_memory_command_no_args(llmcord_bot, mock_discord_message):
    """Test !memory command with no arguments."""
    llmcord_bot.config.set_value("memory.enabled", True)
    mock_discord_message.content = f"{COMMAND_PREFIX}memory"
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.mentions = []
    mock_discord_message.reference = None

    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.handle_memory_command.assert_called_once_with(mock_discord_message, None)
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_forget_command_called(llmcord_bot, mock_discord_message):
    """Test that !forget command calls handle_forget_command."""
    llmcord_bot.config.set_value("memory.enabled", True)
    mock_discord_message.content = f"{COMMAND_PREFIX}forget" # Forget takes no args in current logic
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.mentions = []
    mock_discord_message.reference = None

    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_called_once_with(mock_discord_message)
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_memory_disabled(llmcord_bot, mock_discord_message):
    """Test that memory commands are ignored if memory is disabled."""
    llmcord_bot.config.set_value("memory.enabled", False)
    mock_discord_message.content = f"{COMMAND_PREFIX}memory some arguments"
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Make sure it would otherwise be processed (e.g., it's a DM or mention)
    mock_discord_message.channel.type = discord.ChannelType.private
    mock_discord_message.guild = None
    mock_discord_message.author.__class__ = discord.User
    mock_discord_message.author.roles = []
    mock_discord_message.mentions = []
    mock_discord_message.reference = None
    llmcord_bot.has_permission = AsyncMock(return_value=True)


    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    # Should proceed to normal processing if memory is disabled
    llmcord_bot.process_message.assert_called_once_with(mock_discord_message)

async def test_on_message_memory_command_with_mention(llmcord_bot, mock_discord_message):
    """Test that !memory command works even with a bot mention."""
    llmcord_bot.config.set_value("memory.enabled", True)
    bot_mention = llmcord_bot.discord_client.user.mention
    mock_discord_message.content = f"{bot_mention} {COMMAND_PREFIX}memory test args"
    mock_discord_message.mentions = [llmcord_bot.discord_client.user] # Mention is present
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    mock_discord_message.channel.type = discord.ChannelType.text
    mock_discord_message.reference = None

    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    # The mention should be stripped before command check
    llmcord_bot.handle_memory_command.assert_called_once_with(mock_discord_message, "test args")
    llmcord_bot.handle_forget_command.assert_not_called()
    llmcord_bot.process_message.assert_not_called()

async def test_on_message_unknown_command(llmcord_bot, mock_discord_message):
    """Test that unknown commands with prefix don't trigger handlers."""
    llmcord_bot.config.set_value("memory.enabled", True)
    mock_discord_message.content = f"{COMMAND_PREFIX}unknowncmd"
    llmcord_bot.rate_limiter.check_rate_limit.return_value = (True, None)
    # Make sure it would otherwise be processed
    mock_discord_message.channel.type = discord.ChannelType.private
    mock_discord_message.guild = None
    mock_discord_message.author.__class__ = discord.User
    mock_discord_message.author.roles = []
    mock_discord_message.mentions = []
    mock_discord_message.reference = None
    llmcord_bot.has_permission = AsyncMock(return_value=True)

    llmcord_bot.handle_memory_command = AsyncMock()
    llmcord_bot.handle_forget_command = AsyncMock()
    llmcord_bot.process_message = AsyncMock()

    # Explicitly ensure author is not a bot
    mock_discord_message.author.bot = False
    await llmcord_bot.on_message(mock_discord_message)

    # No memory handlers called
    llmcord_bot.handle_memory_command.assert_not_called()
    llmcord_bot.handle_forget_command.assert_not_called()
    # Should proceed to normal processing
    llmcord_bot.process_message.assert_called_once_with(mock_discord_message)


# --- process_message Tests ---

async def test_process_message_basic_flow(llmcord_bot, mock_discord_message):
    """Test the basic flow of process_message without reasoning."""
    # Mock internal methods called by process_message
    llmcord_bot.build_message_history = AsyncMock(return_value=([{"role": "user", "content": "Hello"}], set()))
    llmcord_bot.prepare_system_prompt = AsyncMock(return_value="System prompt")
    llmcord_bot.update_discord_response = AsyncMock(return_value=([], [], None, 0.0)) # response_msgs, response_contents, edit_task, last_task_time

    # Configure LLM provider mock's generate_stream (which is already an AsyncMock via fixture)
    # Set its side_effect to be the async generator function itself.
    async def async_iterator_gen(*args, **kwargs): # The async generator function
        # Yield the expected data structure
        yield ("Response chunk 1", None)
        yield ("Response chunk 2", "stop")
    llmcord_bot.llm_provider.generate_stream.side_effect = async_iterator_gen


    # Configure reasoning manager mock (ensure it's disabled or doesn't trigger)
    llmcord_bot.reasoning_manager.is_enabled.return_value = False
    llmcord_bot.reasoning_manager.check_response_for_signal.return_value = False

    # Call the method under test
    await llmcord_bot.process_message(mock_discord_message)

# Assertions
    llmcord_bot.build_message_history.assert_called_once_with(mock_discord_message)
    llmcord_bot.prepare_system_prompt.assert_called_once_with(mock_discord_message.author, include_reasoning_signal_instruction=True)
    # Check if the method was called, even if await tracking failed
    llmcord_bot.llm_provider.generate_stream.assert_called_once_with(
        [{"role": "user", "content": "Hello"}], # History from build_message_history
        system_prompt="System prompt"          # Prompt from prepare_system_prompt
    )
    # Check that update_discord_response was called for each chunk + final state
    assert llmcord_bot.update_discord_response.call_count == 2 # Once per chunk
    llmcord_bot.update_discord_response.assert_has_calls([
        call(mock_discord_message, "Response chunk 1", None, ANY, ANY, ANY, ANY, ANY),
        call(mock_discord_message, "Response chunk 2", "stop", ANY, ANY, ANY, ANY, ANY),
    ])
    # Ensure reasoning manager methods weren't called inappropriately
    # (check_response_for_signal should NOT be called when reasoning is disabled)
    llmcord_bot.reasoning_manager.check_response_for_signal.assert_not_called()
    llmcord_bot.reasoning_manager.generate_reasoning_response.assert_not_called()


async def test_process_message_with_reasoning_triggered(llmcord_bot, mock_discord_message):
    """Test the flow when reasoning is enabled and triggered."""
    # Mock internal methods
    llmcord_bot.build_message_history = AsyncMock(return_value=([{"role": "user", "content": "Complex question"}], set()))
    # Mock prepare_system_prompt to be called twice (once for default, once for reasoning)
    llmcord_bot.prepare_system_prompt = AsyncMock(side_effect=["System prompt with signal instruction", "System prompt without signal instruction"])
    # Simulate update_discord_response returning some state after the first chunk
    mock_response_msg = AsyncMock(spec=discord.Message)
    llmcord_bot.update_discord_response = AsyncMock(return_value=([mock_response_msg], ["Thinking... [REASON]"], None, time.time()))


    # Configure LLM provider mock for the *initial* response containing the signal
    initial_response_signal = llmcord_bot.reasoning_manager.get_reasoning_signal()
    async def async_iterator_gen_initial(*args, **kwargs):
        yield f"Thinking... {initial_response_signal}", "stop"
    # generate_stream is already an AsyncMock, set its side_effect
    llmcord_bot.llm_provider.generate_stream.side_effect = async_iterator_gen_initial

    # Configure reasoning manager mock
    llmcord_bot.reasoning_manager.is_enabled.return_value = True
    llmcord_bot.reasoning_manager.should_notify_user.return_value = True # Test notification message
    llmcord_bot.reasoning_manager.check_response_for_signal.return_value = True # Signal detected
    llmcord_bot.reasoning_manager.check_rate_limit.return_value = (True, 0.0) # Reasoning allowed

    # Mock the reasoning provider stream using a MagicMock configured as an async iterator
    mock_reasoning_iterator = MagicMock() # Use MagicMock instead of AsyncMock
    reasoning_results = [
        ("Detailed reasoning chunk 1", None),
        ("Detailed reasoning chunk 2", "stop")
    ]
    # Configure __aiter__ to return the mock itself (synchronously)
    mock_reasoning_iterator.__aiter__ = MagicMock(return_value=mock_reasoning_iterator)
    # Configure __anext__ to yield results and then raise StopAsyncIteration (needs to be async)
    mock_reasoning_iterator.__anext__ = AsyncMock(side_effect=[
        *reasoning_results,
        StopAsyncIteration() # Instantiate the exception
    ])
    # Replace the generate_reasoning_response method with a MagicMock that returns the iterator
    llmcord_bot.reasoning_manager.generate_reasoning_response = MagicMock(return_value=mock_reasoning_iterator)

    # Mock the channel.send for the "Thinking deeper..." message
    mock_thinking_msg = AsyncMock(spec=discord.Message)
    mock_thinking_msg.delete = AsyncMock()
    mock_discord_message.channel.send = AsyncMock(return_value=mock_thinking_msg)

    # Call the method under test
    await llmcord_bot.process_message(mock_discord_message)

# Assertions
    llmcord_bot.build_message_history.assert_called_once_with(mock_discord_message)
    # Check prepare_system_prompt calls
    assert llmcord_bot.prepare_system_prompt.call_count == 2
    llmcord_bot.prepare_system_prompt.assert_has_calls([
        call(mock_discord_message.author, include_reasoning_signal_instruction=True),
        call(mock_discord_message.author, include_reasoning_signal_instruction=False) # Called again for reasoning
    ])
    # Check initial LLM call
    llmcord_bot.llm_provider.generate_stream.assert_called_once_with(
        [{"role": "user", "content": "Complex question"}],
        system_prompt="System prompt with signal instruction"
    )
    llmcord_bot.llm_provider.generate_stream.assert_awaited_once() # Check it was awaited
    # Check reasoning manager calls
    llmcord_bot.reasoning_manager.is_enabled.assert_called()
    llmcord_bot.reasoning_manager.check_response_for_signal.assert_called_once()
    llmcord_bot.reasoning_manager.should_notify_user.assert_called_once()
    mock_discord_message.channel.send.assert_called_once_with("🧠 Thinking deeper...") # Check notification
    llmcord_bot.reasoning_manager.check_rate_limit.assert_called_once_with(mock_discord_message.author.id)
    # Check reasoning LLM call
    llmcord_bot.reasoning_manager.generate_reasoning_response.assert_called_once_with(
         [{"role": "user", "content": "Complex question"}],
         system_prompt="System prompt without signal instruction"
    )
    # Check update_discord_response calls (initial stream + reasoning stream)
    # Call count depends on how update_discord_response is mocked, let's check the final stream calls
    assert llmcord_bot.update_discord_response.call_count >= 2 # At least one for initial, one for reasoning
    # Check thinking message deletion
    mock_thinking_msg.delete.assert_called_once()


async def test_process_message_with_reasoning_rate_limited(llmcord_bot, mock_discord_message):
    """Test the flow when reasoning is triggered but rate-limited."""
    # Mock internal methods
    llmcord_bot.build_message_history = AsyncMock(return_value=([{"role": "user", "content": "Complex question"}], set()))
    llmcord_bot.prepare_system_prompt = AsyncMock(return_value="System prompt with signal instruction") # Only called once
    # Mock update_discord_response - crucial for the fallback edit
    mock_final_message = AsyncMock(spec=discord.Message)
    mock_final_message.edit = AsyncMock()
    # Simulate update_discord_response returning the final message object after the initial stream
    llmcord_bot.update_discord_response = AsyncMock(return_value=([mock_final_message], ["Thinking... [REASON]"], None, 0.0))


    # Configure LLM provider mock for the *initial* response containing the signal
    initial_response_signal = llmcord_bot.reasoning_manager.get_reasoning_signal()
    async def async_iterator_gen_rate_limit(*args, **kwargs):
        yield f"Thinking... {initial_response_signal}", "stop"
    # generate_stream is already an AsyncMock, set its side_effect
    llmcord_bot.llm_provider.generate_stream.side_effect = async_iterator_gen_rate_limit

    # Configure reasoning manager mock
    llmcord_bot.reasoning_manager.is_enabled.return_value = True
    llmcord_bot.reasoning_manager.should_notify_user.return_value = False # No notification message
    llmcord_bot.reasoning_manager.check_response_for_signal.return_value = True # Signal detected
    llmcord_bot.reasoning_manager.check_rate_limit.return_value = (False, 10.0) # Reasoning BLOCKED
    llmcord_bot.reasoning_manager.get_reasoning_signal.return_value = initial_response_signal

    # Mock the message.reply for the rate limit warning
    mock_discord_message.reply = AsyncMock()

    # Call the method under test
    await llmcord_bot.process_message(mock_discord_message)

# Assertions
    llmcord_bot.build_message_history.assert_called_once()
    llmcord_bot.prepare_system_prompt.assert_called_once() # Should only be called once
    # Check if the method was called, even if await tracking failed
    llmcord_bot.llm_provider.generate_stream.assert_called_once() # Initial stream runs and was awaited
    # Check reasoning manager calls
    llmcord_bot.reasoning_manager.is_enabled.assert_called()
    llmcord_bot.reasoning_manager.check_response_for_signal.assert_called_once()
    llmcord_bot.reasoning_manager.should_notify_user.assert_called_once()
    llmcord_bot.reasoning_manager.check_rate_limit.assert_called_once()
    llmcord_bot.reasoning_manager.generate_reasoning_response.assert_not_called() # Reasoning stream blocked
    # Check rate limit warning reply
    mock_discord_message.reply.assert_called_once()
    args, kwargs = mock_discord_message.reply.call_args
    assert "Reasoning rate limit reached" in args[0]
    assert "wait 10.0 seconds" in args[0]
    # Check that update_discord_response was called once for the initial stream
    assert llmcord_bot.update_discord_response.call_count == 1
    # Check that the final message was edited to remove the signal (allow multiple calls for now)
    mock_final_message.edit.assert_called()
    edit_args, edit_kwargs = mock_final_message.edit.call_args
    final_embed = edit_kwargs.get("embed")
    assert final_embed is not None
    assert initial_response_signal not in final_embed.description
    assert final_embed.description == "Thinking..." # Signal removed


# --- Tests for build_message_history ---
# These would likely go in a separate file or require more complex fixture setup
# Example skeleton:
# async def test_build_message_history_simple(llmcord_bot, mock_discord_message):
#     llmcord_bot.discord_client.fetch_message = AsyncMock(side_effect=discord.NotFound(MagicMock(), "Not found"))
#     history, warnings = await llmcord_bot.build_message_history(mock_discord_message)
#     assert len(history) == 1
#     assert history[0]["role"] == "user"
#     assert history[0]["content"] == mock_discord_message.content
#     assert not warnings

# async def test_build_message_history_with_reply(llmcord_bot, mock_discord_message):
#     # Setup mock_discord_message.reference and mock fetch_message
#     pass


# --- Tests for prepare_system_prompt ---
# Example skeleton:
# async def test_prepare_system_prompt_basic(llmcord_bot, mock_discord_user):
#     prompt = await llmcord_bot.prepare_system_prompt(mock_discord_user)
#     assert isinstance(prompt, str)
#     # Add checks for expected content based on config


# --- Tests for update_discord_response ---
# These are complex due to timing and message splitting logic
# Example skeleton:
# async def test_update_discord_response_new_message(llmcord_bot, mock_discord_message):
#     # Mock message.reply or channel.send
#     pass

# async def test_update_discord_response_edit_message(llmcord_bot, mock_discord_message):
#     # Mock message.edit
#     pass