import type { AppConfig } from "../config/env";
import type { ProviderSet } from "./interfaces";
import {
  FixtureFeatureFlagProvider,
  FixtureLogsProvider,
  FixtureReleaseProvider,
  FixtureSessionProvider,
  FixtureSupportProvider
} from "./mock-fixture-provider";

export function createProviders(config: AppConfig): ProviderSet {
  return {
    config,
    support: new FixtureSupportProvider(config.fixtureRoot),
    logs: new FixtureLogsProvider(config.fixtureRoot),
    featureFlags: new FixtureFeatureFlagProvider(config.fixtureRoot),
    release: new FixtureReleaseProvider(config.fixtureRoot),
    session: new FixtureSessionProvider(config.fixtureRoot)
  };
}
