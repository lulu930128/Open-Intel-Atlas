# 施工與驗收

1. 期別使用 date-only `[start,end)`；ISO week 與 Saturday-ending week 明確區分。新資料不能以月份冒充事件或季度。
2. Release identity 納入 stage；annual/benchmark/correction 必須有 occurrence key。第三次 GDP 估計不等於 final。即使数值不變，新 release 仍形成不同 vintage。
3. 發布首次建立時凍結 required/optional 指標及各自 reference period；未有規則時回報 unknown。Claims initial/continuing 可使用不同週期 offset。
4. Schema 10 在單一 transaction 重建 macro_releases 父表，外鍵切換在 transaction 外；失敗 rollback 並恢復 FK enforcement。其餘觀測採 additive columns。legacy persisted_at/provider_published_at 保持 null。
5. Watch 使用原 scheduler 的 lease、concurrency、backoff。每個 release + scheduled_at 只記錄一次實際 watch evaluation 與當時 health；不冒充 lease acquisition。完整後停止加密輪詢。
6. 先測試與副本 migration，失敗即修正；完成後以原 Tray owner 載入正式 runtime，再做 read-only REST/MCP 與 UI 驗證。

驗證命令：`npm run check`；`node --test --test-isolation=none test/macro-generalization.test.js test/macro-intelligence-v1.test.js test/macro-phase2.test.js`。額外 regression 見 Progress.md。

副本工具：`node --env-file-if-exists=.env scripts/verify-macro-generalization-copy.mjs`，會建立新的忽略目錄備份與 migration copy，正式 DB 僅 readonly online backup。

回復原則：若需降回 schema 9，先停止精確 owner、保存當前 DB/WAL/SHM，再搭配相容舊程式與本輪備份復原；不可直接用舊 binary 開啟 schema 10 或覆寫運作中的 SQLite。現有 dirty tree 尚無獨立舊版 checkpoint，不能宣稱一鍵程式回退。未執行降版。
