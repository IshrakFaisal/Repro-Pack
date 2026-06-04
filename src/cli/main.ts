import { parseArgs } from "node:util";
import type { ReviewStatus, StoredReproPack } from "../types/schemas";
import { processTicket } from "../pipeline/process-ticket";
import { createRuntime } from "../runtime/app-runtime";
import { syncIssuesForPack } from "../issues/issue-sync";
import { runRetentionCleanup } from "../jobs/retention";

function normalizeCommandArgs(): string[] {
  const argv = process.argv.slice(2);
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function parseTicketReference(ticketRef: string) {
  const looksLikePath =
    ticketRef.includes("\\") || ticketRef.includes("/") || ticketRef.toLowerCase().endsWith(".json");

  return {
    fixtureId: looksLikePath ? undefined : ticketRef,
    ticketPath: looksLikePath ? ticketRef : undefined
  };
}

function matchesPackSearch(pack: StoredReproPack, search?: string): boolean {
  if (!search?.trim()) {
    return true;
  }

  const needle = search.trim().toLowerCase();
  return pack.ticketId.toLowerCase().includes(needle) || pack.reproPack.summary.toLowerCase().includes(needle);
}

function sortPacks(packs: StoredReproPack[], sort = "updatedAt", direction = "desc"): StoredReproPack[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...packs].sort((left, right) => {
    if (sort === "confidence") {
      return (left.reproPack.confidence.overall - right.reproPack.confidence.overall) * multiplier;
    }

    const leftValue = sort === "ticketId" ? left.ticketId : sort === "createdAt" ? left.createdAt : left.updatedAt;
    const rightValue = sort === "ticketId" ? right.ticketId : sort === "createdAt" ? right.createdAt : right.updatedAt;
    return leftValue.localeCompare(rightValue) * multiplier;
  });
}

