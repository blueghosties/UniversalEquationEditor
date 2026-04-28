# Universal Equation Editor

This folder contains the equation editor and an optional local AI coach.

## Run the editor

```bash
node server.js
```

Then open:

```text
http://localhost:4321
```

The editor still opens as a plain `index.html` file, but the AI Coach requires the local server so API keys stay out of the browser.

## Enable AI providers

Copy `.env.example` to `.env`, then add whichever provider keys you want:

```bash
cp .env.example .env
```

Supported keys:

```text
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
```

Restart `node server.js` after editing `.env`.

## Default models

The model names can be changed in the app or in `.env`.

```text
OPENAI_MODEL=gpt-5-mini
ANTHROPIC_MODEL=claude-sonnet-4-20250514
GEMINI_MODEL=gemini-2.5-flash
DEEPSEEK_MODEL=deepseek-v4-flash
```

## Why a server?

AI API keys are secrets. The local server keeps them in `.env` and sends requests to the chosen provider from your machine, instead of exposing keys inside the HTML file.
