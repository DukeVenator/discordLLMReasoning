import pytest
import pytest_asyncio
import time
from unittest.mock import patch, MagicMock

# Import the class being tested
from llmcord.utils.rate_limit import RateLimiter

# --- RateLimiter Tests ---

# Helper function to configure the mock config's get method
def configure_mock_config_get(mock_config_instance, settings):
    def side_effect(key, default=None):
        return settings.get(key, default)
    mock_config_instance.get.side_effect = side_effect

@patch('llmcord.utils.rate_limit.Config')
def test_rate_limiter_init_default(MockConfig):
    """Test RateLimiter initialization uses default values from Config.get."""
    mock_config_instance = MockConfig.return_value
    # Simulate default values returned by config.get
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True,
        "rate_limits.user_limit": 5,
        "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100,
        "rate_limits.global_period": 60,
        # Add reasoning defaults if needed by init logic tested here
        "rate_limits.reasoning_user_limit": 2,
        "rate_limits.reasoning_user_period": 300,
        "rate_limits.reasoning_global_limit": None, # Default to None
        "rate_limits.reasoning_global_period": None,
    })

    limiter = RateLimiter() # No args!

    assert limiter.enabled is True
    assert limiter.user_limit == 5
    assert limiter.user_period == 60
    assert limiter.global_limit == 100
    assert limiter.global_period == 60
    assert limiter.reasoning_user_limit == 2
    assert limiter.reasoning_user_period == 300
    assert limiter.reasoning_global_limit is None # Check default
    assert not limiter.user_data
    assert limiter.global_request_count == 0
    assert limiter.global_last_request_time == 0.0

@patch('llmcord.utils.rate_limit.Config')
def test_rate_limiter_init_custom(MockConfig):
    """Test RateLimiter initialization with custom values from mocked Config.get."""
    mock_config_instance = MockConfig.return_value
    # Simulate custom values returned by config.get
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True,
        "rate_limits.user_limit": 10,
        "rate_limits.user_period": 120,
        "rate_limits.global_limit": 50,
        "rate_limits.global_period": 30,
        "rate_limits.reasoning_user_limit": 1,
        "rate_limits.reasoning_user_period": 600,
        "rate_limits.reasoning_global_limit": 10,
        "rate_limits.reasoning_global_period": 60,
    })

    limiter = RateLimiter() # No args!

    assert limiter.enabled is True
    assert limiter.user_limit == 10
    assert limiter.user_period == 120
    assert limiter.global_limit == 50
    assert limiter.global_period == 30
    assert limiter.reasoning_user_limit == 1
    assert limiter.reasoning_user_period == 600
    assert limiter.reasoning_global_limit == 10
    assert limiter.reasoning_global_period == 60

