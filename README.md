# Form Analytics Tracker (FormAssembly) — GTM Community Template

A Google Tag Manager web template that tracks the full lifecycle of
[FormAssembly](https://www.formassembly.com/) forms and pushes the events to
the `dataLayer`. It loads a small hosted runtime (via `injectScript`) because
the GTM template sandbox cannot attach DOM listeners or observe the page
directly.

Lifecycle pushed per form: `view → start → step_N → submit | error`.

## Features

- **Consent-gated** — no event fires until the configured consent groups are
  granted (OneTrust / `OptanonConsent` by default; configurable, AND logic).
- **Multi-step forms** — emits `step_2`, `step_3`, … on FormAssembly page nav.
- **Modal & inline forms** — view tracking via visibility polling (modal) or
  IntersectionObserver (inline).
- **SPA-aware** — rescans on `pushState`/`replaceState`/`popstate` and tears
  down detached forms.
- **Submit & validation** — distinguishes a successful submit from a
  validation error, with elapsed time (seconds) since form start.
- **No data collection of its own** — transport is `dataLayer.push` only; the
  template makes no network calls beyond loading its runtime.

## Installation

1. In Google Tag Manager, add this template from the **Community Template
   Gallery** (Templates → Search Gallery → "Form Analytics Tracker").
2. Create a tag from it. Leave **Hosted script URL** on its default (a
   version-pinned jsDelivr URL) or point it at your own hosted copy.
3. Set **Required consent groups** to match your CMP (analytics is usually
   `C0002` in OneTrust). Leave empty to disable consent gating.
4. Trigger the tag on **Initialization – All Pages**.

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| Hosted script URL | jsDelivr pinned URL | Where the runtime is loaded from. Must match the `inject_script` permission domain. |
| Event name | `form_interaction` | `event` value pushed to the dataLayer. |
| formInteractionType value | `lead_form` | Static label included on every push. |
| Consent cookie name | `OptanonConsent` | Cookie read for consent state. |
| Required consent groups | `C0002` | Comma-separated CMP group IDs; ALL must be granted (AND). Empty = no gating. |
| Default audience | `consumer` | Fallback when no audience can be derived from the dataLayer. |
| Extra form selectors | _(empty)_ | Comma-separated CSS selectors appended to the built-in FormAssembly selectors. |
| Validation delay (ms) | `600` | Wait after a submit click before reading validation errors. |
| Enable debug logging | off | Logs `[FA]` lines to the console. |

## dataLayer schema

Each event is an object pushed to `window.dataLayer`:

| Key | Example | Notes |
| --- | --- | --- |
| `event` | `form_interaction` | Configurable. |
| `formName` | `Newsletter Signup` | Derived from the form's heading/modal title. |
| `formId` | `tfa_0` or `form_1` | The form's DOM id, or a generated index. |
| `formAction` | `view` / `start` / `step_2` / `submit` / `error` | Lifecycle stage. |
| `formInteractionType` | `lead_form` | Configurable. |
| `formAudience` | `consumer` | See "Audience" below. |
| `formResponse` | `success` / `validation_error` / `null` | Only set on submit/error. |
| `formTime` | `42` | Seconds since form start. Register as a GA4 metric with unit **Seconds**. |

## Audience

The runtime ships with a **neutral default**: it returns the configured
*Default audience* unless you supply your own logic. To classify audiences
from your own dataLayer, either edit the `getAudience()` function in your
hosted copy of the runtime, or set `window.faConfig.audienceResolver` to a
function `(dataLayer) => string` before the runtime loads (Custom HTML use).

## Hosting the runtime

The Gallery default loads the runtime from a version-pinned jsDelivr URL backed
by this repo, so it works out of the box. For first-party delivery (recommended
for strict CSP / privacy setups), host `form-analytics.js` on your own domain
and set both the **Hosted script URL** field and the template's `inject_script`
permission to that domain.

## Consent

By default the template fires nothing until every group in *Required consent
groups* reads as granted in the consent cookie. Set the list to match your CMP,
or clear it to disable gating entirely. Consent is checked centrally before
every push, so partial funnels never escape the gate.

## Issues & contributing

Found a bug or want a selector added? Open an issue. Please make template
changes through the GTM Template Editor and re-export `template.tpl` — do not
edit it by hand.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
