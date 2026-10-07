# Chat+ research — attachments, server tools, image generation, other providers

Background for the `chat-plus-*`, `image-generation` and
`more-chat-providers` specs in [`../BACKLOG.md`](../BACKLOG.md). Collected
2026-10-07 from the providers' own documentation; **prices change — re-check
the linked pages before buying credit or building against a figure.** Nothing
here was measured by calling a paid API.

Researched 2026-10-07 from official docs where possible. All KRW figures use **1,400 KRW/USD** and are rounded.
"unverified" means the figure came from a third-party page, from inference, or could not be confirmed on an official page.

Model prices used (official, https://platform.claude.com/docs/en/about-claude/pricing):

| Model | Input $/MTok | Output $/MTok | 5m cache write | 1h cache write | Cache read | Batch in/out |
|---|---|---|---|---|---|---|
| claude-haiku-4-5 | 1 | 5 | 1.25 | 2 | 0.10 | 0.50 / 2.50 |
| claude-sonnet-5-5 | 2 | 10 | 2.50 | 4 | 0.20 | 1 / 5 |
| claude-opus-5-5 | 4 | 20 | 5 | 8 | **0.20 (0.05x, not 0.1x)** | 2 / 10 |

Notes from the same page:
- Claude 4.7+ models (so Sonnet 5.5 and Opus 5.5, **not** Haiku 4.5) use a newer tokenizer that produces "approximately 30% more tokens for the same text". Korean text cost per message is therefore not directly comparable between Haiku 4.5 and the 5.5 models.
- Any request that includes tools adds a hidden tool-use system prompt: 286 tokens (Sonnet 5.5, Opus 5.5), 496 tokens (Haiku 4.5) for `tool_choice` auto/none.
- `inference_geo: "us"` costs 1.1x; default global routing is standard price.
- Billing: prepaid credits, "Credits expire one year from the purchase date", "All credit purchases are non-refundable", auto-reload available, invoicing only via Sales (https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage). A receipt is issued for every credit purchase (including auto-reload) and invoices are downloadable from Console › Billing › Invoice history by Admin/Billing roles (https://support.claude.com/en/articles/10366473-where-can-i-find-full-receipts-and-invoices-for-my-api-console-payments). Good fit for Concur.
- Data: API inputs/outputs deleted "within 30 days of receipt or generation" by default (2 years if flagged for usage-policy violation) (https://privacy.claude.com/en/articles/7996866); retained data "is never used for model training without your express permission" (https://platform.claude.com/docs/en/manage-claude/api-and-data-retention). Vision FAQ: "Anthropic does not use uploaded images to train models."

---

## A. Anthropic API

### A1. Image input (vision)

Source: https://platform.claude.com/docs/en/build-with-claude/vision

| Item | Value |
|---|---|
| Source types | `base64`, `url`, `file` (Files API `file_id`). Bedrock/Google Cloud: base64 only |
| Formats | JPEG, PNG, GIF, WebP. Animated: first frame only |
| Max size per image | 10 MB (base64-encoded) on the Claude API |
| Max dimensions | 8000x8000 px; if a request has **more than 20 images**, a stricter limit applies (stay ≤2000 px per side or ≤20 image/document blocks). Earlier-turn images resent in history count |
| Images per request | 100 for 200k-context models, 600 for others; request size limit 32 MB |
| Token formula | **`ceil(width/28) × ceil(height/28)`** visual tokens (28x28 px patches). The old `w*h/750` formula is no longer what the docs give |
| Resolution tiers | **High-res** (Claude 4.7 and later → Sonnet 5.5, Opus 5.5): max long edge 2576 px, max 4,784 tokens. **Standard** (all others → Haiku 4.5): 1568 px, 1,568 tokens. Larger images are downscaled automatically |
| Generation | Claude "cannot generate, produce, edit, manipulate, or create images" |

Worked cost for one image (input tokens only; the image is re-billed on every later turn while it stays in history unless cached):

| Model | Tier | 1000x1000 tokens | USD | KRW | 12 MP phone photo (4032x3024) tokens | USD | KRW |
|---|---|---|---|---|---|---|---|
| Haiku 4.5 | standard | 1,296 | $0.00130 | ₩1.8 | ≈1,568 (capped) | $0.00157 | ₩2.2 |
| Sonnet 5.5 | high-res | 1,296 | $0.00259 | ₩3.6 | ≤4,784 (capped) | $0.00957 | ₩13.4 |
| Opus 5.5 | high-res | 1,296 | $0.00518 | ₩7.3 | ≤4,784 (capped) | $0.01914 | ₩26.8 |

The 1,296-token figure for 1000x1000 is in the official table for both tiers. The doc notes high-res can use "up to roughly three times more visual tokens", so **resize server-side** (e.g. long edge 1280 px → 1280x960 = 46×35 = 1,610 tokens) to cap Sonnet/Opus cost near the Haiku level. Pillow on the 1 GB VM can handle one 12 MP image (~36 MB RGB in memory) but should not do many concurrently.

### A2. PDF input

Source: https://platform.claude.com/docs/en/build-with-claude/pdf-support (status GA, all active models)

| Item | Value |
|---|---|
| How it works | Each page is converted to an image **and** its text is extracted; both are sent to the model |
| Text tokens | "Each page typically uses 1,500–3,000 tokens per page depending on content density. Standard API pricing applies with no additional PDF fees." |
| Image tokens | Same vision formula per page. The rendered page size is **not stated** → per-page image tokens unverified; assumed 1,000–1,600 below |
| Limits | Request ≤32 MB; **600 pages** per request (**100** when the context window is under 1M tokens); no passwords/encryption |
| Sources | base64, URL, Files API `file_id` |

Worked cost, 10-page PDF, input only (range = 10 × (1,500 text + 1,000 image) to 10 × (3,000 + 1,600) → **≈25,000–46,000 tokens**; the 5.5 models' tokenizer may push the text part ~30% higher):

| Model | Input USD | Input KRW | +500 output tokens |
|---|---|---|---|
| Haiku 4.5 | $0.025–0.046 | ₩35–64 | +$0.0025 (₩3.5) |
| Sonnet 5.5 | $0.050–0.092 | ₩70–129 | +$0.005 (₩7) |
| Opus 5.5 | $0.100–0.184 | ₩140–258 | +$0.010 (₩14) |

Multi-turn matters more than the first read: the PDF is re-billed on every follow-up. Five turns over a 35k-token PDF:

| Model | No caching | With prompt caching (1 write 5m + 4 reads) |
|---|---|---|
| Haiku 4.5 | $0.175 (₩245) | $0.058 (₩81) |
| Sonnet 5.5 | $0.350 (₩490) | $0.116 (₩162) |
| Opus 5.5 | $0.700 (₩980) | $0.203 (₩284) |

Use the token counting endpoint to measure real PDFs before setting per-attachment limits (https://platform.claude.com/docs/en/build-with-claude/token-counting).

### A3. Files API

Source: https://platform.claude.com/docs/en/build-with-claude/files

| Item | Value |
|---|---|
| What | Upload once to Anthropic storage, get a `file_id`, reference it in Messages instead of resending bytes. Also used to download files created by code execution/skills |
| Status | **GA**; no beta header needed (old `files-api-2025-04-14` still works; SDK: `client.files`, Python SDK ≥1.2.0) |
| Cost | Upload, download, list, metadata, delete are **free**. File content used in a message is billed as input tokens |
| Limits | 500 MB per file; **1 TB per organization**; ~500 file-API requests/min |
| Retention | Persist until deleted, or until `expires_in_seconds` (3,600 s to 7,776,000 s = 90 days) set at upload; after expiry, metadata visible ≤30 days |
| Content blocks | PDF and `text/plain` → `document`; JPEG/PNG/GIF/WebP → `image`; CSV, XLSX, JSON, XML, etc. → `container_upload` (code execution only). DOCX/XLSX are **not** accepted as `document` → convert to text or PDF |
| Platforms | Claude API, Claude Platform on AWS, Foundry (Anthropic-hosted). **Not** on Bedrock / Google Cloud |
| ZDR | Not eligible |
| Gotchas | (1) Files are **workspace-scoped**, not user-scoped: "Never accept `file_id` values from end users"; keep the user→file mapping in our DB. (2) **Uploaded files cannot be downloaded back** (`downloadable: false`), so we must keep our own copy anyway for showing thumbnails/downloads in the UI |

**Needed for us?** No, not for the MVP. Base64 works on every provider (Gemini, OpenRouter, xAI also take base64), keeps the provider interface uniform, and we must store the original ourselves anyway. The Files API's real benefit is smaller request payloads in long conversations with many attachments (the doc's own tip). Consider it later as an optimisation inside the Anthropic provider only, with `expires_in_seconds` set and deletion tied to conversation deletion. The 30 GB VM disk is the real storage constraint: cap upload size and count per member.

### A4. Server tools

Pricing source: https://platform.claude.com/docs/en/about-claude/pricing (+ each tool page). All three are GA on the Claude API, need no beta header, and can be disabled org-wide in Console settings.

| Tool | Versions | Price | Model notes |
|---|---|---|---|
| Web search (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) | `web_search_20250305` (basic), `web_search_20260209` (+dynamic filtering), `web_search_20260318` (+`response_inclusion`) | **$10 per 1,000 searches** + result tokens as input (results stay in history and are re-billed in later turns). Failed searches not billed | Dynamic filtering needs Claude 4.6+ → Sonnet 5.5 / Opus 5.5 yes, **Haiku 4.5 no**: Haiku lacks programmatic tool calling, so on newer versions set `allowed_callers: ["direct"]` (else 400) or use `web_search_20250305`. `max_uses` caps searches per request; `user_location` can set `country: "KR"`. Multi-turn: must send back `encrypted_content` unchanged |
| Web fetch (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) | `web_fetch_20250910` (basic), `_20260209` (dyn. filtering), `_20260309` (+cache bypass), `_20260318` (+response inclusion) | **No additional charge**; fetched content billed as input tokens. Typical: 10 kB page ≈2,500 tokens; 100 kB doc page ≈25,000; 500 kB PDF ≈125,000 | Fetches only URLs already present in user messages / tool results (exfiltration guard). No JavaScript-rendered pages. Use `max_content_tokens` and `max_uses` (no default limit) |
| Code execution (https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool) | `code_execution_20250825`, `_20260120` (+PTC, REPL state), `_20260521` | **Free** when `web_search_20260209+` or `web_fetch_20260209+` is in the request. Otherwise **1,550 free hours/org/month**, then **$0.05 per container-hour**, **5-minute minimum**; files in the request are billed even if the tool isn't called | Supported on Haiku 4.5, Sonnet 5.5, Opus 5.5 (Haiku: newer versions behave like `_20250825`). Container: Python 3.11, 5 GiB RAM, 5 GiB disk, 1 CPU, **no internet**, matplotlib/seaborn preinstalled, containers expire 30 days after creation. **Not ZDR-eligible**. Not on Bedrock/Google Cloud |

Per-call typical cost (estimates; the ~12k result-token figure is unverified, based on the doc's single-search example showing ~6k input tokens):

| Scenario | Haiku 4.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| One search fee only | $0.01 = ₩14 | ₩14 | ₩14 |
| Question with 2 searches, ~12k result tokens, 800 output | ≈$0.036 ≈ **₩50** | ≈$0.052 ≈ **₩73** | ≈$0.084 ≈ **₩118** |
| One web fetch of an average page (2,500 tokens) | ₩3.5 | ₩7 | ₩14 |
| One fetch of a 500 kB PDF (125k tokens) without `max_content_tokens` | ₩175 | ₩350 | ₩700 |
| Code execution beyond the free hours, one 5-min minimum | $0.0042 ≈ ₩6 | same | same |

1,550 free hours equals 18,600 five-minute sessions per month, so code execution costs nothing for a club of our size. What it adds is tokens and the generated output files.

### A5. Prompt caching and Batch API

Sources: https://platform.claude.com/docs/en/build-with-claude/prompt-caching, pricing page.

- Multipliers: 5-min write 1.25x, 1-hour write 2x, read **0.1x** (Opus 5.5: **0.05x**). They stack with Batch and data residency.
- **Automatic caching**: one top-level `cache_control: {"type": "ephemeral"}`; the breakpoint moves forward as the chat grows. This is the right setting for Chat. Up to 4 breakpoints.
- **Minimum cacheable prefix**: 512 tokens for Sonnet 5.5 / Opus 5.5; **4,096 tokens for Haiku 4.5**. Short Haiku chats will not cache at all (and no error is raised).
- Images and documents in user turns can be cached. That is where the big savings are (see the A2 table: ~67–71% saved over 5 turns).
- Changing tools, `tool_choice`, or adding/removing images invalidates the system/tool cache. Toggling web search on or off per message breaks the cache.
- Our usage ledger must read `cache_creation_input_tokens` and `cache_read_input_tokens` separately from `input_tokens` and price them differently, or KRW charges will be wrong.
- **Batch API: 50% off** input and output, asynchronous (up to 24 h). Not usable for interactive chat; could fit offline jobs (e.g. conversation titling, nightly summaries). Server tools in batches cost the same as normal; web search in batches is throttled.

### A6. Image generation (Claude cannot)

| Option | How | Cost per output | KRW |
|---|---|---|---|
| (a) Claude writes SVG / HTML / Mermaid / chart code, rendered in our UI | Plain text output | ~2,000–6,000 output tokens (estimate): Haiku $0.01–0.03, Sonnet $0.02–0.06, Opus $0.04–0.12 | ₩14–42 / ₩28–84 / ₩56–168 |
| (a') Claude + code execution → matplotlib PNG, downloaded via Files API | Server tool, free hours | Tokens only (within 1,550 free hours) | as above |
| Google **Nano Banana 2.1** (`gemini-nano-banana-2.1`, ID as reported on the pricing page) | Gemini API, paid tier only | $0.0336 (1K), $0.0504 (2K), $0.113 (4K); batch half | ₩47 / ₩71 / ₩158 |
| Google Gemini 3.1 Flash Image (`gemini-3.1-flash-image`) | Gemini API | $0.045 (0.5K), $0.067 (1K), $0.101 (2K), $0.151 (4K) | ₩63 / ₩94 / ₩141 / ₩211 |
| Google Gemini 3.1 Flash Lite Image (`gemini-3.1-flash-lite-image`) | Gemini API | $0.0336 (1K) | ₩47 |
| Google Gemini 3 Pro Image (`gemini-3-pro-image`) | Gemini API | $0.134 (1K/2K), $0.24 (4K) | ₩188 / ₩336 |
| Google Imagen 4 | — | Listed as **"Shut down"** on the models page; replaced by Nano Banana models. `gemini-2.5-flash-image` was deprecated with shutdown Oct 2, 2026 | — |
| xAI `grok-imagine-image` / `-2.0` / `-quality` | xAI API | $0.02 / $0.04 / $0.05 | ₩28 / ₩56 / ₩70 |
| OpenAI `gpt-image-2` (1024x1024, low/medium/high) | OpenAI Images API | $0.006 / $0.053 / $0.211: **unverified** (third-party pages, e.g. https://fal.ai/learn/tools/gpt-image-2-review). The official page (https://developers.openai.com/api/docs/pricing) lists image output at $30/MTok and says to use the calculator | ₩8 / ₩74 / ₩295 |

Gemini sources: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/models. xAI: https://docs.x.ai/docs/models. None of the image models have a free tier on Gemini.

Budget implication: image generation is a **new provider pot** (Google or xAI), separate from Claude credit, since prepaid credit cannot move between providers. Alternatively route it through OpenRouter (see B) to share one balance (OpenRouter image-model availability and pricing are unverified).

---

## B. Other chat providers (for later)

### B1. Summary table

| | Google Gemini API (AI Studio; Vertex AI) | xAI Grok API | OpenRouter (aggregator) | Alt: Vercel AI Gateway |
|---|---|---|---|---|
| API shape | Native `generateContent` / google-genai SDK; **OpenAI-compatibility layer available** (models page) | REST at `https://api.x.ai/v1`, OpenAI-SDK compatible; Responses API (Chat Completions legacy) | OpenAI-compatible "drop-in replacement" | Gateway over many providers (OpenAI-compatible endpoint: unverified on the pricing page) |
| Flagship price $/MTok | `gemini-3.1-pro-preview` $2 / $12 (≤200k), $4 / $18 (>200k); `gemini-3.8-flash` ("most intelligent Flash") $0.75 / $3.75 until 2026-12-31, **$1.50 / $7.50 from 2027-01-01** | `grok-4.7` $2 / $6 (cached $0.50), ≥200k $4 / $12; 500k ctx | Provider list price, **no markup** | Provider list price, **no markup, no platform fee on tokens** |
| Cheap model $/MTok | `gemini-2.5-flash-lite` $0.10 / $0.40; `gemini-3.1-flash-lite` $0.25 / $1.50; `gemini-3.5-flash-lite` $0.30 / $2.50 | `grok-4.3` $1.25 / $2.50 (1M ctx); `grok-build-0.1` $1 / $2 (coding) | same as provider | same as provider |
| Billing | AI Studio: **Prepay is the default for new users** (since 2026-03-23); min purchase $5 (billing doc) vs $10 (Google blog), conflicting, so unverified; max $5,000; credits **expire after 12 months**, non-refundable; auto-reload; at $0 balance **all keys on the billing account stop**. Postpay = monthly. Tier 1 spend cap $250/month. Vertex AI = normal Cloud Billing (postpaid), same billing account type as our VM | **Prepaid credits** (non-refundable) or monthly invoiced billing (off by default); soft/hard spending limits; auto top-up exists | Prepaid credits: **5.5% fee on card purchases** (FAQ: $0.80 minimum), 5% crypto; Business plan 8%; credits may expire after 1 year; refund within 24 h only, fees non-refundable | Prepaid "AI Gateway Credits" + auto top-up; "You're responsible for any payment processing fees"; invoicing Enterprise only; **budgets per team / project / API key / member** |
| Receipts / invoices (Concur) | AI Studio prepay: doc only says transaction history lives in the AI Studio Billing tab; downloadable receipts **unverified**. Vertex: Cloud Billing invoices/statements (standard GCP, details unverified for KR) | Billing › Invoices lists invoices for prepaid credits and monthly invoices; also exposed via Management API | Stripe receipt e-mails; tax ID can be added and Stripe puts it on every future invoice (https://openrouter.ai/docs/cookbook/administration/tax-id) | Through Vercel billing (details unverified) |
| Free tier | Yes for most text models (not 3.1 Pro preview, not image models); Search grounding free quota | None found (unverified); no data-sharing credit programme found in current docs | Free models: 50 req/day, 1,000/day after ≥$10 bought, 20 req/min | Monthly free credit on a subset of models (amount not stated, unverified); ends once you buy credits |
| Images in | PNG, JPEG, WEBP, HEIC, HEIF; ≤384 px = 258 tokens, else 768 px tiles × 258 tokens (1000x1000 ≈ 1,032 tokens, approximate); Gemini 3 uses `media_resolution`; inline ≤20 MB; up to 3,600 images | jpg/jpeg, png; ≤20 MiB; token pricing not documented | Images via URL or base64 | per provider |
| PDF in | ≤50 MB or 1,000 pages; **258 tokens per page**; on Gemini 3 "you are **not charged** for tokens originating from the extracted **native text**" → 10-page PDF ≈ 2,580 tokens ≈ ₩2–8 | PDFs via Files (512 MB/file); attaching files auto-adds `attachment_search` billed **per invocation** ($2.50/1k) | Native (tokens) or parser engines: **mistral-ocr $2 / 1,000 pages** (the default), cloudflare-ai free | per provider |
| File storage | Files API free, files kept **48 hours** | Files API (retention not stated) | — | — |
| Streaming | Yes (standard `streamGenerateContent` / SSE; not re-verified this session) | Yes (OpenAI-compatible; not re-verified) | Yes (not re-verified) | Yes (not re-verified) |
| Built-in tools | Google Search grounding: Gemini 3.x **5,000 free/month (shared) then $14 / 1,000**; Gemini 2.5: 1,500 RPD free then $35 / 1,000. Code execution and URL context billed as tokens only | Web search **$5 / 1k**, X search $5 / 1k posts ($10 / 1k profiles), code execution $5 / 1k, collections/file search $2.50 / 1k. Batch 20% off on selected models | Web plugin (Exa) **$0.007/request** incl. 10 results, +$0.001 per extra result; native provider search passed through | per provider |
| Data use / training | **Unpaid (free) services: Google uses content to improve products, humans may read it**: "Do not submit sensitive, confidential, or personal information." **Paid: not used to improve products**; logs kept "for a limited period" for abuse detection (the specific "55 days" figure is **not** in current terms, unverified). Paid = Cloud project with active billing. Terms: users 18+, and not for services "directed towards or likely to be accessed by" under-18s | "never trains on your API inputs or outputs without your explicit permission"; stored encrypted **30 days** then deleted; self-serve **ZDR** at team level (disables Files, Batch, etc.); SOC 2 Type 2; docs now branded "SpaceXAI" | Prompts/completions **not logged by default** (opt-in logging gives a 1% discount); each upstream provider has its own training/retention policy; account-wide setting to route only to providers with acceptable policies, with **separate settings for paid and free models** (free model providers may train) | ZDR routing per request on Pro/Enterprise (no extra cost); team-wide ZDR $0.10 / 1k requests |
| Korean quality | No official KR benchmark found (unverified) | none found (unverified) | depends on routed model | depends on routed model |

Sources: Gemini https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/billing, https://ai.google.dev/gemini-api/terms, https://ai.google.dev/gemini-api/docs/document-processing, https://ai.google.dev/gemini-api/docs/image-understanding, https://blog.google/innovation-and-ai/technology/developers-tools/prepay-gemini-api/ · xAI https://docs.x.ai/docs/models, https://docs.x.ai/developers/pricing, https://docs.x.ai/developers/faq/security, https://docs.x.ai/developers/files, https://docs.x.ai/developers/model-capabilities/images/understanding, https://docs.x.ai/developers/rest-api-reference/management/billing · OpenRouter https://openrouter.ai/docs/faq, https://openrouter.ai/pricing, https://openrouter.ai/docs/guides/overview/multimodal/pdfs, https://openrouter.ai/docs/guides/features/web-search, https://openrouter.ai/docs/guides/privacy/logging · Vercel https://vercel.com/docs/ai-gateway/pricing

### B2. Impact on the "budget by provider" model

| Provider | How it fits | KRW conversion note |
|---|---|---|
| Anthropic direct | One pot ("Claude"), prepaid, receipt per purchase, credits expire 12 months | list price × rate |
| Gemini (AI Studio prepay) | New pot. Prepay mirrors our model well; **$0 balance stops every key on that billing account**, so keep a separate billing account from the VM's GCP billing. Prepay credits cover only Gemini API, not other GCP services. Tier-1 $250/month cap is irrelevant at our size | list price × rate; prices for 3.6–3.8 Flash **double on 2027-01-01**, so a pricing snapshot taken at approval (CLAUDE.md §9) protects existing allocations |
| Gemini (Vertex AI) | Postpaid on Cloud Billing: does not match "buy prepaid credit per quarter" and adds a risk of open-ended spend | — |
| xAI | New pot, prepaid, invoices listed in console | list price × rate |
| OpenRouter | **One prepaid USD balance across every model** (Claude, Gemini, Grok, image models), so "budget by provider" collapses into one pot and credit *can* move between models. Per-model attribution must come from each response's usage (OpenRouter returning a per-request cost field: unverified) | effective rate = list price **× 1.055** (card fee) |
| Vercel AI Gateway | Same single-balance idea, no token markup; built-in per-API-key/member budgets could double-check our ledger | card processing fees possible |

Practical recommendation for the Concur workflow: keep **Anthropic direct** as the primary pot (cleanest receipts; caching and server tools are first-class). If a second model family is wanted, **OpenRouter** gives one receipt per top-up for all of them at a 5.5% premium. **Gemini AI Studio prepay** is the cheaper direct option for images (Nano Banana ₩47/image at 1K) and PDFs, but receipt export is unverified and **the free tier must never be used for member data**: free-tier content is used for training and read by humans. An API key on an unbilled project silently becomes free tier.

---

## Open / unverified items

1. Per-page image token count of Claude's PDF rendering (assumed 1,000–1,600). Measure with `/v1/messages/count_tokens` on sample Korean PDFs.
2. Typical web-search result tokens per search (assumed ~6k per search).
3. Gemini prepay minimum ($5 vs $10) and whether AI Studio prepay issues downloadable receipts suitable for Concur.
4. OpenAI gpt-image-2 per-image prices (third-party only).
5. Gemini 1000x1000 image token count on Gemini 3 (`media_resolution` overrides the tile formula).
6. OpenRouter per-request cost field; image-generation models on OpenRouter; whether Anthropic prompt caching passes through with full savings.
7. Korean-language quality comparisons: no official sources found.
8. Vercel AI Gateway free monthly credit amount and OpenAI-compatible endpoint.
