# Privatemode Provider for GitHub Copilot Chat

![Preview](https://img.shields.io/badge/status-preview-yellow)

Enable confidential AI coding features with [Privatemode](https://www.privatemode.ai) in VS Code's GitHub Copilot Chat. Privatemode uses Confidential Computing to keep your prompts end-to-end encrypted—even Privatemode itself cannot access them in plaintext. Developed by [Edgeless Systems](https://www.edgeless.systems/).

> **⚠️ Preview:** This extension is currently in preview. Features and APIs may change as we gather feedback and improve the extension.

## ⚡ Quick start for developers

1. Clone the repository and open it in VS Code (>= v1.104.0).
2. Install dependencies and build the extension:

   ```bash
   npm install
   npm run compile
   ```

3. Launch a development host (F5) which starts an Extension Development Host with the extension pre‑loaded.
4. Ensure the Privatemode Proxy is running locally on `localhost:8080` (see the proxy guide below).
5. Open the VS Code **Chat** view, select the model picker → **Manage Models…**, and choose **Privatemode** as the provider.
6. (Optional) Add an API key if your proxy is configured without one.

### Useful scripts

* **`npm run compile`** – Compiles the TypeScript source files into JavaScript (placed in the `out/` directory) using the project’s `tsconfig.json`. Required before running, testing, or packaging the extension.
* **`npm run watch`** – Starts the TypeScript compiler in watch mode; it automatically recompiles whenever a source file changes, which is handy during active development.
* **`npm run lint`** – Executes ESLint across the code base, reporting style violations and potential bugs according to the configured linting rules.
* **`npm run format`** – Formats all source files with Prettier, enforcing a consistent code style throughout the project.
* **`npm run test`** – First runs `npm run compile`, then launches VS Code in a head‑less test runner (`@vscode/test-cli`) and executes the Mocha test suite located in `src/test/`. The command exits with a non‑zero status if any test fails.

## 🏠 Privatemode Proxy

The [Privatemode Proxy](https://docs.privatemode.ai/architecture/client-side) is a self‑hosted service that serves as your local API endpoint for the Privatemode API. It handles encryption of prompts, decryption of responses, and verification of the remote Privatemode deployment through attestation.

## 📦 Packaging and installing

To package the extension and install it in your local VS Code instance:

1. Install the VSCE tool (if you haven't already):

   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:

   ```bash
   npm run package
   ```

3. Install the packaged extension:

   ```bash
   npm run install:local
   ```

4. (Optional) Uninstall the extension:

   ```bash
   code --uninstall-extension edgeless-systems.privatemode-vscode
   ```

## 📚 Learn more

* [Privatemode](https://docs.privatemode.ai/)
* [VS Code Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

This extension is based on the [Hugging Face VS Code Chat extension](https://github.com/huggingface/huggingface-vscode-chat).
