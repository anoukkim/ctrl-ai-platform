# ctrl-ai-platform
Community AI platform for shared LLM access, video generation, coding agents, app deployment, and member-built AI services on shared cloud infrastructure.

# Ctrl AI

Ctrl AI is a community AI platform designed to provide shared access to AI models, development tools, media generation, and deployable applications through a single online portal.

The platform combines cloud-hosted AI infrastructure with external AI APIs so members can create, build, run, store, and share AI-powered projects from one environment.

## Vision

Ctrl AI is intended to become a shared AI workspace where members can:

* Use hosted large language models
* Access external AI services such as Claude
* Generate and share AI-created videos and media
* Build software with AI-assisted coding tools
* Store and collaborate on source code
* Deploy applications created by members
* Share applications through an internal App Store
* Use shared GPU and cloud infrastructure
* Track individual AI usage and allocated credits

The long-term goal is to provide a unified environment for:

**Create → Build → Run → Store → Share → Deploy**

---

## Platform Overview

```text
                         CTRL AI
                            │
                     Ctrl AI Core
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
    Ctrl Chat           Ctrl Video           Ctrl Code
       │                    │                    │
 Claude / Ollama      Video Models        Coding Agents
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                        Ctrl Apps
                            │
                     Build & Deploy
                            │
                    Shared Community
```

All services share the same authentication, database, permissions, usage tracking, and cloud infrastructure.

---

# Core Modules

## Ctrl Chat

Shared AI chat environment.

Planned providers include:

* Claude API
* Ollama
* Qwen
* Llama
* Gemma
* Other hosted or API-based LLMs

Example flow:

```text
User
  ↓
Ctrl Chat
  ↓
AI Gateway
  ├─ Claude API
  └─ Ollama
       ↓
Hosted GPU Models
```

Users can select different models while Ctrl AI manages authentication, usage tracking, and access.

---

## Ctrl Video

AI video generation and community media sharing.

Users will be able to:

* Generate videos from prompts
* Select available video models
* Store generated videos
* Keep generations private
* Share videos with teams
* Publish videos to the Ctrl AI community
* View generation metadata
* Track generation cost

Architecture:

```text
User
  ↓
Ctrl Video
  ↓
Generation Request
  ↓
Job Queue
  ↓
GPU Worker / External Video API
  ↓
Generated Video
  ↓
Cloud Storage
  ↓
Video Hub
```

Video files are stored in object storage rather than directly inside the database.

---

## Ctrl Code

AI-assisted coding and development environment.

Planned functionality:

* AI code generation
* Code editing
* Repository access
* File creation
* Code explanation
* Testing
* Git commits
* Shared team repositories
* Application deployment

Architecture:

```text
Ctrl Code
   │
   ├─ Claude
   ├─ Coding LLM
   └─ Code Agent
         ↓
      Workspace
         ↓
        Git
         ↓
    Repository
```

Code execution will eventually run inside isolated containers or sandbox environments.

---

## Ctrl Apps

Internal application marketplace for projects created by members.

Members will be able to publish applications developed through Ctrl Code.

Example:

```text
Repository
    ↓
Docker Build
    ↓
Container Image
    ↓
Deployment
    ↓
Ctrl Apps
```

Applications can then appear in the portal:

```text
CTRL APPS

Meeting Summarizer
by Yuri
[ Launch ]

Document Translator
by AI Team
[ Launch ]

Research Assistant
by Ctrl AI
[ Launch ]
```

Applications may support different visibility levels:

* Private
* Team
* Members
* Public

---

# Ctrl AI Core

The Core service provides functionality shared by every module.

```text
Ctrl AI Core

Authentication
User Management
Role Management
Database
Usage Tracking
Credit Management
Permissions
Storage
API Gateway
Audit Logging
Secrets Management
```

The goal is to build the Core once and allow future AI services to reuse it.

---

# User Roles

Initial roles:

```text
admin
developer
member
```

### Admin

Can manage:

* Members
* Roles
* AI providers
* Usage
* Credits
* Infrastructure
* Applications
* Deployments
* System settings

### Developer

Can:

* Build applications
* Manage repositories
* Use coding agents
* Deploy applications
* Share projects

### Member

Can:

* Use AI services
* Generate content
* Use published applications
* Share allowed content

---

# Sharing Model

Content is private by default.

Each resource can define its visibility.

```text
private
team
members
public
```

Examples of resources using this model:

* Videos
* Applications
* Code repositories
* Files
* AI-generated content

This allows Ctrl AI to function as both a private workspace and a community platform.

---

# Usage & Credit System

Members may receive a monthly AI usage allocation.

Example:

```text
Monthly Credit

Allocated     ₩50,000
Used          ₩12,300
Remaining     ₩37,700
```

External AI services can be deducted from the member's allocated balance.

Examples:

```text
Claude API
Higgsfield API
Future AI APIs
```

Locally hosted models such as Ollama are primarily accounted for through shared infrastructure costs rather than provider API charges.

Example usage record:

