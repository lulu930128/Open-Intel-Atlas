# Regional live-copy adoption evidence

## Scope

`npm run verify:regional-live-copy` opens the formal SQLite database read-only, creates an online-backup copy, migrates only that copy to schema v5, runs the seven enabled TW/JP official sources sequentially, starts a scheduler-disabled ephemeral runtime, and compares REST/MCP output for all four presentations. The temporary runtime and copied database are deleted in `finally`.

The verifier compares the formal database, WAL, SHM, and rollback-journal file identities before and after the rehearsal. A changing WAL therefore fails the overall gate even when provider and consumer checks pass.

## Provider and consumer result

The 2026-08-30 rehearsal after the MOFA bounded-list correction passed the source and contract checks:

| Source | HTTP | Documents | Events | Fetches | Truncated payloads |
| --- | ---: | ---: | ---: | ---: | ---: |
| `tw-mofa-press-releases` | 200 | 30 | 0 | 1 | 0 |
| `tw-ncdr-active-cap-alerts` | 200 | 84 | 74 | 1 | 0 |
| `jp-mod-news` | 200 | 40 | 0 | 1 | 0 |
| `jp-jpcert-alerts` | 200 | 6 | 2 | 1 | 0 |
| `jp-jma-eqvol` | 200 | 6 | 6 | 7 | 0 |
| `jp-fdma-disaster-info` | 200 | 15 | 15 | 1 | 0 |
| `jp-ndl-diet-minutes` | 200 | 30 | 0 | 1 | 0 |

- Copied runtime：schema `5`、consumer contract `1.2`、33 registered sources、scheduler disabled。
- `global`：8 selected。
- `east_asia`：13 regional-qualified、8 selected、no gap。
- `taiwan_focus`：11 regional-qualified、8 selected、no gap。
- `japan_focus`：2 regional-qualified、2 selected，並如實回傳 `qualified_event_shortfall`。
- 四種 presentation 的 REST/MCP ordered Event IDs 與 `coverage_gaps` 完全一致。
- MOFA 改用 `News.aspx?PageSize=30&n=96&sms=74` 後 raw payload 未截斷；不再每 30 分鐘保存 2.5–3.5 MB、無 HTTP validator 的完整歷史 OpenData feed。

## Formal-writer finding

加強版 verifier 的 provider、migration、selector 與 REST/MCP 檢查仍全部通過，但整體正確地回傳 `failed`，因為正式 WAL 在約 7.6 秒驗收期間改變：

- WAL size：`4,391,952` bytes（前後相同）。
- WAL mtime：`1788090503872.4849 → 1788090584017.7793`。
- 同期正式 `source_runs` 顯示 scheduler owner `scheduler:dd1e96c9-af27-4643-91a1-5e1e791937b6` 持續寫入。

因此這份證據證明「working-tree providers 與 consumer contract 可在一致副本上運作」，但不證明正式 DB 已靜止、正式 runtime 已採用或正式產品已通過。後續 direct TCP／health probe 證明舊 runtime 仍在線；正式 backup/adoption 前，必須先以 component-owned 流程停止該 active writer。
