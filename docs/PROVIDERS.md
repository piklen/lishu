# LLM Provider Examples

Lishu does not ship an API key or proxy requests through a Lishu server. Configure your own provider in the popup.

## OpenAI

```text
Protocol: OpenAI compatible
Endpoint: https://api.openai.com/v1
Model: gpt-4o-mini
```

## Anthropic

```text
Protocol: Anthropic Messages API
Endpoint: https://api.anthropic.com/v1/messages
Model: claude-3-5-haiku-latest
```

## DeepSeek

```text
Protocol: OpenAI compatible
Endpoint: https://api.deepseek.com/v1
Model: deepseek-chat
```

## OpenRouter

```text
Protocol: OpenAI compatible
Endpoint: https://openrouter.ai/api/v1
Model: openai/gpt-4o-mini
```

OpenRouter model ids vary by provider. Use the exact model id shown in your OpenRouter dashboard.

## LiteLLM Or Private Gateway

```text
Protocol: OpenAI compatible
Endpoint: https://your-gateway.example.com/v1
Model: your-routing-model
```

Your gateway must expose an OpenAI-compatible `/chat/completions` endpoint.

## Ollama-Compatible Local Gateway

```text
Protocol: OpenAI compatible
Endpoint: http://127.0.0.1:11434/v1
Model: llama3.1
```

Typical local setup:

```bash
ollama pull llama3.1
ollama serve
```

Notes:

- Lishu talks to Ollama through its OpenAI-compatible `/v1/chat/completions` API.
- The endpoint field should stop at `/v1`; Lishu appends `/chat/completions` internally.
- Chrome must be able to reach `http://127.0.0.1:11434` from the extension.
- Local models vary in JSON-following quality. If classification output is unstable, try a stronger local model or a hosted OpenAI-compatible endpoint.

You can sanity-check the local API outside Lishu:

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "llama3.1",
    "messages": [{"role": "user", "content": "Return {\"ok\":true} as JSON only."}]
  }'
```

Other local OpenAI-compatible runtimes can work too, as long as they expose the same `/chat/completions` API shape.

## Safety Notes

- Never paste real API keys into issues, screenshots, or pull requests.
- Lishu stores API keys in `chrome.storage.local`.
- Default mode sends bookmark titles and URLs only to the endpoint you configure.
- Homepage meta scraping is optional and requests broader host access only when enabled.
