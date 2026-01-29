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
*How I handled the tricky parts.*

### 1. Avoiding Infinite Update Loops

Two-way sync can easily cause an endless loop: a Sheet update writes to the DB, which then writes back to the Sheet again.

To stop this, every update includes metadata about its source.  
User edits trigger syncs, while system-generated updates are ignored by the webhook.  
This breaks the loop immediately at the entry point.

---

### 2. Handling Copy-Paste and Bulk Edits

Apps Script triggers often return `null` values during pastes or deletions, which can lead to missed updates.

As a fallback, the script reads the visible value directly from the edited range.  
This reliably captures bulk pastes, dates, and formatted values.

---

### 3. Concurrency and Simultaneous Edits

When many users edit at the same time, direct DB writes can cause conflicts and dirty reads.

All incoming updates are first pushed into a Redis queue.  
A worker then processes them sequentially, preserving order and data integrity.

---

### 4. Restricting Script Permissions

Overly broad script permissions increase security risk.

The Apps Script manifest is scoped to only the active spreadsheet and the backend API.  
Nothing else is accessible.

---

### 5. Secure Credential Management

Hardcoding secrets is unsafe and hard to maintain.

All credentials are injected via environment variables.  
Incoming webhooks are also validated using a custom `x-api-key` header.


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

## 🙏 Thank You

Thanks for taking the time to explore this project.  
If you’re reviewing this for learning, collaboration, or evaluation, I truly appreciate your attention and feedback—it helps make the system better.