@patch('llmcord.utils.rate_limit.Config')
def test_rate_limiter_init_disabled(MockConfig):
    """Test RateLimiter initialization when disabled in config."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {"rate_limits.enabled": False})

    limiter = RateLimiter()
    assert limiter.enabled is False

# We need to control time for rate limit tests
@pytest.fixture
def mock_time(mocker):
    """Fixture to mock time.time used by RateLimiter."""
    # Patch time.time as RateLimiter uses it directly now
    mock = mocker.patch('llmcord.utils.rate_limit.time.time')
    # Start time at a predictable value
    mock.return_value = 1000.0
    return mock

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_user_allow_first(MockConfig, mock_time):
    """Test that the first request for a user is allowed."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 1, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60 # High global limit
    })
    limiter = RateLimiter()
    user_id = 123

    allowed, reason = await limiter.check_rate_limit(user_id)

    assert allowed is True
    assert reason == "ok"
    assert user_id in limiter.user_data
    assert limiter.user_data[user_id].request_count == 1
    assert limiter.user_data[user_id].last_request_time == 1000.0

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_user_block_second(MockConfig, mock_time):
    """Test that the second request is blocked if rate is 1."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 1, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    user_id = 123

    # First request (allowed)
    await limiter.check_rate_limit(user_id)
    assert limiter.user_data[user_id].request_count == 1

    # Second request immediately (should be blocked)
    mock_time.return_value = 1000.1 # Advance time slightly
    allowed, reason = await limiter.check_rate_limit(user_id)

    assert allowed is False
    assert reason == "user"
    # State shouldn't change on blocked request
    assert limiter.user_data[user_id].request_count == 1

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_user_allow_after_period(MockConfig, mock_time):
    """Test that requests are allowed again after the period expires."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 1, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    user_id = 123

    # First request
    await limiter.check_rate_limit(user_id) # time = 1000.0

    # Second request, blocked
    mock_time.return_value = 1001.0
    allowed, reason = await limiter.check_rate_limit(user_id)
    assert allowed is False

    # Third request, after period (60s)
    mock_time.return_value = 1000.0 + 60.0 + 0.1 # 1060.1
    allowed, reason = await limiter.check_rate_limit(user_id)

    assert allowed is True
    assert reason == "ok"
    # Check that count reset
    assert limiter.user_data[user_id].request_count == 1
    assert limiter.user_data[user_id].last_request_time == 1060.1

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_user_multiple_allowed(MockConfig, mock_time):
    """Test allowing multiple requests within the rate limit."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 3, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    user_id = 123

    # First 3 requests should be allowed
    mock_time.return_value = 1000.0
    allowed1, _ = await limiter.check_rate_limit(user_id)
    mock_time.return_value = 1001.0
    allowed2, _ = await limiter.check_rate_limit(user_id)
    mock_time.return_value = 1002.0
    allowed3, _ = await limiter.check_rate_limit(user_id)

    assert allowed1 is True
    assert allowed2 is True
    assert allowed3 is True
    assert limiter.user_data[user_id].request_count == 3

    # Fourth request should be blocked
    mock_time.return_value = 1003.0
    allowed4, reason4 = await limiter.check_rate_limit(user_id)
    assert allowed4 is False
    assert reason4 == "user"
    assert limiter.user_data[user_id].request_count == 3 # Still 3

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_global_limit(MockConfig, mock_time):
    """Test the global rate limit."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 10, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 2, "rate_limits.global_period": 60 # Low global limit
    })
    limiter = RateLimiter()
    user1 = 111
    user2 = 222
    user3 = 333

    # First request user 1 (allowed)
    mock_time.return_value = 1000.0
    allowed1, _ = await limiter.check_rate_limit(user1)
    assert allowed1 is True
    assert limiter.global_request_count == 1

    # First request user 2 (allowed)
    mock_time.return_value = 1001.0
    allowed2, _ = await limiter.check_rate_limit(user2)
    assert allowed2 is True
    assert limiter.global_request_count == 2

    # First request user 3 (blocked by global limit)
    mock_time.return_value = 1002.0
    allowed3, reason3 = await limiter.check_rate_limit(user3)
    assert allowed3 is False
    assert reason3 == "global"
    assert limiter.global_request_count == 2 # Not added on block

    # Wait for global period to expire
    mock_time.return_value = 1000.0 + 60.0 + 0.1 # 1060.1
    allowed4, _ = await limiter.check_rate_limit(user3) # User 3 tries again
    assert allowed4 is True
    assert limiter.global_request_count == 1 # Old ones cleaned, new one added
    assert limiter.global_last_request_time == 1060.1

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_get_cooldown_user(MockConfig, mock_time):
    """Test calculating user cooldown."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 1, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    # Calculate expected cooldown based on config
    expected_cooldown_sec = 60.0 / 1.0
    user_id = 123

    # First request
    mock_time.return_value = 1000.0
    await limiter.check_rate_limit(user_id)

    # Check cooldown immediately after (should be full cooldown period)
    mock_time.return_value = 1000.1
    # Need to block first to check cooldown accurately based on implementation
    allowed, reason = await limiter.check_rate_limit(user_id)
    assert allowed is False
    cooldown = limiter.get_cooldown_remaining(user_id)
    assert pytest.approx(cooldown) == expected_cooldown_sec - 0.1 # approx 59.9

    # Check cooldown after some time has passed
    mock_time.return_value = 1030.0
    cooldown = limiter.get_cooldown_remaining(user_id)
    assert pytest.approx(cooldown) == expected_cooldown_sec - 30.0 # approx 30.0

    # Check cooldown after period has passed (should be 0)
    mock_time.return_value = 1000.0 + expected_cooldown_sec + 1.0 # 1061.0
    cooldown = limiter.get_cooldown_remaining(user_id)
    assert cooldown == 0.0

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_get_cooldown_global(MockConfig, mock_time):
    """Test calculating global cooldown."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 10, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 1, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    expected_cooldown_sec = 60.0 / 1.0
    user_id = 123 # User ID doesn't matter for global cooldown calculation

    # First request
    mock_time.return_value = 1100.0
    await limiter.check_rate_limit(user_id)

    # Second request (blocked)
    mock_time.return_value = 1100.1
    allowed, reason = await limiter.check_rate_limit(user_id + 1) # Different user
    assert allowed is False
    assert reason == "global"

    # Check cooldown immediately after block
    cooldown = limiter.get_cooldown_remaining(user_id + 1)
    assert pytest.approx(cooldown) == expected_cooldown_sec - 0.1 # approx 59.9

@pytest.mark.asyncio
@patch('llmcord.utils.rate_limit.Config')
async def test_rate_limiter_get_cooldown_no_limit_hit(MockConfig, mock_time):
    """Test cooldown is 0 if the limit hasn't been hit."""
    mock_config_instance = MockConfig.return_value
    configure_mock_config_get(mock_config_instance, {
        "rate_limits.enabled": True, "rate_limits.user_limit": 5, "rate_limits.user_period": 60,
        "rate_limits.global_limit": 100, "rate_limits.global_period": 60
    })
    limiter = RateLimiter()
    user_id = 123
    mock_time.return_value = 1000.0
    # Make one request (below limit)
    await limiter.check_rate_limit(user_id)
    # Check cooldown
    cooldown = limiter.get_cooldown_remaining(user_id)
    assert cooldown == 0.0

# Add tests for reasoning rate limits similarly if needed