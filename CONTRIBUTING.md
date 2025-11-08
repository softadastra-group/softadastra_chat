# 🧩 Contributing to Softadastra Chat

Welcome to the **Softadastra Chat System** — the private, high-performance messaging core powering real-time communication within the [Softadastra](https://softadastra.com) marketplace.

We deeply appreciate your contribution and commitment to building Africa’s next-generation commerce infrastructure.  
Please read these guidelines carefully to ensure **consistency**, **security**, and **technical excellence** across the project.

---

## 🧠 Core Philosophy

Softadastra is built upon three guiding principles:

1. **Clarity** — Code should be simple, expressive, and maintainable.
2. **Performance** — Every line must serve efficiency and scalability.
3. **Security** — User data protection is non-negotiable.

Every pull request, commit, and documentation edit must respect these values.

---

## ⚙️ Development Workflow

### 1. Clone the Repository

```bash
git clone git@github.com:softadastra/softadastra_chat.git
cd softadastra_chat
```

### 2. Create a Feature Branch

```bash
git checkout -b feature/<feature_name>
```

> Follow the naming pattern `feature/<scope>` or `fix/<scope>` (e.g., `feature/ws-typing-indicator`).

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Development Server

```bash
npm run dev
```

### 5. Implement and Test

Use `/__tests__/` for your unit or integration tests.  
Avoid coupling tests to external services or hardcoded data.

### 6. Commit and Push

```bash
git add .
git commit -m "feat(ws): add real-time typing indicator"
git push origin feature/<feature_name>
```

### 7. Submit a Pull Request

Open your PR against the `dev` branch.  
All merges into `main` are handled by **authorized maintainers only**.

---

## 🧩 Branching Policy

| Branch      | Purpose                    | Merge Access              |
| ----------- | -------------------------- | ------------------------- |
| `main`      | Stable release branch      | Maintainers only          |
| `dev`       | Active development branch  | All contributors          |
| `feature/*` | Feature or fix in progress | Contributor who opened it |

> 🔒 Direct commits to `main` are strictly forbidden.

---

## 🧱 Code Standards

### ✅ General Rules

- Follow **ESLint** + **Prettier** formatting.
- Use **camelCase** for variables and **PascalCase** for classes.
- Write **self-documenting code** and concise inline comments.
- Use `async/await` consistently for asynchronous operations.
- Avoid deeply nested callbacks or large functions.

### 🧩 Commit Message Convention

| Type        | Description                             |
| ----------- | --------------------------------------- |
| `feat:`     | Introduces a new feature                |
| `fix:`      | Bug fix or issue resolution             |
| `refactor:` | Code improvement without feature change |
| `docs:`     | Documentation update                    |
| `test:`     | Adds or updates tests                   |
| `chore:`    | Build, tooling, or maintenance changes  |

**Example:**

```bash
git commit -m "feat(chat): implement batch image upload support"
```

---

## 🧪 Testing Guidelines

- Every new feature **must include at least one test**.
- Run all tests before submitting a PR:
  ```bash
  npm test
  ```
- Avoid global state pollution; ensure tests are **idempotent**.
- Prefer **mocked database connections** for unit tests.
- Store test fixtures in `__tests__/fixtures`.

---

## 🔍 Preflight Checks (Before Pushing)

Before pushing any branch, run the following:

```bash
npm run lint
npm run test
npx gitleaks detect --no-banner
```

✅ Your commit will pass the **Softadastra Quality Gate** only if:

- Lint passes with no warnings.
- Tests pass (100% required).
- No security leaks are detected.

---

## ⚙️ Optional: Pre-commit Hook (Automation)

To automate code quality checks before committing, install **Husky** and **lint-staged**:

```bash
npm install husky lint-staged --save-dev
npx husky install
```

Add to your `package.json`:

```json
"lint-staged": {
  "*.js": ["eslint --fix", "prettier --write"]
}
```

Then enable Husky pre-commit hook:

```bash
npx husky add .husky/pre-commit "npx lint-staged"
git add .husky/pre-commit
```

---

## 🧭 Directory Structure Overview

| Directory         | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `routes/`         | REST API endpoints                        |
| `ws/`             | WebSocket logic (likes, chat, analytics)  |
| `repositories/`   | Database interaction layer                |
| `utils/`          | Helper utilities and validators           |
| `__tests__/`      | Unit & integration tests                  |
| `scripts/`        | Automation, build, or maintenance scripts |
| `public/uploads/` | Static uploaded assets                    |

---

## 🔐 Security & Privacy Rules

> ⚠️ **Private Repository — Confidential Use Only**

- Never share internal code, schema, or credentials outside the Softadastra organization.
- All commits are automatically scanned for secrets.
- Avoid storing sensitive environment variables in `.env.example`.
- Access to production or staging environments is **strictly restricted**.
- Do **not** expose internal endpoints in documentation.

---

## 🧮 Review Process

Each Pull Request is reviewed by the **Softadastra Core Team**.

**Review Checklist:**

- ✅ Code readability and clarity
- ✅ Security and authentication safety
- ✅ Performance and scalability impact
- ✅ Adherence to style and naming conventions
- ✅ Test coverage and isolation

Only authorized maintainers may perform merges after approval.

---

## 🧑‍💻 Maintainers

| Role           | Name                             | GitHub                                             |
| -------------- | -------------------------------- | -------------------------------------------------- |
| Lead Developer | **Gaspard Kirira**               | [@GaspardKirira](https://github.com/GaspardKirira) |
| Core Reviewer  | **Softadastra Engineering Team** | [@Softadastra](https://github.com/Softadastra)     |

---

## 🧾 Confidentiality Reminder

This repository and its content are **strictly confidential**.  
By contributing, you agree to Softadastra’s internal confidentiality and intellectual property policies.  
All activity (commits, PRs, comments) is logged for compliance and traceability.

---

<p align="center">
  <strong>🟠 Thank you for contributing to Softadastra Chat.</strong><br>
  <em>Together, we’re shaping Africa’s future of digital commerce — one message at a time.</em>
</p>
