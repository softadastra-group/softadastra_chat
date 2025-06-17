# softadastra_chat

# 🟠 Softadastra Chat System (Private Module)

Ce dépôt contient le module **privé** de messagerie utilisé sur la plateforme [Softadastra](https://softadastra.com), conçu pour permettre :

- ✅ l’envoi de **messages texte**
- 🖼️ l’envoi de **photos seules**
- ✉️ l’envoi de **texte + image**
- 📦 l’envoi de **lots de fichiers/images**
- 🔔 la gestion de **notifications utilisateurs**

---

## 📁 Structure de la base de données (SQL)

Voir le fichier `schema.sql` (fourni dans le dossier `/database`) qui contient :

- `chat_threads` → une conversation entre 2 utilisateurs
- `chat_messages` → les messages (texte, image, ou les deux)
- `chat_message_batches` → galerie d’images pour un message
- `chat_message_status` → vu ou non vu
- `notifications` → système global de notifications

---

## 🔐 Règles d’accès

> ❗ **Ce module est privé. Tu ne dois pas accéder ni modifier d’autres dépôts de l’organisation.**

| Droit                                 | Description                  |
| ------------------------------------- | ---------------------------- |
| 🔍 Lecture du code                    | ✅ Autorisé                  |
| 📝 Proposer du code                   | ✅ Autorisé via Pull Request |
| ⚙️ Déployer en prod                   | ❌ Non autorisé              |
| 👀 Voir les autres dépôts Softadastra | ❌ Interdit                  |

---

## 🔧 Tâches prévues

- [ ] API `POST /chat/send`
- [ ] API `GET /chat/messages`
- [ ] API `GET /chat/threads`
- [ ] WebSocket ou polling pour messages en temps réel
- [ ] Intégration notifications (`notifications` table)

---

## 🚦 Workflow de contribution

1. 🔀 Crée une branche (`feature/nom_fonction`)
2. 💻 Développe et teste localement
3. 🔁 Ouvre une **pull request**
4. ✅ L’équipe Softadastra validera avant merge

---

## 📎 Références internes

- Dépôt principal : `softadastra`
- Lien API de base : `https://softadastra.com/api/chat`
- Responsable technique : [@gaspardkirira](https://github.com/gaspardkirira)

---

## 🛡️ Confidentialité

> Ce projet est confidentiel. Ne partage pas ce code ni ses spécifications sans autorisation écrite. Tout accès est traçable.

---

Merci de contribuer à Softadastra 🙏  
Tu peux poser des questions dans les issues ou contacter directement le responsable du dépôt.
