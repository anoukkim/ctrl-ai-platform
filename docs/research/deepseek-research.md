# DeepSeek research — own API, hosts outside China, and whether to add it

Background for **deepseek-research** and the optional
**more-chat-providers** spec in [`../BACKLOG.md`](../BACKLOG.md). Collected
2026-10-08 from the providers' own documentation and public APIs; **prices
change, and DeepSeek changed its line-up and prices three times between
April and September 2026. Re-check the linked pages before buying credit or
building against a figure.** Nothing here was measured by calling a paid
API, and no account was created anywhere.

All KRW figures use **1,400 KRW/USD** and are rounded, as in
[`chat-plus-research.md`](chat-plus-research.md). A **typical reply** is the
repo's own yardstick (`pricing.TYPICAL_*`): 3,000 input + 800 output
tokens. At that size the current Claude catalogue costs **Haiku 10원,
Sonnet 20원, Opus 40원** per reply.

"unverified" means the figure came from a third-party page, from
inference, or could not be confirmed on an official page.

---

## Summary and recommendation

**Do not use DeepSeek's own API.** Its servers are in the People's Republic
of China, its terms are governed by PRC law with disputes heard in
Hangzhou, its privacy policy allows using inputs to train models and
names a Beijing affiliate that receives de-identified prompts for that
purpose, it has no zero-retention option, and Korea's PIPC found in 2025
that the DeepSeek service had sent Korean users' prompts to other
companies in China without a lawful basis. If the company restricts
sending data to servers in China, the own API is ruled out on that point
alone, whatever the price.

**The models themselves can be used without China.** DeepSeek publishes
the weights (V4.1-Flash is MIT-licensed), and on 2026-10-08 about
twenty-five hosts serve DeepSeek V4.1 Flash, many of them US companies on
US hardware. Through them it costs **about 1–4원 per typical reply**,
against Haiku's 10원.

**Recommendation, if the owner wants DeepSeek at all:**

