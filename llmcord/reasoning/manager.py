import logging
from typing import Optional, List, Dict, Any, AsyncGenerator, Tuple

from ..config import Config
from ..utils.rate_limit import RateLimiter
from ..providers import ProviderFactory, LLMProvider

log = logging.getLogger(__name__)

class ReasoningManager:
    """Manages the logic for switching to a reasoning model."""

    def __init__(self, config: Config, rate_limiter: RateLimiter):
        """Initialize the ReasoningManager."""
        self.config = config
        self.rate_limiter = rate_limiter
        self.reasoning_provider: Optional[LLMProvider] = None
        log.info(f"ReasoningManager initialized. Multimodel Enabled: {self.is_enabled()}")
        if self.is_enabled():
            log.info(f"Reasoning Model: {self.config.get('multimodel.reasoning_model')}")
            log.info(f"Reasoning Signal: '{self.get_reasoning_signal()}'")

    def is_enabled(self) -> bool:
        """Check if the multimodel feature is enabled in config."""
        return self.config.get("multimodel.enabled", False)

    def get_reasoning_signal(self) -> str:
        """Get the signal string that triggers the reasoning model."""
        return self.config.get("multimodel.reasoning_signal", "[USE_REASONING_MODEL]")

    def should_notify_user(self) -> bool:
        """Check if the user should be notified before switching."""
        return self.config.get("multimodel.notify_user", True)

    def check_response_for_signal(self, response_content: str) -> bool:
        """Check if the reasoning signal is present in the response content."""
        if not response_content:
            return False
        signal = self.get_reasoning_signal()
        # Check for exact match of the signal, potentially surrounded by whitespace
        return signal in response_content.strip()

    async def _get_reasoning_provider(self) -> Optional[LLMProvider]:
        """Lazily initialize and return the reasoning LLM provider."""
        if self.reasoning_provider is None:
            reasoning_model_config = self.config.get("multimodel.reasoning_model")
            if not reasoning_model_config or "/" not in reasoning_model_config:
                log.error(f"Invalid or missing 'multimodel.reasoning_model' in config: {reasoning_model_config}")
                return None

            log.info(f"Initializing reasoning provider for model: {reasoning_model_config}")
            try:
                # We need a way to pass the specific reasoning model to the factory
                # or create the provider directly here. Let's adapt the factory logic.
                provider_name, _ = reasoning_model_config.split("/", 1)
                
                # Create a temporary config-like dict for the provider setup
                provider_config_data = self.config.get() # Get the full config data
                provider_config_data['model'] = reasoning_model_config # Override the model for this instance

                # Use factory logic directly
                if provider_name == "google-gemini":
                    from ..providers.gemini import GeminiProvider
                    provider = GeminiProvider()
                else:
                    # Default to OpenAI compatible
                    from ..providers.openai import OpenAIProvider
                    provider = OpenAIProvider()

                success = await provider.setup(provider_config_data)
                if not success:
                    log.error(f"Failed to setup reasoning provider: {provider_name}")
                    return None
                
                self.reasoning_provider = provider
                log.info(f"Reasoning provider '{provider_name}' initialized successfully.")

            except Exception as e:
                log.exception(f"Error initializing reasoning provider for {reasoning_model_config}: {e}")
                return None
                
        return self.reasoning_provider

    async def check_rate_limit(self, user_id: int) -> Tuple[bool, Optional[float]]:
        """Check if the user is allowed to use the reasoning model based on rate limits."""
        # Placeholder - will call RateLimiter.check_reasoning_rate_limit later
        log.debug(f"Checking reasoning rate limit for user {user_id}")
        allowed, reason = await self.rate_limiter.check_reasoning_rate_limit(user_id)
        cooldown = None
        if not allowed:
             cooldown = await self.rate_limiter.get_reasoning_cooldown_remaining(user_id)
             log.warning(f"Reasoning rate limit hit for user {user_id}. Cooldown: {cooldown:.2f}s")
        return allowed, cooldown


    async def generate_reasoning_response(
        self, 
        messages: List[Dict[str, Any]], 
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[Tuple[str, Optional[str]], None]:
        """Generate a streaming response using the reasoning model."""
        provider = await self._get_reasoning_provider()
        if not provider:
            log.error("Cannot generate reasoning response: Reasoning provider not available.")
            yield ("Error: Reasoning model is not configured or failed to initialize.", "stop")
            return

        reasoning_params = self.config.get("multimodel.reasoning_extra_api_parameters", {})
        log.info(f"Generating response using reasoning model: {self.config.get('multimodel.reasoning_model')} with params: {reasoning_params}")
        try:
            async for chunk_text, finish_reason in provider.generate_stream(
                messages,
                system_prompt=system_prompt, # Pass the prompt without signal instruction
                **reasoning_params # Pass reasoning-specific parameters
            ):
                yield chunk_text, finish_reason
        except Exception as e:
            log.exception(f"Error during reasoning model generation: {e}")
            yield (f"Error during reasoning model generation: {e}", "stop")