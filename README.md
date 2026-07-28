<p align="center">
  <picture>
    <source srcset="apps/mail/public/white-icon.svg" media="(prefers-color-scheme: dark)">
    <img src="apps/mail/public/black-icon.svg" alt="Zero Logo" width="64" style="background-color: #000; padding: 10px;"/>
  </picture>
</p>

# Zero

An Open-Source Gmail Alternative for the Future of Email

## What is Zero?

Zero is an open-source email service that lets users **self-host** a local mailbox while integrating
external providers such as Gmail through channel plugins.

## Why Zero?

Most email services today are either **closed-source**, **data-hungry**, or **too complex to self-host**.
0.email is different:

- ✅ **Open-Source** – No hidden agendas, fully transparent.
- 🔒 **Data Privacy First** – Your emails, your data. Zero does not track, collect, or sell your data in any way. Please note: while we integrate with external services, the data passed through them is not under our control and falls under their respective privacy policies and terms of service.
- ⚙️ **Self-Hosting Freedom** – Run your own email app with ease.
- 📬 **Unified Inbox** – Connect multiple email providers like Gmail, Outlook, and more.
- 🎨 **Customizable UI & Features** – Tailor your email experience the way you want it.
- 🚀 **Developer-Friendly** – Built with extensibility and integrations in mind.

## Tech Stack

Zero is built with modern and reliable technologies:

- **Frontend**: Next.js, React, TypeScript, TailwindCSS, Shadcn UI
- **Backend**: Node.js, Drizzle ORM
- **Database**: PostgreSQL
- **Authentication**: Better Auth, Google OAuth
<!-- - **Testing**: Jest, React Testing Library -->

## Getting Started

### Backend local mail core verification

Run the backend-local mail kernel and adapter tests with:

```bash
pnpm test:mail-core
```

Phase one adds only the backend local-mail kernel, PostgreSQL/R2 adapter boundaries, and runtime
composition. Existing frontend and provider paths are not switched to this runtime yet; Gmail and
other provider synchronization remain on the existing paths.

### Video Tutorial

Watch this helpful video tutorial on how to set up Zero locally:

<p align="center">
  <a href="https://www.youtube.com/watch?v=yIXLQcjbeEM">
    <img src="https://img.youtube.com/vi/yIXLQcjbeEM/0.jpg" alt="Zero Setup Tutorial" />
  </a>
</p>

### Prerequisites

**Required Versions:**

