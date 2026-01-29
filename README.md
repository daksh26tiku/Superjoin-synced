# Synced: A High-Performance 2-Way Sync Engine


> **A production-grade synchronization engine connecting Google Sheets and MySQL in real-time.**

## 💎 Objective
To build a scalable, "multiplayer-ready" sync engine that handles high-frequency bidirectional updates between Google Sheets and a Database without data loss, infinite loops, or race conditions.

---

## 💎 My Approach & Intuition
I approached this not as a simple API integration, but as a **Distributed Systems** problem. 

Directly connecting a user-facing interface (Sheets) to a database is fragile; traffic spikes leads to locks and timeouts. My intuition was to **decouple** ingestion from processing. By introducing **Redis** as an event buffer, I transformed chaotic bursts of webhooks into a linear, manageable stream of database operations.

---

## 💎 Technical Nuances & Edge Cases
*How I solved the hard problems of 2-way synchronization.*

### 1. The "Infinite Loop" Trap
**Challenge:** A Sheet update triggers the DB, which updates the Sheet, triggering the DB again—forever.
**✅ My Fix (Context-Aware Logic):** I implemented source-flagging. Every update carries a metadata tag.
* `User Edit` → Triggers Sync.
* `System Sync` → Ignored by the webhook.
* **Result:** The loop is broken instantly at the source.

### 2. The "Copy-Paste" Fragility
**Challenge:** Standard Apps Script triggers (`e.value`) return `null` if a user pastes a range or deletes cells, causing data loss.
**✅ My Fix (Robust Retrieval):** I utilized `range.getDisplayValue()` as a fallback.
* **Result:** The script forces a read of the visible cell data, correctly capturing bulk pastes, dates, and currency formatting.

### 3. Concurrency & "Multiplayer" Race Conditions
**Challenge:** If 100 users edit simultaneously, 100 API calls hit the DB at once, leading to dirty reads.
**✅ My Fix (Redis Queues):**
* **Serialization:** Webhooks are acknowledged instantly but processed asynchronously via a Redis Queue.
* **Atomic Writes:** Database writes are performed sequentially by the worker, ensuring data integrity.

### 4. Manifest-Level Security
**Challenge:** Over-permissive scripts are a security risk.
**✅ My Fix (Scoped Permissions):** I configured `appsscript.json` to strictly limit scope.
* `spreadsheets.currentonly`: Script can *only* access the active file, not the user's Drive.
* `script.external_request`: Whitelisted access only to my backend API.

### 5. Secure Credential Management
**Challenge:** Hardcoding API keys or DB passwords in the source code.
**✅ My Fix (12-Factor App):** * All secrets injected via `.env` variables.
* Incoming webhooks are validated via a custom `x-api-key` header to reject malicious scanners.

---

## 🏗️ Architecture

At a high level, the system is designed to safely synchronize **high-frequency Google Sheet edits** with a relational database, while preventing feedback loops and race conditions.

```mermaid
graph LR
    A[Google Sheet] -- Webhook (ngrok) --> B[Node.js API]
    B -- Push Job --> C{Redis Queue}
    C -- Process Job --> D[Sync Worker]
    D -- Write/Update --> E[(MySQL Database)]
    E -- Change Event --> D
    D -- Update Row --> A
````

📐 **Deep Dive**
For a deeper breakdown of the database schema, worker logic, and internal data flow, refer to `ARCHITECTURE.md`.

---

## 💻 Tech Stack

Each layer of the system was chosen for **predictability, debuggability, and long-running reliability**.

* **Runtime:** Node.js (TypeScript)
* **Database:** MySQL (Persistent Storage)
* **Queue System:** Redis (Event Buffering)
* **Frontend:** HTML5, Tailwind CSS, Vanilla JS (Mission Control Dashboard)
* **Infrastructure:** Docker, Ngrok (Tunneling)

---

## 🛠️ Setup & Installation

The project is intentionally designed to be **locally reproducible** with minimal friction.

---

### Prerequisites

* Node.js (v18+)
* Docker Desktop (for Redis & MySQL)

---

### Installation

```bash
git clone https://github.com/yourusername/sheetql-sync.git
cd sheetql-sync
npm install
```

---

### Start Infrastructure

```bash
docker-compose up -d
```

---

### Environment Configuration

Create a `.env` file in the root directory:

```env
PORT=3000
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DB=sheets_db
REDIS_URL=redis://localhost:6379
```

---

### Run the Engine

```bash
npm run dev
```

---

### Connect Google Sheet

1. Open **Extensions → Apps Script**
2. Paste the script from `src/google-script.js`
3. Create an **Installable Trigger** → **On Edit**

```
::contentReference[oaicite:0]{index=0}
```
