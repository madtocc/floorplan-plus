# Maps for developers

This fork's default reader is an engineer working in the code, so `architecture.json` sets `"audience": "developers"` unless the user asks for a plain-language map. This page says what changes for that reader. Everything in [choosing-boundaries.md](choosing-boundaries.md) and [writing-descriptions.md](writing-descriptions.md) still holds.

## Carve by what a developer would open

- **A monorepo's packages are the top-level board.** One node for each deployable (`packages/api`, `packages/queue-processor`, `apps/web`), one for each shared package, plus infra and tests. Keep the package's own name in the label ("API (packages/api)" is fine here).
- **Inside a layered backend, carve by domain module, not by layer.** `modules/orders/**` (controller, service, repository, DTOs together) is one chip; "all controllers" is not. The UML class diagram already shows the layers within a module.
- **Schema and migrations get a `data` node** (`prisma/**`, `db/schema/**`, `drizzle/**`, `liquibase/**`, `migrations/**`). `.prisma` files count as code, so they are on the map and each model opens from the data diagram.
- **Generated code stays off the board.** Put generated routes, API clients and types in `"ignore"` (`**/routes/routes*.ts` written by tsoa, `**/*.gen.ts`, `**/generated/**`). tsoa endpoints sit on their controllers either way.
- **Smart contracts are a `service` or `library` node of their own** (`contracts/**/*.sol`), with an `rpc` edge from the code that calls them through a provider (ethers, viem), since the scan can't see that call.
- **Tests are one node per repo**, claimed with `exclude` on the source nodes (`**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts`).

## Edges the scan can't see in these stacks

Add them only where the code shows them (a queue URL in settings, a schedule in the infra folder):

- producer → queue → consumer (`queue`): SQS, BullMQ, Pub/Sub. One edge from the package that sends to the package that consumes, labelled with the queue's name.
- scheduler → job (`call`): cron expressions in Terraform, EventBridge rules, Kubernetes CronJobs, Firebase schedules.
- service → database (`data`): the package that owns the ORM client to the external database node. Give the external node its `packages` (`npm:@prisma/client`, `npm:pg`, `npm:drizzle-orm`).
- service → chain (`rpc`): calls through ethers or viem to deployed contracts.
- webhooks in from a third party (`http`, from the external node to the handler).

## Descriptions

Technical style ([writing-descriptions.md](writing-descriptions.md), "Who you're writing for"): name the pattern and the collaborators ("tsoa controller for campaign funding; delegates to CampaignFundingService"), not the business outcome. Keep class and function names exact so they match the UML diagrams.

## UML comes with the map

The build reads classes, what each constructor is handed (inversify, NestJS and plain constructors), the calls methods make on those, and the data model (Prisma, Drizzle) into `graph.uml`. The map's **UML** button draws from it:

- **Classes**: a part, a file, or one class and its neighbours.
- **Data model**: tables, keys and relations.
- **Sequence**: any endpoint or method traced call by call down to the database, or one of the flows you wrote.

So when a developer asks "how does X work", prefer a flow whose steps name real files, and tell them the endpoint's sequence diagram is one click away on its card. The build's report line `UML  N classes · M interfaces · K data entities` says what was found; when it's missing, the code has no classes or schema the reader understands (plain functions and SQL migrations aren't read yet), and the map's own flows still draw as sequence diagrams.