1. **First, ask the company one question.** Is the rule *"no data on
   servers in China"*, or is it *"no DeepSeek"*? Some Korean companies
   barred DeepSeek outright in 2025 (see [Compliance](#4-data-location-and-compliance)).
   If it is the second, stop here.
2. **If only the data location matters, use OpenRouter pinned to US
   providers**, one catalogue row such as `deepseek/deepseek-v4.1-flash`
   with `provider: {only: [US allowlist], data_collection: "deny", zdr:
   true}`. A request then cannot reach DeepSeek, Baidu, Alibaba,
   StreamLake or SiliconFlow. That costs about **2.7원** a reply at
   Together's price plus OpenRouter's 5.5% card fee. It also gives one
   prepaid balance and one Stripe receipt per top-up, which Gemini or Grok
   could share later.
3. **If DeepSeek is the only extra model ever wanted**, a direct US host
   is just as good: **Together AI** (2.6원 a reply, prepaid, training off
   by default, zero retention as an org setting) or **Fireworks AI's US
   region** (3.9원, nothing stored for open models). That means one more
   prepaid pot and one more receipt per quarter, and no aggregator in
   between.
4. **Keep it low priority.** At this club's size the saving is small in
   won. A member who sends 1,000 typical replies in a quarter spends
   about 20,000원 of the 80,000원 동아리 지원 wallet on Sonnet, and about
   2,700원 on DeepSeek via OpenRouter. Korean quality is unmeasured. The
   case for adding it is a cheap option for long or bulk work, not a
   cost problem that exists today.

Nothing is built. When it is, it is an OpenAI-compatible streaming adapter
behind a mock, plus catalogue rows (see
[What it would take to build](#6-what-it-would-take-to-build)).

---

## 1. DeepSeek's own API

Sources, all read 2026-10-08:
https://api-docs.deepseek.com/quick_start/pricing,
https://api-docs.deepseek.com/ (base URLs),
https://api-docs.deepseek.com/news/news260424 (V4 preview),
https://api-docs.deepseek.com/news/news260813 (V4-Pro GA, peak pricing),
https://api-docs.deepseek.com/news/news260821 (vision, Files API),
https://api-docs.deepseek.com/news/news260910 (V4.1-Flash),
https://api-docs.deepseek.com/guides/vision,
https://api-docs.deepseek.com/guides/files_api,
https://api-docs.deepseek.com/guides/kv_cache,
https://api-docs.deepseek.com/guides/thinking_mode,
https://api-docs.deepseek.com/quick_start/rate_limit,
https://api-docs.deepseek.com/api/create-chat-completion,
https://api-docs.deepseek.com/api/get-user-balance.

### 1.1 Models and prices

The old names `deepseek-chat` and `deepseek-reasoner` were **retired on
2026-07-24**. The current names:

| | `deepseek-flash` | `deepseek-v4-pro` |
|---|---|---|
| Served by | DeepSeek-V4.1-Flash (released 2026-09-10; 552B MoE, open weights, MIT) | DeepSeek-V4-Pro-0813 on the pricing page, **but see the note below** |
| Context | 1M tokens | 1M tokens |
| Max output | 384K (393,216); default 8K non-thinking, 64K thinking | same |
| Thinking mode | both; **thinking is on by default**, effort `high` | both |
| JSON output, tool calls, Responses API, Anthropic API | yes | yes |
| Vision (image input) | **yes** | no |
| Input, cache hit, $/MTok (off-peak / peak) | 0.003 / 0.006 | 0.022 / 0.044 |
| Input, cache miss, $/MTok (off-peak / peak) | **0.15 / 0.30** | 0.66 / 1.32 |
| Output, $/MTok (off-peak / peak) | **0.60 / 1.20** | 1.98 / 3.96 |
| Concurrency limit (per account) | 2,500 | 500 |

- **Peak and off-peak.** From 2026-08-16, "Off-peak rates are half of the
  peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday
  through Friday, excluding Chinese public holidays." In Korea that is
  **10:00–13:00 and 15:00–19:00 KST on weekdays**, which is when members
  are likely to chat. Plan on peak prices.
- **`deepseek-v4-pro` is in flux.** The 2026-09-10 announcement says:
  "Starting at 04:00 UTC on Sept 14, 2026, all deepseek-v4-pro requests
  will route to V4.1-Flash at V4.1-Flash rates. This will continue until
  V4.1-Pro launches." The pricing page still lists V4-Pro-0813 at its own
  prices. Which one applies today is *unverified*. Only `deepseek-flash`
  is worth considering.
- **Context caching** is automatic and on disk. Repeated prefixes are
  billed at the cache-hit price, about 2% of the miss price. The stream's
  `usage` reports `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`
  separately. "Best-effort", and cleared "within a few hours to a few
  days".
- **Granted vs. topped-up balance.** Fees come out of granted (free)
  balance first, then topped-up balance.

### 1.2 API shape, streaming and usage

| Item | Value |
|---|---|
| OpenAI-compatible | `https://api.deepseek.com` (Chat Completions, and the Responses API since 2026-08-13). Works with the `openai` SDK by changing `base_url` |
| Anthropic-compatible | `https://api.deepseek.com/anthropic`, Messages API shape, so the `anthropic` SDK works too |
| Streaming | SSE, ends with `data: [DONE]`. With `stream_options: {include_usage: true}` every chunk has a `usage` field that is null until the last one. "Either way, the last chunk before the `data: [DONE]` message carries the" total usage |
| Keep-alive | Streaming sends `: keep-alive` SSE comments while waiting. A request that has not started inference within 10 minutes is closed. A hand-written parser must skip comments |
| Thinking | `{"thinking": {"type": "enabled"/"disabled"}}` (OpenAI format, via `extra_body`), `reasoning_effort` low/high/max. Chain of thought arrives as `reasoning_content` beside `content`. Thinking ignores `temperature` |
| Function calling / JSON | Tool calls and `response_format: json_object` on both models |
| `user_id` | Optional per-request id for content-safety, cache and scheduling isolation. "Do not include user privacy information in user_id" |
| Errors | 429 when the concurrency limit is exceeded. A 402-style "insufficient balance" maps to our `CREDIT` kind (exact code list: https://api-docs.deepseek.com/quick_start/error_codes) |

### 1.3 Image and file input

- **Images: yes, on `deepseek-flash` only.** JPEG, PNG, GIF and WebP, sent
  as base64 data URL, external URL or Files API `file_id`. Images are
  allowed in user messages only. Limits: 48 MiB request body, 32 MiB per
  inline image, 600 images per request, 8,192 px per side.
- **Image tokens:** each image is resized to roughly 1300×1300 pixels' worth
  of area, capped at **1,024 tokens per image**. That is ≤ $0.0003, or
  **≈0.4원 per image** at peak. `detail: "low"` downsizes to 512×512.
- **PDF / documents: no.** The Files API takes images only ("Supported
  formats: JPEG, PNG, GIF, and WebP"). For `chat-plus-files`, PDFs would
  need our own text extraction before they reach this provider.
- **Files API:** free, 64 MiB per file, kept permanently unless
  `expires_after` (1 hour to 30 days) is set. Like Anthropic's, files
  belong to the API key, not to our member, so we keep the mapping.

### 1.4 Data, privacy and terms

Sources: DeepSeek Open Platform Terms of Service, released 2026-04-22,
effective 2026-04-29
(https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html).
DeepSeek privacy policy, "마지막 업데이트: 2026년 5월 6일". The `en-US`
URL served the Korean-language version on 2026-10-08
(https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html).

| Item | What the documents say |
|---|---|
| Operator | Hangzhou DeepSeek Artificial Intelligence Co., Ltd. The API and the consumer chat share one account |
| Where data is processed | "저희 서버는 중화인민공화국에 위치해 있습니다. … 중화인민공화국에서 귀하의 개인정보를 직접 수집하고 처리합니다." No region choice exists |
| Training use | The privacy policy lists training and improving "machine learning models and algorithms" among its purposes. It also says personal data may additionally be used "당사 기술 학습∙개선 목적" under PIPA art. 15(3). Its overseas-transfer table names **Beijing DeepSeek Artificial Intelligence Co., Ltd (China)** as receiving "비식별화 후의 사용자 프롬프트" until "모델 훈련 또는 최적화 완료". The opt-out it describes is the consumer setting ("모두를 위해 모델 개선" off). **No clause found that exempts API inputs from training.** The Open Platform terms defer personal data to the privacy policy (§5.5). Third-party analyses describe API training as on by default (*unverified*) |
| Retention | No fixed window for prompts. Data is kept until "보유기간 만료 또는 처리 목적 달성". Statutory periods are listed (e.g. website visit logs 3 months). The disk context cache clears "within a few hours to a few days". No zero-retention option |
| Our role | Terms §3.3 and §5.5: when we build on the API, **we are the controller** for our members' data. We must disclose to members that their prompts go to DeepSeek and get their consent or another legal basis. Under PIPA that is an overseas transfer to China, which needs its own notice |
| Governing law | "the laws of the People's Republic of China in the mainland". Disputes go to "a court having jurisdiction over the location of the registered office" in Hangzhou (§10) |
| Age | Privacy policy: no service for children under 14. Terms: minors under 18 read the terms with a guardian. CTRL+AI members are adults, so this is not a blocker |
| Output rights | Outputs are assigned to us and may be used for anything, including "training other models (such as model distillation)" (§4.2) |
| Balance forfeiture | A brand-misuse breach lets DeepSeek "forfeit any unconsumed balance" (§5.4) |

### 1.5 Billing and receipts (Concur)

| Item | Value |
|---|---|
| Model | **Prepaid balance** (terms §6.1). Service stops when the balance runs out |
| Currency | The balance API reports `CNY` or `USD` |
| Top-up methods | Bank card, PayPal, Alipay, WeChat Pay, "depending on account region" (third-party guides; *unverified* on an official page) |
| Expiry | Topped-up balance: no expiry stated. Granted balance can expire (balance API: "not expired granted balance") |
| Refund | Terms §6: on request, after review, "refund the remaining unspent amount after deducting necessary costs such as handling fees" |
| Receipts / invoices | **Unverified.** The billing page shows top-up records. No official page found that confirms a downloadable invoice or receipt suitable for Concur. Chinese 发票 invoicing is normally for mainland entities |

Even if receipts exist, a company card payment to a Hangzhou company
through PayPal or a Chinese payment channel is exactly what a company
restriction is likely to catch. Treat this as a second reason not to
buy.

---

## 2. Hosts outside China

### 2.1 OpenRouter

Sources, read 2026-10-08:
https://openrouter.ai/api/v1/models,
https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints,
https://openrouter.ai/api/v1/providers (headquarters and datacenters),
https://openrouter.ai/api/v1/endpoints/zdr,
https://openrouter.ai/docs/guides/routing/provider-selection,
https://openrouter.ai/docs/faq,
https://openrouter.ai/docs/guides/guides/usage-accounting.

**Models.** `deepseek/deepseek-v4.1-flash` (text + image input, 1M
context), `deepseek/deepseek-v4-pro-0813`, older V4/V3.x ids, and the
moving aliases `~deepseek/deepseek-flash-latest` /
`~deepseek/deepseek-pro-latest`. Pin a dated id, not an alias, so the
catalogue price stays true.

**Providers serving `deepseek/deepseek-v4.1-flash`** on 2026-10-08, as
OpenRouter's endpoint list reported them. HQ and datacenter come from
OpenRouter's provider list; "—" means OpenRouter does not say.

| Provider (slug) | HQ / datacenter | Quant | $/MTok in / out | On OpenRouter's ZDR list |
|---|---|---|---|---|
| DeepSeek (`deepseek`) | **CN** / — | — | 0.15 / 0.60 (off-peak at the time read; peak 0.30 / 1.20) | **no** |
| Baidu (`baidu`) | **CN** / — | fp8 | 0.30 / 1.20 | no |
| StreamLake (`streamlake`) | **CN** / — | fp8 | 0.144 / 0.576 | no |
| Alibaba (`alibaba`) | SG / **SG, CN** | — | 0.30 / 1.20 | no |
| SiliconFlow (`siliconflow`) | SG / US | fp8 | 0.30 / 1.20 | yes |
| Together (`together`) | US / — | — | **0.30 / 1.20** | yes |
| Fireworks, US region (`fireworks/us`) | US / US (region tag) | — | **0.45 / 1.80** | yes |
| Fireworks (`fireworks`) | US / — | — | 0.30 / 1.20 | yes |
| DeepInfra (`deepinfra`) | US / — | fp8 | **0.14 / 0.42** (shown with a 30% discount; list 0.20 / 0.60) | yes |
| CoreWeave (`coreweave`) | US / US | fp8 | **0.20 / 0.65** | yes |
| Baseten (`baseten`) | US / — | fp8 | 0.30 / 1.20 | yes |
| Modal (`modal`) | US / — | — | 0.30 / 1.20 | yes |
| Parasail (`parasail`) | US / — | fp8 | 0.30 / 1.20 | yes |
| Novita (`novita`) | US / — | fp8 | 0.195 / 0.78 | yes |
| (and about ten smaller hosts: Relace, Morph, InferenceNet, Wafer, Sail Research, Decart, Ionstream, DigitalOcean, Phala, Venice, Makora, GMICloud, AtlasCloud, DekaLLM (Indonesia)) | mostly US | various, some fp4 | 0.02–0.27 in / 0.18–2.40 out | mostly yes |

**Routing controls** (the `provider` object on each request):

- `order` — try these providers in this order. `allow_fallbacks` (default
  `true`) lets others serve if they fail.
- `only` — the allowlist. `ignore` — the blocklist. Both take a provider
  slug, or "the full slug including the suffix (e.g.
  `"google-vertex/us-east5"`)" to pin a region or variant, so
  `fireworks/us` is addressable.
- `data_collection: "deny"` — "use only providers which do not collect
  user data". The default is `"allow"`.
- `zdr: true` — only zero-data-retention endpoints. **DeepSeek's own
  endpoint is not on the ZDR list**, so this alone already keeps requests
  off DeepSeek's servers.
- `quantizations` — e.g. exclude `fp4` if quality suffers.
- `max_price` — refuse rather than route above a price.
- All of these can also be set **account-wide** in OpenRouter's privacy
  settings, which protects against a request that forgets them. The
  account allowlist is a ceiling the request cannot widen.
- **In-region routing** (`us.openrouter.ai` / `eu.openrouter.ai`) exists
  only on the Business and Enterprise plans. We do not need it: the
  allowlist already decides which upstream host sees the prompt.

`zdr: true` is **not enough on its own**. SiliconFlow (Singapore HQ, US
datacenter) is on the ZDR list, and a new provider could be added later.
Use an explicit **`only` allowlist of US-headquartered providers** as
well, both on the request and account-wide.

**Fee, receipts, data** (from the FAQ, consistent with
`chat-plus-research.md`): no markup on provider prices. **5.5% fee on
card purchases** ($0.80 minimum). Credits may expire after a year.
Refunds only within 24 hours, and fees are not refunded. Stripe receipts,
with a tax ID shown on invoices. Prompts are not logged by OpenRouter
unless we opt in. Every response, including the last SSE chunk, carries
`usage.cost` in credits plus `cached_tokens` and `reasoning_tokens`. That
was an open question in the Chat+ research and is now verified.

### 2.2 US-hosted providers, direct

| Host | DeepSeek models on 2026-10-08 | $/MTok in / cached / out | Data terms | Billing |
|---|---|---|---|---|
| **Together AI** | V4.1 Flash; V4 Pro 0813; V4 Flash 0731 | V4.1 Flash **0.30 / 0.006 / 1.20**; V4 Pro 1.32 / 0.13 / 3.96 (https://www.together.ai/pricing) | "Use of your data for training models is a separate opt-in and is off by default." By default Together **stores** prompts and responses and "may use them for product improvements". Set "Store prompts and model responses" to **No** for zero retention (https://docs.together.ai/docs/zero-data-retention) | Fully prepaid, **$5 minimum**, auto-recharge, card or ACH. Invoices and receipts in the billing settings (https://docs.together.ai/docs/billing-credits; receipt format *unverified*) |
| **Fireworks AI** | V4.1 Flash (global and a US-only variant) | Standard **0.30 / 0.006 / 1.20**. **US variant 0.45 / 0.009 / 1.80**. Priority tier 1.25× (https://docs.fireworks.ai/serverless/pricing). A third-party note says these took effect 2026-10-01 (*unverified*) | "Fireworks does not log or store prompt or generation data for any open models, without explicit user opt-in." Data "exist only in volatile memory for the duration of the request" (https://docs.fireworks.ai/guides/security_compliance/data_handling) | "pre-paid, usage-based billing" with auto-reload or monthly spend limits (https://fireworks.ai/pricing). Receipts *unverified* |
| **DeepInfra** | V4.1 Flash (fp8), V4 Flash Vision Exp | List 0.20 / — / 0.60, currently 0.14 / 0.0042 / 0.42 with a 30% promotion (OpenRouter endpoint data; official page not read, so *unverified*) | Input is "not stored to disk", output "is not stored". "We do not use data you submit to our APIs for training models" (https://docs.deepinfra.com/account/data-privacy). Processing region not stated | *unverified* |
| **Microsoft Foundry (Azure)** | DeepSeek-V4 Pro, V4 Flash, V4 Flash 0731, V3.2, R1. **No V4.1 Flash** listed | Official page renders "$-" without a region. Third-party figures: V4 Flash 0.20 / 0.80, V4 Pro 1.74 / 3.48 (*unverified*) | Azure terms; no training on customer data (standard Azure, not re-read) | Postpaid Azure invoice. Does not fit the club's prepaid-per-quarter model |
| **Google Vertex AI** | DeepSeek-V3.1, **V3.2**, R1-0528, DeepSeek-OCR. **No V4** | V3.2 0.56 / 0.056 / 1.68 (https://cloud.google.com/vertex-ai/generative-ai/pricing) | Google Cloud terms | Postpaid Cloud Billing, the same billing type as the VM. Open-ended spend risk, as noted for Gemini on Vertex |
| **AWS Bedrock** | DeepSeek V3.2, V3.1, R1. **No V4** in the official catalogue (search; page not re-read) | V3.2 0.62 / — / 1.85 (third-party, *unverified*) | AWS terms | Postpaid AWS invoice |
| **Groq** | None found on the models or pricing pages | — | — | — |

Only Together, Fireworks and DeepInfra serve the **current** DeepSeek
model directly. The hyperscalers either lag (Vertex, Bedrock: V3.2) or
bill monthly in arrears (Azure, Vertex, Bedrock).

---

## 3. Price comparison

A typical reply is 3,000 input + 800 output tokens, at 1,400원/$, with no
cache hits (a conservative assumption: a long chat hits DeepSeek's cache
and costs less). **Reasoning tokens are not included.** DeepSeek models
think by default, and thinking tokens are billed as output (*assumed*,
following the OpenAI convention the API mirrors). A 1,000-token chain of
thought adds about 1.7원 at 1.20 $/MTok. The adapter should send thinking
`disabled` (or effort `low`) for ordinary chat.

| Route | Model | $/MTok in / out | $ per reply | **원 per reply** | vs Haiku 10원 |
|---|---|---|---|---|---|
| DeepSeek API, off-peak | deepseek-flash (V4.1) | 0.15 / 0.60 | 0.00093 | **1.3원** | 0.13× |
| DeepSeek API, peak (10–13, 15–19 KST weekdays) | deepseek-flash (V4.1) | 0.30 / 1.20 | 0.00186 | **2.6원** | 0.27× |
| DeepSeek API, peak | deepseek-v4-pro (listed price) | 1.32 / 3.96 | 0.00713 | 10원 | 1.0× |
| Together, direct | V4.1 Flash | 0.30 / 1.20 | 0.00186 | **2.6원** | 0.27× |
| Fireworks, direct, US region | V4.1 Flash | 0.45 / 1.80 | 0.00279 | **3.9원** | 0.39× |
| DeepInfra, direct (list / promo) | V4.1 Flash fp8 | 0.20 / 0.60 · 0.14 / 0.42 | 0.00108 · 0.00076 | 1.5원 · 1.1원 (*unverified*) | 0.15× · 0.11× |
| OpenRouter → Together (+5.5% card fee) | V4.1 Flash | 0.30 / 1.20 | 0.00196 | **2.7원** | 0.28× |
| OpenRouter → Fireworks US (+5.5%) | V4.1 Flash | 0.45 / 1.80 | 0.00294 | **4.1원** | 0.41× |
| OpenRouter → CoreWeave (+5.5%) | V4.1 Flash fp8 | 0.20 / 0.65 | 0.00118 | 1.7원 | 0.17× |
| OpenRouter → DeepInfra (+5.5%, promo) | V4.1 Flash fp8 | 0.14 / 0.42 | 0.00080 | 1.1원 | 0.11× |
| Azure Foundry | V4 Flash (previous gen) | 0.20 / 0.80 (*unverified*) | 0.00124 | 1.7원 | 0.17× |
| Vertex AI | V3.2 (older) | 0.56 / 1.68 | 0.00302 | 4.2원 | 0.42× |
| Together, direct | V4 Pro 0813 | 1.32 / 3.96 | 0.00713 | 10원 | 1.0× |
| *For comparison* | Claude Haiku 4.5 / Sonnet 5.5 / Opus 5.5 | 1 / 5 · 2 / 10 · 4 / 20 | — | **10원 / 20원 / 40원** | — |

What the table says:

- **Hosting outside China costs about the same as DeepSeek's peak price.**
  Together and Fireworks match DeepSeek's peak list price exactly. The
  US-only Fireworks region costs 1.5×. OpenRouter adds 5.5%. The
  difference between DeepSeek's own API and a US host is **about 0–1.5원 a
  reply**: not a reason to accept the data terms.
- **One image** adds at most 1,024 tokens, about 0.4원 on any of these.
- **A quarter's wallet:** 80,000원 buys roughly 4,000 typical Sonnet
  replies, or about 30,000 DeepSeek V4.1 Flash replies via OpenRouter.

---

## 4. Data location and compliance

**The constraint as stated:** *our company may restrict sending data to
servers in China.*

| Route | Do prompts reach servers in China? | Company of Chinese origin in the path? |
|---|---|---|
| DeepSeek API (direct, or via OpenRouter's `deepseek` endpoint) | **Yes**, by the privacy policy's own words | Yes |
| OpenRouter with no provider settings | **Possibly**: default routing load-balances across all hosts, including DeepSeek, Baidu, StreamLake and Alibaba (SG/CN datacenters) | Possibly |
| OpenRouter with `only: [US allowlist]` + `data_collection: "deny"` + `zdr: true`, also set account-wide | **No** (enforced by OpenRouter on every request) | The *model* is DeepSeek's. The infrastructure and companies are US |
| Together / Fireworks US / DeepInfra direct | **No** (US companies; Fireworks `us` is a US-only region; Together and DeepInfra datacenters not stated, *unverified*) | Model only |

Context a compliance reviewer will ask about:

- **Korea, PIPC (2025).** New downloads of the DeepSeek app were suspended
  in Korea from 2025-02-15. On 2025-04-23/24 the PIPC published its
  inspection results. DeepSeek had transferred Korean users' data,
  **including prompt contents**, to several companies in China and the
  US, including ByteDance's Volcano Engine, without a lawful basis or
  disclosure. The PIPC issued a corrective recommendation (시정권고):
  secure a legal basis for overseas transfers, immediately destroy the
  prompts transferred to Volcano Engine, publish a Korean privacy policy,
  and verify and delete children's data. DeepSeek added an AI-training
  opt-out (2025-03-17), stopped that prompt transfer from 2025-04-10,
  accepted the recommendations and resumed downloads on 2025-04-28 with a
  Korean policy. These findings concerned the **consumer app**; the API's
  terms were not the subject (as far as the coverage shows).
  Sources: https://www.korea.kr/briefing/pressReleaseView.do?newsId=156686003,
  https://byline.network/2025/04/25-427/,
  https://www.ajunews.com/view/20250428164100969.
- **Korean government and companies (2025).** On 2025-02-03 the Ministry
  of the Interior and Safety and the NIS sent central ministries and
  regional governments a caution on generative AI. The ministries of
  Foreign Affairs, Trade/Industry/Energy, National Defense and Environment
  then blocked DeepSeek on internet-connected PCs, and **private companies
  such as Kakao banned internal use**
  (https://www.newsis.com/view/NISX20250205_0003054495,
  https://mobile.newsis.com/view/NISX20250206_0003055200). This is the
  precedent for asking whether the company's rule is "no China servers"
  or "no DeepSeek".
- **Elsewhere (as reported, not re-verified individually).** US: the
  Department of Defense, NASA and the Navy blocked DeepSeek. A "No
  DeepSeek on Government Devices Act" was introduced in Congress, and
  Texas and other states banned it on state devices. Europe: Italy's
  regulator blocked the app (2025-01), Germany asked Apple and Google to
  delist it (2025-06), and several other EU data-protection authorities
  opened inquiries. Taiwan and Australia banned it on government devices.
  These all target the **DeepSeek service and app**, not the open
  weights run by a third party. Sources:
  https://www.conference-board.org/research/ceo-center-newsletters-alerts/state-and-federal-governments-deepseak-ban,
  https://finance.yahoo.com/news/factbox-governments-regulators-increase-scrutiny-095326244.html.

What this means for CTRL+AI:

1. **DeepSeek's own API is incompatible with the stated constraint**, and
   using it would make CTRL+AI the controller of an overseas transfer of
   members' prompts to China, which needs its own notice and consent under
   PIPA.
2. **A US host keeps the data out of China**, but the model is still
   DeepSeek's. Whether that is acceptable is the company's call, not
   ours. Ask before any build.
3. **Model behaviour.** DeepSeek models have been reported to follow PRC
   content rules on political topics (widely reported for R1 in 2025).
   Whether V4.1-Flash behaves this way when self-hosted is *unverified*.
   It matters little for a beginner build/video club, but members should
   not be surprised by it.
4. Whichever route is used, Chat's member notice (and `docs/product.md`)
   should name the provider that receives the prompt, as for Claude.

---

## 5. Korean quality

**No credible Korean evaluation was found.** The V4.1-Flash model card
reports Chinese (C-Eval) and a multilingual math set (MGSM), and no Korean
benchmark (KMMLU, HAE-RAE). Nothing official compares it with Claude in
Korean. As **more-chat-providers** already says, it **must be measured on
real club prompts** before a row is opened to members. Use a handful of
the questions members actually ask, including a build request, a video
prompt rewrite and a usage question, judged side by side with Haiku and
Sonnet by an admin, through an `admin`-visibility catalogue row.

---

## 6. What it would take to build

Nothing below is built. It belongs to **more-chat-providers** (After the
beta, M3), and follows CLAUDE.md section 20: mock first, the real provider
chosen by configuration.

1. **Adapter.** One `OpenAICompatibleChatProvider` with the same
   `TextDelta` / `UsageUpdate` / `StreamEnd` events and `ClaudeError`-style
   failures as `claude_provider.py`. It takes the base URL and key from
   settings. The same class serves DeepSeek's API, OpenRouter, Together and
   Fireworks, because all four speak Chat Completions with SSE and send
   usage on the last chunk (`stream_options.include_usage`). It must
   ignore `: keep-alive` SSE comments, send thinking disabled (or effort
   low) for chat, and map 401/402/429/5xx/timeout to the existing
   `ProviderErrorKind`s. The current `MEMBER_MESSAGE` strings say
   "Claude", so another provider needs neutral or provider-named Korean
   wording.
2. **Catalogue rows.** `chat_models.py` already says another provider is
   "a new adapter … plus catalogue rows". Add the provider name to
   `KNOWN_PROVIDERS` (e.g. `openrouter`, or `together`) and a row such as
   provider `openrouter`, model `deepseek/deepseek-v4.1-flash`, input
   0.30 / output 1.20 $/MTok, visibility `admin` first. Two price gaps:
   - The row has one input and one output price. DeepSeek's off-peak
     halving and cache-hit prices **cannot be expressed**. Charging the
     peak / cache-miss list price over-charges slightly, which is the safe
     direction. With OpenRouter, `usage.cost` per response could
     reconcile the ledger against what was actually billed.
   - For OpenRouter, price the row at list × 1.055 if the 5.5% fee should
     come out of member wallets, or keep list price and let the fee be a
     club overhead. This is a decision for the owner.
3. **Routing config (OpenRouter).** Every request carries `provider: {only:
   [<US allowlist>], data_collection: "deny", zdr: true}`, and the same
   allowlist is set account-wide. A test asserts the request body always
   includes it, so a refactor cannot silently drop it.
4. **Settings, server-side only.** `OPENROUTER_API_KEY` (or
   `TOGETHER_API_KEY` / `FIREWORKS_API_KEY`), and a provider switch in the
   style of `CLAUDE_PROVIDER`, e.g. `OPENROUTER_PROVIDER=mock|openrouter`,
   defaulting to `mock`. A missing key fails at startup only when the real
   provider is selected. **No `DEEPSEEK_API_KEY`**, since the
   recommendation rules the own API out. Never in `NEXT_PUBLIC_*`.
5. **Mock.** The mock Claude provider already streams canned Korean and
   reports plausible tokens. The new adapter gets the same, plus a fake
   transport for the conformance tests the more-chat-providers spec
   lists.
6. **Images.** `deepseek-flash` takes images in the OpenAI `image_url`
   shape, so `chat-plus-files` images could pass through if the adapter
   converts our attachment blocks. Whether each OpenRouter upstream host
   accepts images is *unverified* per endpoint (the model lists `image`
   input). PDFs must be turned into text first.
7. **Admin naming.** The section is called **Claude Models** in
   `frontend/app/admin/sections.ts`. A second provider is a reason to
   revisit that name (a ui-naming decision, not part of this research).

**Effect on the per-provider purchase and Concur.** In the single-wallet
model, a member's 동아리 지원 wallet pays for any model. The 팀장 still
buys prepaid credit **per provider** and forecasts each purchase from
usage by provider.

- **Via OpenRouter:** one more purchase line, "OpenRouter", with a Stripe
  receipt per top-up. Forecast it from the ledger's usage on rows whose
  provider is `openrouter`. If Gemini or Grok are added later through
  OpenRouter too, they share this one purchase. Credits may expire after
  a year, so buy per quarter, not per year.
- **Direct US host:** one more purchase line per host (e.g. "Together AI",
  $5 minimum), with receipts from that host's billing page.
- **DeepSeek direct:** would be a purchase from a Hangzhou company in
  CNY/USD with unverified receipts. Not recommended.

---

## 7. Risks

- **Company policy** may bar DeepSeek models outright, not only Chinese
  servers. Ask first.
- **Fast-moving line-up.** In six months DeepSeek retired `deepseek-chat`
  and `deepseek-reasoner`, added peak pricing, launched and retired
  V4-Flash, and re-routed `deepseek-v4-pro`. A catalogue row can go stale
  within a quarter. The pricing snapshot at approval (CLAUDE.md §9)
  protects allocations, but rows need re-checking every quarter.
- **Routing drift on OpenRouter.** New providers appear weekly. Without an
  account-wide allowlist, a forgotten request field could route to a
  Chinese host.
- **Quantization.** Many cheap hosts serve fp8 or fp4. Quality may differ
  from DeepSeek's own serving. Exclude `fp4` if Korean output suffers.
- **Unmeasured Korean quality**, and possible PRC-aligned refusals on
  political topics (*unverified* for V4.1).
- **Another key** to keep, rotate and protect (the beta `.env` exception
  in CLAUDE.md §17 applies; the key moves to Secret Manager after the
  beta).
- **Small absolute saving.** The won difference per member per quarter is
  a few thousand won. The effort (M per provider) may not pay off before
  Korean quality is known.

---

## Open / unverified items

1. Whether `deepseek-v4-pro` is billed at V4-Pro-0813 prices (pricing
   page) or routed to V4.1-Flash at Flash prices (2026-09-10 news).
2. Whether DeepSeek's API inputs are used for training (no explicit API
   exemption found; third parties say yes by default).
3. DeepSeek top-up methods for Korean cards, and whether a
   Concur-suitable invoice or receipt can be downloaded.
4. DeepInfra's official V4.1 Flash list price and billing/receipt
   process. Together's and Fireworks' receipt formats.
5. Azure Foundry DeepSeek prices (the official page renders without a
   region). Bedrock DeepSeek V3.2 price.
6. Datacenter locations for Together, DeepInfra, Baseten, Modal and
   Parasail (US HQ; OpenRouter lists no datacenter).
7. Which OpenRouter upstream hosts accept image input for V4.1 Flash.
8. Whether thinking tokens are billed exactly as output on every host.
9. Korean quality, which can only be settled by measuring on club prompts.
10. The Fireworks price change date (2026-10-01, third-party note).

## Sources

DeepSeek: https://api-docs.deepseek.com/quick_start/pricing ·
https://api-docs.deepseek.com/ ·
https://api-docs.deepseek.com/news/news260424 ·
https://api-docs.deepseek.com/news/news260813 ·
https://api-docs.deepseek.com/news/news260821 ·
https://api-docs.deepseek.com/news/news260910 ·
https://api-docs.deepseek.com/guides/vision ·
https://api-docs.deepseek.com/guides/files_api ·
https://api-docs.deepseek.com/guides/kv_cache ·
https://api-docs.deepseek.com/guides/thinking_mode ·
https://api-docs.deepseek.com/quick_start/rate_limit ·
https://api-docs.deepseek.com/api/create-chat-completion ·
https://api-docs.deepseek.com/api/get-user-balance ·
https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html ·
https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html ·
https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash

OpenRouter: https://openrouter.ai/api/v1/models ·
https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints ·
https://openrouter.ai/api/v1/providers ·
https://openrouter.ai/api/v1/endpoints/zdr ·
https://openrouter.ai/docs/guides/routing/provider-selection ·
https://openrouter.ai/docs/faq ·
https://openrouter.ai/docs/guides/guides/usage-accounting

US hosts: https://www.together.ai/pricing ·
https://docs.together.ai/docs/zero-data-retention ·
https://docs.together.ai/docs/billing-credits ·
https://docs.fireworks.ai/serverless/pricing · https://fireworks.ai/pricing ·
https://docs.fireworks.ai/guides/security_compliance/data_handling ·
https://docs.deepinfra.com/account/data-privacy ·
https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/ ·
https://cloud.google.com/vertex-ai/generative-ai/pricing ·
https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html

Korea and other regulators: https://www.korea.kr/briefing/pressReleaseView.do?newsId=156686003 ·
https://byline.network/2025/04/25-427/ ·
https://www.ajunews.com/view/20250428164100969 ·
https://www.newsis.com/view/NISX20250205_0003054495 ·
https://mobile.newsis.com/view/NISX20250206_0003055200 ·
https://www.conference-board.org/research/ceo-center-newsletters-alerts/state-and-federal-governments-deepseak-ban ·
https://finance.yahoo.com/news/factbox-governments-regulators-increase-scrutiny-095326244.html

All read 2026-10-08.
