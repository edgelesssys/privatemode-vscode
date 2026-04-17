# Privatemode AI for GitHub Copilot

![Preview](https://img.shields.io/badge/status-preview-yellow)

**GitHub Copilot Chat with end-to-end encrypted AI. Powered by Privatemode.**

Use [Privatemode](https://www.privatemode.ai) as an AI provider inside GitHub Copilot Chat for VS Code and keep your data always private.

> **⚠️ Preview:** This extension is currently in preview. Features and APIs may change as we gather feedback and improve the extension.

## 🔒 About Privatemode

[Privatemode](https://www.privatemode.ai) is the first AI service with true end-to-end confidential computing.
It encrypts your data before it leaves your device and keeps it protected even during AI processing.
Its advanced design, among others, ensures the following:

- Your code, prompts, and responses are never visible to us or the infrastructure provider.
- Your data can't and won't be used for training.
- Verifiable privacy and integrity through hardware-based remote attestation.

With Privatemode, you can confidently use state-of-the-art open-source models like **Kimi K2.5** and **gpt-oss-120b** for coding, content generation, and analysis — without compromising security.

Privatemode is hosted in the EU and developed by [Edgeless Systems](https://www.edgeless.systems/).

## ⚡ Quick start

1. Make sure the [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extension is installed.
1. Install this extension.
1. Create a free [Privatemode account](https://www.privatemode.ai/) to get your API key.
1. Start the Privatemode Proxy with your API key (see [below](#ℹ️-about-the-privatemode-proxy)).
1. Open the *Manage Language Models* dialog of the GitHub Copilot Chat extension and select Privatemode as provider.
1. If your proxy wasn't started with an API key, you can enter one in VS Code.
1. Choose the models you want to see in the model picker.

You’re all set. Now you can chat with an AI inside VS Code while keeping your data secure.

## About the Privatemode Proxy

This extension requires the Privatemode Proxy to be running locally or on a trusted host. It does the following:

- It encrypts and decrypts all data.
- It verifies the integrity of the Privatemode backend.
- It exposes an API endpoint for GitHub Copilot Chat.

Run it via Docker:

```bash
docker run -p 8080:8080 \
  ghcr.io/edgelesssys/privatemode/privatemode-proxy:latest \
  --apiKey <your-api-key>
```
You can learn more about Privatemode and the proxy in the [docs](https://docs.privatemode.ai/quickstart).

## ⚠️ Disable inline code completions for privacy

Inline code completions (tab completions) from GitHub Copilot are not routed through this extension and will still be served directly by GitHub. To ensure that no code is sent to GitHub:

- Open Settings (`⌘ +,` / `Ctrl + ,`)
- Search for Copilot
- Disable completions globally or for specific file types

<!-- vale Microsoft.Quotes = NO -->
<img src="https://github.com/edgelesssys/privatemode-vscode/blob/main/assets/disable_completions.png?raw=true"
     alt="Disable completions"
     width="600" />
<!-- vale Microsoft.Quotes = YES -->

You can get privacy-preserving code completions by using the [Continue plugin](https://marketplace.visualstudio.com/items?itemName=Continue.continue) and [configuring it to use the Privatemode Proxy](https://docs.privatemode.ai/guides/coding-assistants-vscode#configuring-continue).

> **Note:** If you’re using a GitHub Copilot Business or Enterprise plan, the Manage Models option may not appear. To enable it, switch temporarily to a Pro or Free plan. This limitation is being addressed by Microsoft.