async function run() {
  const [command, ...rest] = normalizeCommandArgs();
  const runtime = await createRuntime({ skipRetentionCleanup: command === "cleanup" });
  const { config, logger, providers, store, jobs, tenantConfigStore } = runtime;

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(
      "Usage:\n  repro-pack process --ticket <fixture-id|path> [--tenant <tenant-id>] [--support-ticket-id <id>] [--dry-run] [--write-artifacts] [--async] [--max-attempts <n>] [--customer-consent-confirmed]\n  repro-pack health\n  repro-pack jobs [--tenant <tenant-id>] [--status <queued|running|succeeded|failed|dead_lettered>]\n  repro-pack job --id <job-id> [--tenant <tenant-id>]\n  repro-pack retry-job --id <job-id> [--tenant <tenant-id>]\n  repro-pack cleanup [--tenant <tenant-id>] [--write]\n  repro-pack audit-events [--tenant <tenant-id>] [--action <name>] [--outcome <success|error>] [--ticket <ticket-id>]\n  repro-pack packs [--tenant <tenant-id>] [--status <draft|reviewed|approved|rejected>] [--search <text>] [--sort <updatedAt|createdAt|ticketId|confidence>] [--direction <asc|desc>]\n  repro-pack pack --ticket <ticket-id> [--tenant <tenant-id>]\n  repro-pack review --ticket <ticket-id> --status <reviewed|approved|rejected> [--tenant <tenant-id>] [--reviewer <name>] [--note <text>]\n  repro-pack sync-issues --ticket <ticket-id> [--tenant <tenant-id>] [--target github] [--target jira] [--write]\n  repro-pack export-issue --ticket <ticket-id> [--tenant <tenant-id>] [--target github|jira]\n"
    );
    return;
  }

  if (command === "health") {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          version: config.appVersion,
          buildHash: config.buildHash,
          fixtureRoot: config.fixtureRoot,
          dataRoot: config.dataRoot,
          tenantConfigRoot: config.tenantConfigRoot
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (command === "jobs") {
    const parsed = parseArgs({
      args: rest,
      options: {
        tenant: { type: "string" },
        status: { type: "string" }
      }
    });
    const status = parsed.values.status;
    if (status && !["queued", "running", "succeeded", "failed", "dead_lettered"].includes(status)) {
      throw new Error("--status must be one of queued, running, succeeded, failed, dead_lettered");
    }

    const list = await store.listJobs(parsed.values.tenant);
    const filtered = list.filter((job) => !status || job.status === status);
    process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
    return;
  }

  if (command === "audit-events") {
    const parsed = parseArgs({
      args: rest,
      options: {
        tenant: { type: "string" },
        action: { type: "string" },
        outcome: { type: "string" },
        ticket: { type: "string" }
      }
    });
    const outcome = parsed.values.outcome;
    if (outcome && !["success", "error"].includes(outcome)) {
      throw new Error("--outcome must be one of success, error");
    }

    const events = await store.listAuditEvents({
      tenantId: parsed.values.tenant,
      action: parsed.values.action,
      outcome: outcome as "success" | "error" | undefined,
      ticketId: parsed.values.ticket
    });
    process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
    return;
  }

  if (command === "job") {
    const parsed = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        tenant: { type: "string" }
      }
    });
    const jobId = parsed.values.id;
    if (!jobId) {
      throw new Error("--id is required");
    }

    const job = await store.getJob(jobId, parsed.values.tenant ?? "default");
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }

  if (command === "retry-job") {
    const parsed = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        tenant: { type: "string" }
      }
    });
    const jobId = parsed.values.id;
    if (!jobId) {
      throw new Error("--id is required");
    }

    const job = await jobs.retryFailed(jobId, parsed.values.tenant ?? "default");
    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }

  if (command === "cleanup") {
    const parsed = parseArgs({
      args: rest,
      options: {
        tenant: { type: "string" },
        write: { type: "boolean" }
      }
    });
    const results = await runRetentionCleanup({
      config,
      store,
      tenantConfigStore,
      logger,
      tenantId: parsed.values.tenant,
      dryRun: !parsed.values.write
    });
    process.stdout.write(`${JSON.stringify({ dryRun: !parsed.values.write, results }, null, 2)}\n`);
    return;
  }

  if (command === "packs") {
    const parsed = parseArgs({
      args: rest,
      options: {
        tenant: { type: "string" },
        status: { type: "string" },
        search: { type: "string" },
        sort: { type: "string" },
        direction: { type: "string" }
      }
    });
    const status = parsed.values.status;
    const sort = parsed.values.sort ?? "updatedAt";
    const direction = parsed.values.direction ?? "desc";
    if (status && !["draft", "reviewed", "approved", "rejected"].includes(status)) {
      throw new Error("--status must be one of draft, reviewed, approved, rejected");
    }
    if (!["updatedAt", "createdAt", "ticketId", "confidence"].includes(sort)) {
      throw new Error("--sort must be one of updatedAt, createdAt, ticketId, confidence");
    }
    if (!["asc", "desc"].includes(direction)) {
      throw new Error("--direction must be one of asc, desc");
    }

    const packs = await store.listPacks(parsed.values.tenant);
    const filtered = sortPacks(
      packs
        .filter((pack) => !status || pack.status === status)
        .filter((pack) => matchesPackSearch(pack, parsed.values.search)),
      sort,
      direction
    ).map((pack) => ({
      tenantId: pack.tenantId,
      ticketId: pack.ticketId,
      status: pack.status,
      updatedAt: pack.updatedAt,
      summary: pack.reproPack.summary,
      confidence: pack.reproPack.confidence.overall,
      reviewHistoryCount: pack.reviewHistory.length
    }));
    process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
    return;
  }

  if (command === "pack") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" },
        tenant: { type: "string" }
      }
    });
    const ticketId = parsed.values.ticket;
    if (!ticketId) {
      throw new Error("--ticket is required");
    }

    const pack = await store.getPack(ticketId, parsed.values.tenant ?? "default");
    if (!pack) {
      throw new Error(`Repro pack not found: ${ticketId}`);
    }

    process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    return;
  }

  if (command === "review") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" },
        tenant: { type: "string" },
        status: { type: "string" },
        reviewer: { type: "string" },
        note: { type: "string" }
      }
    });
    const ticketId = parsed.values.ticket;
    const status = parsed.values.status;

    if (!ticketId || !status) {
      throw new Error("--ticket and --status are required");
    }

    if (!["reviewed", "approved", "rejected"].includes(status)) {
      throw new Error("--status must be one of reviewed, approved, rejected");
    }

    const updated = await store.reviewPack({
      tenantId: parsed.values.tenant ?? "default",
      ticketId,
      status: status as ReviewStatus,
      reviewer: parsed.values.reviewer,
      note: parsed.values.note
    });
    process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
    return;
  }

  if (command === "sync-issues") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" },
        tenant: { type: "string" },
        target: { type: "string", multiple: true },
        write: { type: "boolean" }
      }
    });
    const ticketId = parsed.values.ticket;
    if (!ticketId) {
      throw new Error("--ticket is required");
    }

    const tenantId = parsed.values.tenant ?? "default";
    const providerSet = await providers.create({ tenantId });
    const targets =
      (parsed.values.target?.filter((entry): entry is "github" | "jira" => entry === "github" || entry === "jira") ??
        ["github", "jira"]);
    const results = await syncIssuesForPack({
      tenantId,
      ticketId,
      providers: providerSet,
      store,
      targets,
      dryRun: !parsed.values.write
    });
    process.stdout.write(`${JSON.stringify({ tenantId, ticketId, dryRun: !parsed.values.write, results }, null, 2)}\n`);
    return;
  }

  if (command === "export-issue") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" },
        tenant: { type: "string" },
        target: { type: "string" }
      }
    });
    const ticketId = parsed.values.ticket;
    if (!ticketId) {
      throw new Error("--ticket is required");
    }

    const issuePath = await store.exportIssueDraft(
      ticketId,
      parsed.values.tenant ?? "default",
      parsed.values.target === "jira" ? "jira" : "github"
    );
    process.stdout.write(
      `${JSON.stringify({ tenantId: parsed.values.tenant ?? "default", ticketId, issuePath }, null, 2)}\n`
    );
    return;
  }

  if (command !== "process") {
    throw new Error(`Unknown command: ${command}`);
  }

  const parsed = parseArgs({
    args: rest,
    options: {
      ticket: { type: "string" },
      tenant: { type: "string" },
      "support-ticket-id": { type: "string" },
      "dry-run": { type: "boolean" },
      "write-artifacts": { type: "boolean" },
      async: { type: "boolean" },
      "max-attempts": { type: "string" },
      "customer-consent-confirmed": { type: "boolean" }
    }
  });

  const tenantId = parsed.values.tenant;
  const supportTicketId = parsed.values["support-ticket-id"];
  const ticketRef = parsed.values.ticket;

  if (!ticketRef && !supportTicketId) {
    throw new Error("--ticket or --support-ticket-id is required");
  }

  const lookup = ticketRef ? parseTicketReference(ticketRef) : {};

  if (parsed.values.async) {
    const job = await jobs.enqueue({
      ...lookup,
      tenantId,
      supportTicketId,
      dryRun: parsed.values["dry-run"],
      writeArtifacts: parsed.values["write-artifacts"],
      maxAttempts: parsed.values["max-attempts"] ? Number(parsed.values["max-attempts"]) : undefined,
      customerConsentConfirmed: parsed.values["customer-consent-confirmed"]
    });
    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }

  const providerSet = await providers.create({ tenantId });
  const result = await processTicket(
    {
      ...lookup,
      tenantId,
      supportTicketId,
      dryRun: parsed.values["dry-run"],
      writeArtifacts: parsed.values["write-artifacts"],
      customerConsentConfirmed: parsed.values["customer-consent-confirmed"]
    },
    providerSet,
    logger
  );

  const storedPack = await jobs.persistSynchronousResult({
      tenantId: tenantId ?? "default",
      ticketId: result.ticket.ticketId,
      dryRun: result.dryRun,
      sourceLookup: {
        ...lookup,
        supportTicketId
      },
    reproPack: result.reproPack,
    issueDraft: result.issueDraft,
    markdown: result.markdown,
    providerResults: {
      session: result.context.session,
      logs: result.context.logs,
      featureFlags: result.context.featureFlags,
      release: result.context.release
    }
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tenantId: tenantId ?? "default",
        dryRun: result.dryRun,
        reviewStatus: storedPack.status,
        artifactPaths: result.artifactPaths,
        reproPack: result.reproPack,
        issueDraft: result.issueDraft,
        issueLinks: storedPack.issueLinks
      },
      null,
      2
    )}\n`
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
