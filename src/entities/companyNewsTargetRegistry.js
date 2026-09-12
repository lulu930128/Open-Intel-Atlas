const SOURCE_ID = "yahoo-tw-stock-news";
const MASTER_SOURCES = Object.freeze({
  TWSE: "twse-company-master",
  TPEX: "tpex-company-master"
});

export function createCompanyNewsTargetRegistry({ store, registry, config, clock = () => new Date() }) {
  function reconcile() {
    const source = registry.get(SOURCE_ID);
    if (!source) return { status: "not_registered", source_id: SOURCE_ID };
    const settings = config.companyNewsTargets || { mode: "canary", maxActive: 5, dynamicCadenceMs: 86_400_000 };
    const now = clock().toISOString();
    if (settings.mode !== "master_bounded") {
      const disabled = store.disableGeneratedSourceTargets(SOURCE_ID, now);
      return { status: "canary_only", source_id: SOURCE_ID, disabled_dynamic_targets: disabled };
    }

    const inventory = store.listCompanyNewsTargetCandidates(MASTER_SOURCES);
    if (!inventory.complete) {
      return {
        status: "deferred",
        source_id: SOURCE_ID,
        reason: "complete_company_master_required",
        missing_or_incomplete_markets: inventory.incomplete_markets
      };
    }

    const linkedCanaryTargets = store.linkSourceTargetsToCandidates(SOURCE_ID, inventory.candidates, now);
    const canaryIds = new Set((source.targets || []).map((target) => target.id));
    const candidates = inventory.candidates.filter((candidate) => !canaryIds.has(candidate.id));
    const dynamicLimit = Math.max(0, Number(settings.maxActive || 5) - canaryIds.size);
    const selectedIds = rotatingSelection(candidates, dynamicLimit, now);
    const result = store.reconcileGeneratedSourceTargets(source, candidates, {
      enabledIds: selectedIds,
      cadenceMs: settings.dynamicCadenceMs,
      snapshotIds: inventory.snapshot_ids,
      now
    });
    return {
      status: "reconciled",
      source_id: SOURCE_ID,
      candidate_count: inventory.candidates.length,
      enabled_count: selectedIds.size + canaryIds.size,
      linked_canary_targets: linkedCanaryTargets,
      ...result
    };
  }

  return Object.freeze({ reconcile });
}

function rotatingSelection(candidates, limit, now) {
  const selected = new Set();
  if (limit <= 0 || candidates.length === 0) return selected;
  const count = Math.min(limit, candidates.length);
  const day = Math.floor(Date.parse(now) / 86_400_000);
  const offset = (day * count) % candidates.length;
  for (let index = 0; index < count; index += 1) {
    selected.add(candidates[(offset + index) % candidates.length].id);
  }
  return selected;
}