- [Node.js](https://nodejs.org/en/download) (v18 or higher)
- [pnpm](https://pnpm.io) (v10 or higher)
- [Docker](https://docs.docker.com/engine/install/) (v20 or higher)

Before running the application, you'll need to set up services and configure environment variables. For more details on environment variables, see the [Environment Variables](#environment-variables) section.

### Setup Options

You can set up Zero in two ways:

<details open>
<summary><b>Docker Development (Recommended)</b></summary>

#### Quick Start Guide

1. **Clone and configure**

   ```bash
   git clone https://github.com/Mail-0/Zero.git
   cd Zero
   cp .env.example .env
   ```

   On PowerShell, use `Copy-Item .env.example .env`. Set at least
   `CREDENTIAL_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and any API keys you need.

2. **Initialize the database**

   Start the infrastructure and apply the schema explicitly:

   ```bash
   docker compose up --detach db valkey upstash-proxy
   pnpm db:migrate
   ```

   Run `pnpm db:migrate` as part of deployment whenever the database schema changes.
   `pnpm db:push` is a development-only initialization command and refuses production databases.

3. **Start the complete development stack**

   ```bash
   pnpm docker:deploy
   ```

   Docker runs Mail as a prebuilt Nginx static site and keeps the Wrangler backend in development
   mode. The deployment command builds both images, initializes the Docker dependency volumes,
   starts the complete stack, waits for every service to become healthy, and prints the final
   service status. It does not initialize, migrate, or clear application database schemas.

   Server source changes are hot-reloaded. Rebuild only Mail after changing frontend source or any
   `VITE_PUBLIC_*` value:

   ```bash
   docker compose up --detach --build --no-deps mail
   ```

   `docker compose restart mail` only restarts the existing frontend image.

4. **Manage the stack**

   ```bash
   docker compose ps
   docker compose logs --follow
   docker compose restart server
   docker compose down
   ```

   Open [http://localhost:3000](http://localhost:3000). Container ports and the Wrangler
   environment can be changed in `.env` using the `ZERO_*` variables from `.env.example`.
   `compose.yaml` is the only Compose definition and is intended exclusively for development.

   Rebuild after changing dependencies or the lockfile:

   ```bash
   docker compose up --build --detach
   ```

   </details>

<details open>
<summary><b>Devcontainer Setup</b></summary>

#### Quick Start guide

1. **Clone and Install**

   ```bash
   # Clone the repository
   git clone https://github.com/Mail-0/Zero.git
   cd Zero
   ```

   Then open the code in devcontainer and install the dependencies:

   ```
   pnpm install

   # Start the database locally
   pnpm docker:db:up
   ```

2. **Set Up Environment**
   - Run `pnpm nizzy env` to setup your environment variables
   - Run `pnpm nizzy sync` to sync your environment variables and types
   - Start the database with the provided docker compose setup: `pnpm docker:db:up`
   - Initialize the database: `pnpm db:push`

3. **Start The App**
   ```bash
   pnpm dev
   ```
   Visit [http://localhost:3000](http://localhost:3000)
     </details>

### Environment Setup

1. **Better Auth Setup**
   - Open the `.env` file and change the BETTER_AUTH_SECRET to a random string. (Use `openssl rand -hex 32` to generate a 32 character string)

     ```env
     BETTER_AUTH_SECRET=your_secret_key
     ```

   - Generate one stable credential-encryption key and keep it available to every server instance.
     Do not rotate it without re-encrypting existing credentials:

     ```bash
     openssl rand -base64 32
     ```

     Store the output as `CREDENTIAL_ENCRYPTION_KEY`.

2. **Google OAuth Setup** (Optional Zero-managed Gmail authorization)
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Add the following APIs in your Google Cloud Project: [People API](https://console.cloud.google.com/apis/library/people.googleapis.com), [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
     - Use the links above and click 'Enable' or
     - Go to 'APIs and Services' > 'Enable APIs and Services' > Search for 'Google People API' and click 'Enable'
     - Go to 'APIs and Services' > 'Enable APIs and Services' > Search for 'Gmail API' and click 'Enable'
   - Enable the Google OAuth2 API
   - Create OAuth 2.0 credentials (Web application type)
   - Add authorized redirect URIs:
     - Development:
       - `http://localhost:8787/api/integrations/gmail/validation/callback`
       - `http://localhost:8787/api/integrations/gmail/connect/callback`
     - Production:
       - `https://your-production-url/api/integrations/gmail/validation/callback`
       - `https://your-production-url/api/integrations/gmail/connect/callback`
   - Sign in as an administrator and configure the Client ID and Client Secret under
     **Settings → Integrations → Gmail**.

   - Add yourself as a test user:
     - Go to [`Audience`](https://console.cloud.google.com/auth/audience)
     - Under 'Test users' click 'Add Users'
     - Add your email and click 'Save'

> [!WARNING]
> The authorized redirect URIs in Google Cloud Console must exactly match the URLs shown in
> **Settings → Integrations → Gmail**, including protocol, domain, and path.

### Environment Variables

For Docker development, copy `.env.example` to `.env` and edit the values before starting the
stack. Docker Compose loads this file directly, so `pnpm nizzy sync` is not required.
`ZERO_WRANGLER_ENV` and the `ZERO_*_PORT` variables control the development containers.

For manual host development, `pnpm nizzy env` creates `.env` and `pnpm nizzy sync` copies it to the
individual applications.

### Database Setup

Zero uses PostgreSQL for storing data. Here's how to set it up:

1. **Start the Database**

   Start PostgreSQL, then apply the database schema explicitly:

   ```bash
   docker compose up --detach db
   pnpm db:push
   ```

   This creates a database with:
   - Name: `zerodotemail`
   - Username: `postgres`
   - Password: `postgres`
   - Port: `5432`

2. **Set Up Database Connection**

   Docker Compose constructs the container connection string from `POSTGRES_USER`,
   `POSTGRES_PASSWORD`, and `POSTGRES_DB`. Keep `DATABASE_URL` pointed at `localhost` for commands
   that you intentionally run on the host.

   For local development use:

   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/zerodotemail"
   ```

3. **Database Commands**
   - **Set up database tables**:

     ```bash
     pnpm db:push
     ```

     On an empty development database this applies the declarative schema directly. If Zero
     business schemas already exist, the command cancels by default and asks whether to clear and
     recreate only the `auth`, `app`, `integration`, and `mail` schemas. For an intentional
     non-interactive development reset, run `pnpm db:push -- --reset --yes`. Never use this command
     for production deployments.

   - **Create migration files** (after schema changes):

     ```bash
     pnpm db:generate
     ```

   - **Apply migrations**:

     ```bash
     pnpm db:migrate
     ```

   - **View database content**:
     ```bash
     pnpm db:studio
     ```
     > If you run `pnpm dev` in your terminal, the studio command should be automatically running with the app.

### Sync

Provider plugins receive remote changes and persist normalized messages in the PostgreSQL-backed
local mailbox. Gmail push notifications and scheduled reconciliation share the same idempotent
ingress command path.

## Contribute

Please refer to the [contributing guide](.github/CONTRIBUTING.md).

If you'd like to help with translating Zero to other languages, check out our [translation guide](.github/TRANSLATION.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Mail-0/Zero&type=Timeline)](https://www.star-history.com/#Mail-0/Zero&Timeline)

## This project wouldn't be possible without these awesome companies

<div style="display: flex; justify-content: center;">
  <a href="https://vercel.com" style="text-decoration: none;">
    <img src="public/vercel.png" alt="Vercel" width="96"/>
  </a>
  <a href="https://better-auth.com" style="text-decoration: none;">
    <img src="public/better-auth.png" alt="Better Auth" width="96"/>
  </a>
  <a href="https://orm.drizzle.team" style="text-decoration: none;">
    <img src="public/drizzle-orm.png" alt="Drizzle ORM" width="96"/>
  </a>
  <a href="https://coderabbit.com" style="text-decoration: none;">
    <img src="public/coderabbit.png" alt="Coderabbit AI" width="96"/>
  </a>
</div>

## 🤍 The team

Curious who makes Zero? Here are our [contributors and maintainers](https://0.email/contributors)
