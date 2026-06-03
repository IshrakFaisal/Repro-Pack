type Labels = Record<string, string>;

type CounterMetric = {
  type: "counter";
  name: string;
  help: string;
  values: Map<string, number>;
};

type HistogramMetric = {
  type: "histogram";
  name: string;
  help: string;
  values: Map<string, number[]>;
};

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function formatLabels(key: string): string {
  if (!key) {
    return "";
  }

  const labels = key.split(",").filter(Boolean);
  return `{${labels.map((entry) => `${entry.split("=")[0]}="${entry.split("=").slice(1).join("=")}"`).join(",")}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, CounterMetric>();
  private readonly histograms = new Map<string, HistogramMetric>();

  increment(name: string, help: string, labels: Labels = {}, amount = 1): void {
    const metric = this.counters.get(name) ?? {
      type: "counter" as const,
      name,
      help,
      values: new Map<string, number>()
    };
    const key = labelKey(labels);
    metric.values.set(key, (metric.values.get(key) ?? 0) + amount);
    this.counters.set(name, metric);
  }

  observe(name: string, help: string, value: number, labels: Labels = {}): void {
    const metric = this.histograms.get(name) ?? {
      type: "histogram" as const,
      name,
      help,
      values: new Map<string, number[]>()
    };
    const key = labelKey(labels);
    const current = metric.values.get(key) ?? [];
    current.push(value);
    metric.values.set(key, current);
    this.histograms.set(name, metric);
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const metric of this.counters.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} counter`);
      for (const [key, value] of metric.values.entries()) {
        lines.push(`${metric.name}${formatLabels(key)} ${value}`);
      }
    }

    for (const metric of this.histograms.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} summary`);
      for (const [key, values] of metric.values.entries()) {
        const count = values.length;
        const sum = values.reduce((total, entry) => total + entry, 0);
        lines.push(`${metric.name}_count${formatLabels(key)} ${count}`);
        lines.push(`${metric.name}_sum${formatLabels(key)} ${sum}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }
}
