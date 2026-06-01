import { parseArgs } from "node:util";
import { processTicket } from "../pipeline/process-ticket";
import { createRuntime } from "../runtime/app-runtime";
import type { ReviewStatus } from "../types/schemas";

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
      "Usage:\n  repro-pack process --ticket <fixture-id|path> [--dry-run] [--write-artifacts] [--async]\n  repro-pack health\n  repro-pack job --id <job-id>\n  repro-pack pack --ticket <ticket-id>\n  repro-pack review --ticket <ticket-id> --status <reviewed|approved|rejected> [--reviewer <name>] [--note <text>]\n  repro-pack export-issue --ticket <ticket-id>\n"
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
          dataRoot: config.dataRoot
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (command === "job") {
    const parsed = parseArgs({
      args: rest,
      options: {
        id: { type: "string" }
      }
    });
    const jobId = parsed.values.id;
    if (!jobId) {
      throw new Error("--id is required");
    }

    const job = await store.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }

  if (command === "pack") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" }
      }
    });
    const ticketId = parsed.values.ticket;
    if (!ticketId) {
      throw new Error("--ticket is required");
    }

    const pack = await store.getPack(ticketId);
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
      ticketId,
      status: status as ReviewStatus,
      reviewer: parsed.values.reviewer,
      note: parsed.values.note
    });
    process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
    return;
  }

  if (command === "export-issue") {
    const parsed = parseArgs({
      args: rest,
      options: {
        ticket: { type: "string" }
      }
    });
    const ticketId = parsed.values.ticket;
    if (!ticketId) {
      throw new Error("--ticket is required");
    }

    const issuePath = await store.exportIssueDraft(ticketId);
    process.stdout.write(`${JSON.stringify({ ticketId, issuePath }, null, 2)}\n`);
    return;
  }

  if (command !== "process") {
    throw new Error(`Unknown command: ${command}`);
  }

  const parsed = parseArgs({
    args: rest,
    options: {
      ticket: { type: "string" },
      "dry-run": { type: "boolean" },
      "write-artifacts": { type: "boolean" },
      async: { type: "boolean" }
    }
  });

  const ticketRef = parsed.values.ticket;
  if (!ticketRef) {
    throw new Error("--ticket is required");
  }

  const lookup = parseTicketReference(ticketRef);

  if (parsed.values.async) {
    const job = await jobs.enqueue({
      ...lookup,
      dryRun: parsed.values["dry-run"],
      writeArtifacts: parsed.values["write-artifacts"]
    });
    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }

  const result = await processTicket(
    {
      ...lookup,
      dryRun: parsed.values["dry-run"],
      writeArtifacts: parsed.values["write-artifacts"]
    },
    providers,
    logger
  );

  const storedPack = await jobs.persistSynchronousResult({
    ticketId: result.ticket.ticketId,
    dryRun: result.dryRun,
    sourceLookup: lookup,
    reproPack: result.reproPack,
    issueDraft: result.issueDraft,
    markdown: result.markdown
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        dryRun: result.dryRun,
        reviewStatus: storedPack.status,
        artifactPaths: result.artifactPaths,
        reproPack: result.reproPack,
        issueDraft: result.issueDraft
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
