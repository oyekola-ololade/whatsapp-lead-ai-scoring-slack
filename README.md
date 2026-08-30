# WhatsApp Lead AI Scoring → Slack

Scores inbound WhatsApp leads with Claude and alerts sales in Slack the moment a hot lead lands.

![n8n](https://img.shields.io/badge/-n8n-333?style=flat-square) ![Claude (Anthropic API)](https://img.shields.io/badge/-Claude%20(Anthropic%20API)-333?style=flat-square) ![Slack (Incoming Webhook)](https://img.shields.io/badge/-Slack%20(Incoming%20Webhook)-333?style=flat-square)
![n8n](https://img.shields.io/badge/n8n-workflow-EA4B71?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

---

**[Open the visual project page →](./index.html)**

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow](#workflow)
- [Tech Stack](#tech-stack)
- [Demo status](#demo-status)
- [Setup](#setup)
- [Repository Structure](#repository-structure)
- [Disclaimer](#disclaimer)

## Overview

**Trigger:** Webhook (WhatsApp lead payload: name, email, budget, timeline, company size)

Scores inbound WhatsApp leads with Claude and alerts sales in Slack the moment a hot lead lands.

### Key Features

- AI lead scoring with structured JSON reasoning
- Hot-lead Slack alerting
- Graceful fallback if the scoring call fails

## Architecture

The diagram below represents the sanitized template flow. External services, credentials, and environment-specific identifiers must be configured before execution.

```mermaid
flowchart TD
    A["WhatsApp lead webhook"] --> B["Normalize lead fields"]
    B --> C["Claude lead scoring request"]
    C --> D{"AI request succeeds?"}
    D -->|Yes| E["Return hot, warm, or cold score with reasoning"]
    E --> F["Alert Slack for hot lead"]
    D -->|No| G["Send raw lead fallback to Slack"]
```

## Workflow

1. WhatsApp lead webhook receives the payload
2. Extract lead fields (name, email, budget, timeline, company size)
3. Claude scores the lead as hot/warm/cold with reasoning
4. On success, format and post a Slack alert for hot leads
5. On API failure, fall back to a plain Slack notification with raw lead data

## Tech Stack

- n8n
- Claude (Anthropic API)
- Slack (Incoming Webhook)

## Demo status

A configured live-run recording is not included yet. Credentials and service identifiers remain placeholders.


## Setup

1. Import `workflow/T1_WhatsApp_Lead_AI_Scoring_Slack.json` into your n8n instance (**Workflows → Import from File**).
2. Replace every placeholder credential/URL in the workflow (e.g. `YOUR_..._API_KEY`, `YOUR_..._URL`) with your own service credentials.
3. Activate the workflow and point the relevant integration (webhook source, scheduled trigger, etc.) at the generated webhook URL.
4. Test with a sample payload before going live.

## Repository Structure

```text
.
├── index.html
├── README.md
├── LICENSE
├── .gitignore
└── workflow/
    └── T1_WhatsApp_Lead_AI_Scoring_Slack.json
```


## Disclaimer

This workflow was built as a portfolio/template project to demonstrate n8n workflow automation and AI integration. API credentials and sensitive configuration have been removed before publication — replace all `YOUR_..._KEY` / `YOUR_..._URL` placeholders with your own before use.

---

Designed and engineered by

**Oyekola Ololade**

AI Systems & Integration Engineer

- LinkedIn: <http://linkedin.com/in/ololade-oyekola-5b1797397>
- Email: <oyekolaololade69@gmail.com>
