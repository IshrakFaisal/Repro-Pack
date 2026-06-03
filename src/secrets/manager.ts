import type { SecretRef } from "../types/integrations";

export interface SecretManager {
  resolve(ref: SecretRef | undefined): Promise<string | undefined>;
}

export class EnvSecretManager implements SecretManager {
  async resolve(ref: SecretRef | undefined): Promise<string | undefined> {
    if (!ref) {
      return undefined;
    }

    if (ref.provider !== "env") {
      throw new Error(`Secret provider ${ref.provider} is not available in the default runtime`);
    }

    return process.env[ref.env]?.trim() || undefined;
  }
}

export class CompositeSecretManager implements SecretManager {
  constructor(private readonly managers: Partial<Record<SecretRef["provider"], SecretManager>>) {}

  async resolve(ref: SecretRef | undefined): Promise<string | undefined> {
    if (!ref) {
      return undefined;
    }

    const manager = this.managers[ref.provider];
    if (!manager) {
      throw new Error(`Secret provider ${ref.provider} is not configured`);
    }

    return manager.resolve(ref);
  }
}

export class UnsupportedSecretManager implements SecretManager {
  constructor(private readonly providerName: string) {}

  async resolve(): Promise<string | undefined> {
    throw new Error(`Secret provider ${this.providerName} requires a production integration adapter`);
  }
}

export function createSecretManager(): SecretManager {
  return new CompositeSecretManager({
    env: new EnvSecretManager(),
    aws: new UnsupportedSecretManager("aws"),
    gcp: new UnsupportedSecretManager("gcp"),
    azure: new UnsupportedSecretManager("azure"),
    vault: new UnsupportedSecretManager("vault")
  });
}
