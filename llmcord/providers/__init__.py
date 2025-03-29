from typing import Dict, Optional
import logging

from .base import LLMProvider
from .openai import OpenAIProvider
from .gemini import GeminiProvider

log = logging.getLogger(__name__)

class ProviderFactory:
    """Factory for creating LLM providers."""
    
    @staticmethod
    async def create_provider(config) -> Optional[LLMProvider]:
        """Create a provider based on the configuration."""
        provider_name, _ = config["model"].split("/", 1)
        
        if provider_name == "google-gemini":
            provider = GeminiProvider()
        else:
            # Default to OpenAI compatible for all other providers
            provider = OpenAIProvider()
        
        success = await provider.setup(config)
        if not success:
            log.error(f"Failed to setup provider: {provider_name}")
            return None
            
        return provider