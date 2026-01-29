# 🚀 SheetQL: High-Performance 2-Way Sync Engine

> **A production-grade synchronization engine connecting Google Sheets and MySQL in real-time.** > Built for scale, conflict resolution, and "multiplayer" concurrency.

![Dashboard Preview](https://via.placeholder.com/800x400?text=Mission+Control+Dashboard+Preview) 
*(Replace this link with a screenshot of your actual Dashboard)*

---

## 💡 The Problem
Building a 2-way sync between a spreadsheet and a database sounds simple, but in production, it faces three major challenges:
1.  **Infinite Loops:** The Sheet updates the DB, which updates the Sheet, triggering an infinite cycle.
2.  **Concurrency:** Multiple users editing the sheet simultaneously ("Multiplayer Mode") causes race conditions and data loss.
3.  **Fragility:** Simple webhooks break on copy-paste operations or formatting changes.

## 🛠️ The Solution
**SheetQL** is not just a script; it's a **full-stack sync engine** designed to solve these edge cases. It uses **Redis Queues** to decouple data ingestion from processing, allowing it to handle traffic spikes (e.g., 100+ concurrent editors) without crashing.

### Key Technical Features
* **🚀 Event-Driven Architecture:** Uses **Redis** as a message broker to handle high-throughput webhook events.
* **🔄 Context-Aware Sync:** Implements logic to detect the source of a change (`USER_EDIT` vs `SYSTEM_SYNC`), effectively preventing infinite loops.
* **🛡️ Robust Input Handling:** Custom Google Apps Script uses `getDisplayValue()` to handle **large copy-pastes** and formatted data that breaks standard scripts.
* **🎛️ Mission Control Dashboard:** A real-time UI to monitor active workers, system health, and a live feed of incoming/outgoing events.

---

## 🏗️ Architecture

```mermaid
graph LR
    A[Google Sheet] -- Webhook (ngrok/SSL) --> B(Node.js API)
    B -- Push Job --> C{Redis Queue}
    C -- Process Job --> D[Sync Worker]
    D -- Write/Update --> E[(MySQL Database)]
    E -- Change Event --> D
    D -- Update Row --> A