```text
User: Yuri
Provider: Anthropic
Model: Claude
Input Tokens: 2,400
Output Tokens: 700
Provider Cost: $0.02
Internal Cost: ₩28
```

---

# Infrastructure

Initial infrastructure will be hosted primarily on Google Cloud.

Proposed architecture:

```text
Google Cloud
│
├─ Compute Engine
│   ├─ Ctrl AI Web
│   ├─ Backend API
│   └─ Docker Runtime
│
├─ GPU Compute Engine
│   ├─ Ollama
│   ├─ LLM Models
│   ├─ Coding Models
│   └─ Future Video Workers
│
├─ Cloud SQL
│   └─ PostgreSQL
│
├─ Cloud Storage
│   ├─ Videos
│   ├─ Images
│   └─ User Files
│
└─ Secret Manager
    ├─ Claude API Key
    ├─ Database Credentials
    └─ Other Provider Secrets
```

---

# Database

PostgreSQL will be used as the primary relational database.

Initial tables may include:

```text
users
teams
team_members

wallets
ai_usage

conversations
messages

videos

repositories

apps
deployments

user_servers

audit_logs
```

Large files are not stored directly in PostgreSQL.

Storage responsibilities:

| Data             | Storage            |
| ---------------- | ------------------ |
| User information | PostgreSQL         |
| AI usage         | PostgreSQL         |
| App metadata     | PostgreSQL         |
| Video files      | Cloud Storage      |
| Images           | Cloud Storage      |
| Source code      | Git                |
| Docker images    | Container Registry |
| API secrets      | Secret Manager     |

---

# Security Principles

Ctrl AI should follow the following principles from the beginning:

* Never expose master AI provider API keys to users
* Never commit credentials to Git
* Store production secrets in Secret Manager
* Keep PostgreSQL inaccessible from the public internet
* Keep Ollama internal API ports private
* Require HTTPS for public access
* Use role-based access control
* Run user applications inside isolated containers
* Record administrative and deployment activity
* Apply usage limits before calling paid APIs

External traffic should generally follow:

```text
Internet
   ↓
HTTPS
   ↓
Ctrl AI
   ↓
Backend
   ↓
Internal Services
```

Rather than exposing internal services directly.

---

# Initial Repository Structure

```text
ctrl-ai-platform/
│
├─ frontend/
│   └─ Web portal
│
├─ backend/
│   └─ Core API
│
├─ infra/
│   ├─ nginx/
│   └─ cloud/
│
├─ docker/
│   └─ Container configuration
│
├─ docs/
│   ├─ architecture.md
│   ├─ database.md
│   └─ deployment.md
│
├─ scripts/
│
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
└─ README.md
```

---

# Initial Technology Stack

### Frontend

* Next.js
* React
* TypeScript

### Backend

* Python
* FastAPI

### Database

* PostgreSQL
* Google Cloud SQL

### AI

* Claude API
* Ollama
* Open-source LLMs

### Infrastructure

* Google Cloud
* Compute Engine
* GPU Compute Engine
* Cloud Storage
* Secret Manager

### Deployment

* Docker
* Docker Compose
* Nginx

### Source Control

* Git
* GitHub initially
* Gitea/GitLab may be evaluated later

---

# Development Roadmap

## Phase 1 — Infrastructure

* Obtain Google Cloud project access
* Verify server specification
* Configure domain
* Configure HTTPS
* Install Docker
* Create Git repository
* Deploy initial frontend/backend

## Phase 2 — Ctrl AI Core

* PostgreSQL
* User authentication
* User roles
* Admin interface
* Usage tracking
* Credit system
* Secret management

## Phase 3 — Ctrl Chat

* Claude API integration
* Conversation storage
* Usage metering
* Model selector
* Ollama integration
* Local LLM hosting

## Phase 4 — Ctrl Video

* Video generation API
* Generation queue
* GPU workers
* Cloud Storage
* Video gallery
* Sharing controls

## Phase 5 — Ctrl Code

* Git integration
* Coding models
* AI coding agent
* Workspace
* Container sandbox
* Team repositories

## Phase 6 — Ctrl Apps

* Application registration
* Docker build pipeline
* Application deployment
* App catalog
* Launch interface
* Version management

## Phase 7 — Platform Operations

* Monitoring
* Logging
* Backups
* Infrastructure dashboards
* Cost monitoring
* GPU scaling
* Security hardening

---

# First Milestone

The first production milestone is intentionally small.

```text
Domain
  ↓
Ctrl AI Login
  ↓
Ctrl Chat
  ↓
Claude API
  ↓
Conversation Stored
  ↓
Usage Recorded
```

The first version should provide:

* Working domain
* HTTPS
* User login
* Claude chat
* PostgreSQL storage
* Member usage tracking
* Admin access

Once this core works reliably, additional modules can reuse the same infrastructure.

---

# Long-Term Goal

Ctrl AI is not intended to be only a shared chatbot.

It is intended to become a community AI development platform where members can:

**Use AI → Create → Develop → Deploy → Share**

through a single shared ecosystem.
