<p align="center" style="margin:0;">
  <img 
    src="https://res.cloudinary.com/dwjbed2xb/image/upload/v1762591088/Chat-softadastra_tgcghk.png" 
    alt="Softadastra Chat Banner" 
    width="100%" 
    style="display:block;height:auto;max-width:900px;margin:auto;object-fit:cover;border-radius:8px;">
</p>

<h1 align="center">💬 Softadastra Chat System</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-Backend-green?logo=node.js">
  <img src="https://img.shields.io/badge/WebSocket-Realtime-blue?logo=websocket">
  <img src="https://img.shields.io/badge/License-MIT-orange">
  <img src="https://img.shields.io/badge/Status-Private_Module-red">
</p>

<p align="center">
  <strong>Private, high-performance messaging system powering real-time communication across the <a href="https://softadastra.com" target="_blank">Softadastra</a> ecosystem.</strong>
</p>

---

## 🧭 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Database Schema](#-database-schema)
- [Access Policy](#-access-policy)
- [Planned API Endpoints](#-planned-api-endpoints)
- [Contribution Workflow](#-contribution-workflow)
- [Tech Stack](#-tech-stack)
- [Internal References](#-internal-references)
- [Confidentiality Notice](#-confidentiality-notice)

---

## 🚀 Overview

**Softadastra Chat** is a private, production-grade messaging module designed for the [Softadastra Marketplace](https://softadastra.com).  
It connects **buyers and sellers** through a fast, encrypted, and event-driven system built with **Node.js** and **WebSockets**.

### ✨ Core Features

- 💬 **Instant text messaging** between users
- 🖼️ **Image uploads** — single or batch
- ✉️ **Mixed content** (text + media)
- 🔔 **Real-time notifications** via WS
- 👁️ **Read receipts & presence indicators**
- 📦 **Persistent message storage** (SQLite / MySQL)
- 🧠 **Scalable architecture** designed for large user bases

---

## 🧱 System Architecture

```text
Client (SPA / Mobile)
   ↓ WebSocket + REST
Node.js Server (Softadastra Chat)
   ↓
Database Layer (SQLite / MySQL)
   ↓
Softadastra Core API / Notification Hub
```

Each WebSocket connection is **authenticated** via a JWT or secure ticket, and all data exchanges follow the internal event protocol used by the **Softadastra real-time infrastructure**.

---

## 🗄️ Database Schema

SQL schema is defined in [`/database/schema.sql`](database/schema.sql):

| Table                    | Description                                       |
| ------------------------ | ------------------------------------------------- |
| **chat_threads**         | Represents a conversation between two users       |
| **chat_messages**        | Stores individual messages (text, image, or both) |
| **chat_message_batches** | Supports multiple images per message              |
| **chat_message_status**  | Tracks delivery and read status                   |
| **notifications**        | Global user notification system                   |

---

## 🔐 Access Policy

> ⚠️ **Confidential Module** — Internal use only.

| Access Type       | Permission                        |
| ----------------- | --------------------------------- |
| 🔓 Code Read      | Authorized contributors only      |
| 🔄 Pull Requests  | Allowed after approval            |
| 🚫 Deployment     | Forbidden without core validation |
| 🚫 External Forks | Strictly prohibited               |

---

## 🧩 Planned API Endpoints

| Endpoint             | Description                   | Status     |
| -------------------- | ----------------------------- | ---------- |
| `POST /chat/send`    | Send a new message            | 🔄 Planned |
| `GET /chat/messages` | Retrieve messages in a thread | 🔄 Planned |
| `GET /chat/threads`  | List user conversations       | 🔄 Planned |
| `WS /chat`           | Real-time updates & presence  | ✅ Active  |
| `WS /notifications`  | Notification stream           | ✅ Active  |

---

## 🧭 Contribution Workflow

1. 🔀 **Create a branch** → `feature/<name>`
2. 💻 **Implement and test** locally
3. 🔁 **Open a Pull Request** for review
4. ✅ **Merge** only after approval by the **Softadastra Core Team**

> All commits are scanned for security via **gitleaks** and must follow the Softadastra commit conventions.

---

## 🏗️ Tech Stack

| Layer                | Technology                               |
| -------------------- | ---------------------------------------- |
| **Runtime**          | Node.js                                  |
| **Framework**        | Express.js                               |
| **WebSocket Engine** | ws                                       |
| **Database**         | SQLite / MySQL                           |
| **Auth**             | PHP-JWT & WS Ticket Validation           |
| **Utilities**        | Multer, CORS, Compression, Cookie Parser |

---

## 🧾 Internal References

- 🏢 **Main Repository:** [softadastra](https://github.com/softadastra)
- 🌍 **Base API Endpoint:** `https://softadastra.com/api/chat`
- 👨‍💻 **Technical Lead:** [@GaspardKirira](https://github.com/GaspardKirira)
- 🔗 **Ecosystem:** [Softadastra Marketplace](https://softadastra.com)

---

## 🛡️ Confidentiality Notice

This repository and all its contents are **strictly confidential**.  
Unauthorized access, reproduction, or redistribution is prohibited.  
All commits and access events are logged and monitored.

---

<p align="center">
  <strong>🟠 Together, we’re building Africa’s next-generation commerce infrastructure.</strong><br>
  <em>— The Softadastra Engineering Team</em>
</p>
