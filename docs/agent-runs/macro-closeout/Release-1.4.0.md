# 1.4.0 發布驗證

2026-09-12，使用者明確授權 commit、push 與 minor version +1。package.json、lockfile、runtime APP_VERSION 由 1.3.0 升至 1.4.0；既有未 stage 的新聞版面與 Tray 工作保留。

- 隔離提交候選：135 個檔案 syntax check；162 tests passed，0 failed。
- 正式資料副本：七組 × 四種 capability，data/coverage/freshness/warnings 一致；owner connection total_changes 不變，禁止 provider I/O；FK 0，57 筆原有觀測逐欄保留。
- 正式 runtime：PID 62948，8790，2026-09-12T06:21:11.595Z 啟動，version 1.4.0，schema 11，39 indicators，79 observations。
- 正式七組 complete/current，28 組投影 parity；來源指紋 `cf7bc29ad5b6cd75853b0b233d559ff1becc8872dd00abf03b51fb4bdea70d8b`（69 files、sha256-utf8-lf），與受測來源相同。
- 證據：`data/runtime/macro-closeout-formal-2026-09-12T06-21-18-200Z/proof.json`；副本證據位於 `.tmp/macro-closeout-candidate/data/runtime/macro-closeout-copy-2026-09-12T06-20-54-964Z/proof.json`。
- 遠端原有 40e8348、4918ded 授權與公開文件更新保留合併。README 以新版公開指南為主，加入 Macro 1.4.0 說明；DataModel／ExternalInterfaces 同時保留兩側內容。

Release latency 保持 unverified；historical full vintage、dot plot、Event bridge、forecast/surprise、OMI 與下一批資料仍為後续範圍。正式讀取不以另一條 SQLite 連線的 total_changes 作證。
