# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ESLint

- Configure no-unused-vars to allow underscore-prefixed variables. Confidence: 0.85
- Use globals library for ESLint environment configuration. Confidence: 0.80

# UI Components

- Use native <dialog> element for modal dialogs instead of custom implementations. Confidence: 0.75

# Libraries

- Do not use dockview library due to unpredictable height behavior and animation limitations. Confidence: 0.80
- Use drizzle as the database ORM. Confidence: 0.70
- Use bun for testing. Confidence: 0.70
- Use nanoid for generating IDs. Confidence: 0.70

# RPC / API

- Use async/await in @codehz/rpc mutation handlers instead of Bun's fetch .sync() — the framework seamlessly supports async. Confidence: 0.70

# Database

- Use db.transaction() to wrap multi-step write operations (insert/update loops) to ensure atomicity and avoid partial updates. Confidence: 0.70
