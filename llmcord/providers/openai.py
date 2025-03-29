import logging
from typing import List, Dict, Any, AsyncGenerator, Tuple, Optional

from openai import AsyncOpenAI, APIError
from ..providers.base import LLMProvider

log = logging.getLogger(__name__)

class OpenAIProvider(LLMProvider):
    """Provider for OpenAI and compatible APIs."""
    
    def __init__(self):
        self.client = None
        self.model_name = None
        self.base_url = None
        self.api_key = None
        self.extra_params = {}
        
    async def setup(self, config: Dict[str, Any]) -> bool:
        """Setup the provider with OpenAI configuration."""
        try:
            provider_name, model_name = config["model"].split("/", 1)
            provider_cfg = config["providers"].get(provider_name)
            
            if not provider_cfg:
                log.error(f"Configuration for provider '{provider_name}' not found")
                return False
                
            self.base_url = provider_cfg.get("base_url")
            self.api_key = provider_cfg.get("api_key")
            self.model_name = model_name
            self.extra_params = config.get("extra_api_parameters", {})
            
            if not self.base_url:
                log.error(f"Base URL for {provider_name} provider is missing in config")
                return False
                
            import httpx
            httpx_client = httpx.AsyncClient()
            self.client = AsyncOpenAI(
                base_url=self.base_url, 
                api_key=self.api_key or "sk-no-key-required",
                http_client=httpx_client
            )
            
            log.info(f"OpenAI compatible provider setup: {provider_name}/{self.model_name}")
            return True
            
        except Exception as e:
            log.error(f"Failed to setup OpenAI compatible provider: {e}")
            return False
    
    async def generate_stream(
        self, 
        messages: List[Dict[str, Any]], 
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> AsyncGenerator[Tuple[str, Optional[str]], None]:
        """Generate streaming response from OpenAI API."""
        if not self.client:
            raise RuntimeError("Provider not setup. Call setup() first.")
            
        # If system prompt provided, add it to messages
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
            
        # Combine kwargs with extra_params (kwargs take precedence)
        api_params = {**self.extra_params, **kwargs}
        
        try:
            stream = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                stream=True,
                **api_params
            )
            
            async for chunk in stream:
                finish_reason = chunk.choices[0].finish_reason
                chunk_text = chunk.choices[0].delta.content or ""
                yield chunk_text, finish_reason
                
        except APIError as e:
            log.error(f"OpenAI API Error: {e}")
            yield f"Error: {e}", "error"
        except Exception as e:
            log.error(f"Unexpected error in OpenAI stream: {e}")
            yield f"Unexpected error: {e}", "error"
    
    @property
    def supports_vision(self) -> bool:
        """Check if the model supports vision based on name."""
        vision_tags = ("gpt-4", "claude-3", "gemini", "gemma", "pixtral", 
                      "mistral-small", "llava", "vision", "vl")
        return any(tag in self.model_name.lower() for tag in vision_tags)
    
    @property
    def supports_usernames(self) -> bool:
        """Check if the provider supports usernames in messages."""
        # Extract provider from base_url (simplistic approach)
        provider = self.base_url.split("//")[1].split(".")[0]
        providers_with_usernames = ("openai", "x-ai")
        return any(p in provider.lower() for p in providers_with_usernames)