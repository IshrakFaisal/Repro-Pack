import { parseArgs } from "node:util";
import type { ReviewStatus } from "../types/schemas";
import { processTicket } from "../pipeline/process-ticket";
import { createRuntime } from "../runtime/app-runtime";
import { syncIssuesForPack } from "../issues/issue-sync";

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

async function run() {
  const [command, ...rest] = normalizeCommandArgs();
  const runtime = await createRuntime();
  const { config, logger, providers, store, jobs } = runtime;

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(
      "Usage:\n  repro-pack process --ticket <fixture-id|path> [--tenant <tenant-id>] [--support-ticket-id <id>] [--dry-run] [--write-artifacts] [--async]\n  repro-pack health\n  repro-pack jobs [--tenant <tenant-id>] [--status <queued|running|succeeded|failed>]\n  repro-pack job --id <job-id> [--tenant <tenant-id>]\n  repro-pack retry-job --id <job-id> [--tenant <tenant-id>]\n  repro-pack pack --ticket <ticket-id> [--tenant <tenant-id>]\n  repro-pack review --ticket <ticket-id> --status <reviewed|approved|rejected> [--tenant <tenant-id>] [--reviewer <name>] [--note <text>]\n  repro-pack sync-issues --ticket <ticket-id> [--tenant <tenant-id>] [--target github] [--target jira] [--write]\n  repro-pack export-issue --ticket <ticket-id> [--tenant <tenant-id>] [--target github|jira]\n"
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
    if (status && !["queued", "running", "succeeded", "failed"].includes(status)) {
      throw new Error("--status must be one of queued, running, succeeded, failed");
    }

    const list = await store.listJobs(parsed.values.tenant);
    const filtered = list.filter((job) => !status || job.status === status);
    process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
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
      async: { type: "boolean" }
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
      writeArtifacts: parsed.values["write-artifacts"]
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
      writeArtifacts: parsed.values["write-artifacts"]
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
