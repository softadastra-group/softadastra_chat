# 🧩 Contributing to Softadastra Chat

Welcome to the **Softadastra Chat System** — a private, high-performance messaging module that powers real-time conversations across the [Softadastra](https://softadastra.com) marketplace.

Your contributions are highly appreciated.  
Please follow the guidelines below to ensure consistency, quality, and security across the project.

---

## 🧠 Philosophy

Softadastra is built with three core principles:

1. **Clarity** — Code should be simple, expressive, and maintainable.
2. **Performance** — Every line of code must serve efficiency.
3. **Security** — Protect user data at all times.

These principles apply to every pull request, commit, and line of documentation.

---

## ⚙️ Development Workflow

1. **Clone the repository**

   ```bash
   git clone git@github.com:softadastra/softadastra_chat.git
   cd softadastra_chat
   ```

2. **Create a new branch**

   ```bash
   git checkout -b feature/<feature_name>
   ```

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Run the local server**

   ```bash
   npm run dev
   ```

5. **Test your feature**

   Use the `/__tests__/` directory to create or update tests.

6. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat(chat): add <short_description>"
   ```

7. **Push your branch**

   ```bash
   git push origin feature/<feature_name>
   ```

8. **Open a Pull Request**

   From GitHub, submit your PR targeting the `dev` branch.

---

## 🧱 Code Standards

### ✅ General

- Follow **ESLint** and **Prettier** standards.
- Use **camelCase** for variables and **PascalCase** for classes.
- Write **clear, meaningful commit messages**.

### 🧩 Commit Message Convention

| Type        | Description                               |
| ----------- | ----------------------------------------- |
| `feat:`     | New feature                               |
| `fix:`      | Bug fix                                   |
| `refactor:` | Code improvement without feature change   |
| `docs:`     | Documentation update                      |
| `test:`     | Adding or improving tests                 |
| `chore:`    | Maintenance task (scripts, configs, etc.) |

**Example:**

```bash
git commit -m "feat(ws): implement typing indicator for real-time chat"
```

---

## 🧪 Testing Guidelines

- All new features **must include at least one test**.
- Run the test suite before committing:
  ```bash
  npm test
  ```
- Avoid hardcoding credentials or paths in test files.
- Ensure tests remain **isolated** and **idempotent**.

---

## 🧱 Directory Structure Overview

| Directory       | Purpose                       |
| --------------- | ----------------------------- |
| `routes/`       | REST API endpoints            |
| `ws/`           | WebSocket server and handlers |
| `repositories/` | Database logic (SQLite/MySQL) |
| `utils/`        | Shared helpers                |
| `__tests__/`    | Unit & integration tests      |
| `scripts/`      | Build or deployment scripts   |

---

## 🔐 Security and Privacy Rules

> ⚠️ **This repository is private and confidential.**

- Do **not** share or expose any internal file, schema, or credentials.
- Do **not** push directly to `main`. All changes must go through Pull Requests.
- Any suspicious or unauthorized access will result in immediate revocation.

---

## 🧭 Review Process

- Each Pull Request will be reviewed by the **Softadastra Core Team**.
- Review includes:
  - ✅ Code quality
  - ✅ Security checks
  - ✅ Style consistency
  - ✅ Performance considerations
- Merges are performed **only** by authorized maintainers.

---

## 🧑‍💻 Maintainers

| Role           | Name             | GitHub                                             |
| -------------- | ---------------- | -------------------------------------------------- |
| Lead Developer | Gaspard Kirira   | [@GaspardKirira](https://github.com/GaspardKirira) |
| Core Reviewer  | Softadastra Team | [@Softadastra](https://github.com/Softadastra)     |

---

## 🫱🏽‍🫲🏾 Final Note

Thank you for contributing to **Softadastra Chat**.  
Your work helps connect buyers and sellers across Africa — safely, instantly, and efficiently. 🌍💬
