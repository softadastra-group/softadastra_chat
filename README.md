<p align="center" style="margin:0;">
  <img 
    src="https://res.cloudinary.com/dwjbed2xb/image/upload/v1757224120/softadastra_awctjv.jpg" 
    alt="Softadastra Chat Banner" 
    width="100%" 
    style="
      display:block;
      height:auto;
      max-width:900px;
      margin:auto;
      object-fit:cover;
      border-radius:8px;
    ">
</p>

<h1 align="center">Softadastra Chat</h1>

<p align="center">
  <img src="https://img.shields.io/badge/C++20-Standard-blue">
  <img src="https://img.shields.io/badge/License-MIT-green">
</p>
# 🟠 Softadastra Chat System (Private Module)

The **Softadastra Chat System** is a private, high-performance messaging module used within the [Softadastra](https://softadastra.com) ecosystem.  
It powers real-time communication between buyers and sellers across the Softadastra Marketplace — ensuring instant, secure, and reliable messaging.

---

## 🚀 Overview

Softadastra Chat provides a **modern, scalable chat infrastructure** built with Node.js and WebSocket technology.

### Core Features

- 💬 **Text messaging** between users
- 🖼️ **Image sharing** (single or batch upload)
- ✉️ **Mixed content** (text + image)
- 🔔 **Real-time notifications** via WebSocket
- 👁️ **Read receipts & status tracking**
- 📦 **Persistent storage** for messages and threads

---

## 🗄️ Database Schema

The SQL schema is defined in [`/database/schema.sql`](database/schema.sql).

| Table                  | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `chat_threads`         | Represents a conversation between two users         |
| `chat_messages`        | Contains individual messages (text, image, or both) |
| `chat_message_batches` | Stores multiple images per message                  |
| `chat_message_status`  | Tracks message read/unread state                    |
| `notifications`        | Global user notification system                     |

---

## 🔐 Access Rules

> ⚠️ **Private Repository** — Access to this project is strictly limited.

| Permission                 | Description            |
| -------------------------- | ---------------------- |
| ✅ Code Read               | Allowed                |
| ✅ Contribute via PR       | Allowed (after review) |
| ❌ Production Deployment   | Not allowed            |
| ❌ Cross-repository Access | Forbidden              |

---

## 🧩 Planned Features

- [ ] `POST /chat/send` — Send message endpoint
- [ ] `GET /chat/messages` — Retrieve messages per thread
- [ ] `GET /chat/threads` — List user conversations
- [ ] WebSocket / Polling — Real-time synchronization
- [ ] Notification integration via `notifications` table

---

## 🧭 Contribution Workflow

1. 🔀 Create a branch — `feature/<feature_name>`
2. 💻 Develop and test locally
3. 🔁 Open a **Pull Request** for review
4. ✅ Merge only after approval by the Softadastra core team

---

## 🏗️ Tech Stack

- **Runtime:** Node.js
- **Database:** SQLite / MySQL
- **WebSocket Engine:** `ws`
- **Utilities:** Express.js, JSON helpers, internal repositories

---

## 🧾 Internal References

- **Main Repository:** [`softadastra`](https://github.com/softadastra)
- **Base API Endpoint:** `https://softadastra.com/api/chat`
- **Technical Lead:** [@GaspardKirira](https://github.com/GaspardKirira)

---

## 🛡️ Confidentiality Notice

This repository and its contents are **confidential**.  
Unauthorized distribution, reproduction, or modification is strictly prohibited.  
All actions within this repository are monitored and traceable.

---

### 💬 Thank you for contributing to Softadastra.

> Together, we’re building Africa’s next-generation commerce platform.
