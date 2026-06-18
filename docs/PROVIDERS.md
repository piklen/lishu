# LLM Provider Examples

Lishu does not ship an API key or proxy requests through a Lishu server. Configure your own provider in the popup.

## Which Provider Should I Try First?

Choose based on the trade-off you care about most:

| Path | Best when | Watch for |
|---|---|---|
| Hosted OpenAI-compatible endpoint | You want the easiest setup and reliable JSON output. | Bookmark titles and URLs are sent to the provider you configure. |
| Anthropic Messages API | You already use Anthropic models or prefer that API. | Use the Anthropic protocol option and `/v1/messages` endpoint shape. |
| Local Ollama-compatible or LM Studio server | You want the most private path and are comfortable running a local model. | Model size and instruction-following quality matter; smaller or less instruction-tuned models may return invalid JSON. |
| Private gateway or LiteLLM | Your team already routes model calls through an internal gateway. | The gateway must expose an OpenAI-compatible `/chat/completions` endpoint. |

Lishu has no backend, no telemetry, and no bundled API key. Requests go directly from your browser to the endpoint you configure.

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

## LM Studio Local Server

Reference: [LM Studio OpenAI compatibility docs](https://lmstudio.ai/docs/developer/openai-compat).

```text
Protocol: OpenAI compatible
Endpoint: http://127.0.0.1:1234/v1
Model: local-model
```

Typical local setup:

1. Open LM Studio and download a chat/instruct model.
2. Start the local server from LM Studio's developer or server view.
3. Copy the served model id into Lishu's **Model** field.

Notes:

- The endpoint field should stop at `/v1`; Lishu appends `/chat/completions` internally.
- Chrome must be able to reach `http://127.0.0.1:1234` from the extension.
- Local models vary in JSON-following quality. If categories fail to parse or drift away from the requested schema, try a stronger instruction-tuned model or a hosted OpenAI-compatible endpoint.

## Local Model JSON Troubleshooting

Lishu asks the model for JSON arrays during both category proposal and bookmark classification. It can extract simple JSON from markdown fences or short surrounding text, but it cannot repair an unstable model that changes the schema.

Common symptoms:

- The popup shows `LLM 响应不是合法 JSON`.
- The model returns prose, markdown, comments, or multiple JSON blocks instead of one JSON value.
- Category proposal returns a single object, nested fields, or category names without `description`.
- Classification invents new category names instead of using the provided category list exactly.
- Classification omits bookmark ids, changes `bookmarkId`, or returns confidence values as text.

Local model caveats:

- Smaller models often follow JSON-only instructions less reliably, especially with long bookmark batches.
- Chat/instruct models are usually better than base completion models for schema-following.
- Quantized models can work, but heavier quantization may reduce instruction-following reliability.
- If failures happen only on large runs, lower the popup batch size before changing providers.
- If output remains unstable, use a stronger local model or switch to a hosted OpenAI-compatible endpoint for the organizing run.

Sanity-check the local OpenAI-compatible endpoint before running Lishu:

```bash
ENDPOINT=http://127.0.0.1:11434/v1
MODEL=llama3.1

curl "$ENDPOINT/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {
        \"role\": \"system\",
        \"content\": \"Return JSON only. Do not use markdown.\"
      },
      {
        \"role\": \"user\",
        \"content\": \"Return exactly {\\\"ok\\\":true,\\\"items\\\":[\\\"a\\\",\\\"b\\\"]}.\"
      }
    ],
    \"temperature\": 0
  }"
```

Expected response shape:

```json
{"ok":true,"items":["a","b"]}
```

If you are using LM Studio, set `ENDPOINT=http://127.0.0.1:1234/v1` and `MODEL` to the served model id shown in LM Studio. If your private gateway requires an `Authorization` header, add the same header shape your gateway expects.

## Safety Notes

- Never paste real API keys into issues, screenshots, or pull requests.
- Lishu stores API keys in `chrome.storage.local`.
- Default mode sends bookmark titles and URLs only to the endpoint you configure.
- Homepage meta scraping is optional and requests broader host access only when enabled.
