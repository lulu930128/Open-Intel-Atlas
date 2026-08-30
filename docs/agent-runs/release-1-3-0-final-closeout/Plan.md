# Open Intel Atlas 1.3.0 最終封版收尾計畫

## 執行原則

本計畫採逐 gate 執行。每個 milestone 必須留下可重現證據；驗證失敗時先停止並修正，不以後續 gate 的成功抵銷前一個 gate。資料本身的 partial/stale 是可接受且應顯示的狀態，contract、ownership 或呈現失真才是 release defect。

## Milestone 0：凍結基線與執行前 preflight

### 範圍

- 記錄 branch、HEAD、working tree、既有使用者變更與預計修改的精確檔案。
- 重新取得 8790 listener、PID、executable、command line、parent PID、scheduled task state 與 tray log。
- 以唯讀方式快照 health、domains、events、stories、brief、freshness、sources、changes 與 MCP discovery。
- 不沿用規劃時的 PID 判斷，不在此階段停止或啟動任何 process。

### 驗收條件

- 基線可重現，任務修改範圍與既有變更能清楚區隔。
- Runtime ownership 異常以當下證據重新成立，或明確記錄它已自行恢復。
- 所有 preflight 操作均為唯讀。

### 驗證

```powershell
git status --short --branch
git rev-parse HEAD
git diff --stat
Get-NetTCPConnection -LocalPort 8790 -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $candidatePids }
Get-ScheduledTask -TaskName '<repo-defined-task-name>'
curl.exe --max-time 20 http://127.0.0.1:8790/api/v1/health
```

實際 task name、PID 與 log path 必須由 repo/系統重新解析，不從本文件複製猜測。

## Milestone 1：收斂 verification presentation contract

### 範圍

- 建立最小、共享的 frontend verification label module。
- 讓 `public/newsroom.js` 與 `public/domain.js` 使用同一份 mapping。
- 精確納入：`unverified`、`single_source`、`multi_source`、`primary_source_confirmed`、`official_confirmed`、`disputed`、`corrected`、`retracted`。
- 移除 `multi_source_confirmed`、`multi_source_supported`、`source_reported` 等舊 alias。
- 為八個 canonical state、未知值 fallback 與兩個 consumer 的接線補 targeted tests。

### 驗收條件

- Production frontend 只有一份 verification label ownership。
- 八個 canonical state 均有明確、不中斷版面的顯示文案。
- 未知值不會被提升成較高可信度，也不會以空字串或假成功掩蓋。
- Backend/API enum 與 response shape 不因顯示修正而改動。

### 驗證

```powershell
node --check public/newsroom.js
node --check public/domain.js
node --check public/<shared-verification-label-module>.js
node --test test/newsroom-domain-navigation-v2.test.js
rg -n "multi_source_confirmed|multi_source_supported|source_reported" public test
```

實作時應以 repo 實際 module pattern 決定檔名與 export 方式，不為單一 mapping 引入 framework 或 dependency。

## Milestone 2：架構與介面文件收斂

### 範圍

- 修正 `docs/architecture/SystemArchitecture.md` 的 verification、severity、coverage current vocabulary。
- 修正 `docs/architecture/ExternalInterfaces.md` 的 current filter contract。
- 將尚未實作的 multi-value filter 或 endpoint 明確標為 target state，避免文件把規劃寫成現況。
- 持續更新本任務的 `Progress.md`；Roadmap 僅在正式 runtime 驗收完成後寫入長期成立的結果。

### 驗收條件

- Current-state 文件與 executable backend contract 一致。
- Target-state 能力不會被讀成已上線功能。
- 文件不重複創造第二套 enum 或 consumer-side truth。

### 驗證

```powershell
rg -n "corroborated|multi_source_confirmed|multi_source_supported|source_reported" docs/architecture public
rg -n "verification|severity|coverage" docs/architecture/SystemArchitecture.md docs/architecture/ExternalInterfaces.md
git diff --check
```

## Milestone 3：Source verification gate

### 範圍

- 執行 syntax、targeted test、repo check、完整 test、verify、static-reference audit 與 dependency audit。
- 先確認 `tray:selftest` 的隔離與副作用；只有不會干擾正式 runtime 時才執行，否則安排在 runtime recovery 前的隔離環境。
- 檢查 staged/working diff 不含 secret、private data、暫存檔或無關輸出。

### 驗收條件

- Targeted 與 repo-defined validation 全部通過。
- High severity dependency audit 為 0，或有可稽核且不掩飾的 release decision。
- Static audit 不再發現禁止的 legacy request path 或舊 verification alias。
- 未發生 production DB mutation、external refetch 或 scheduler reconfiguration。

### 驗證

```powershell
npm run check
npm test
npm run verify
npm audit --audit-level=high --ignore-scripts
git diff --check
git status --short
```

## Milestone 4：恢復正式 runtime ownership

### 前置授權

這個 milestone 會停止已證明為 orphan 的 Atlas backend，並啟動既有 scheduled task，因此必須在執行當下取得明確 runtime 操作授權。建立本計畫不等於取得該授權。

### 範圍

- 重新驗證 8790 owner、PID、command、parent 與 scheduled task；任何識別不一致即停止。
- 只停止精確驗證為本 repo 且 parent 已不存在的 orphan backend。
- 只透過既有 scheduled task 啟動正式 tray；不直接建立第二個常駐 backend/tray。
- 驗證 tray PID、backend child PID、command/path、8790 listener 與 log ownership chain。
- 做 bounded stability recheck，確認不是啟動後立即退化。

### 驗收條件

- Scheduled task 為 Running，tray process 存活。
- Backend 為 tray 的可驗證 child，executable 與 command line 指向預期 checkout。
- 8790 只有一個預期 owner；不存在重複 listener 或殘留 launcher。
- 至少一次延遲 recheck 後 ownership 與 health 仍成立。
- Tray log 可解釋本次啟動，沒有新的 silent exit。

### Stop-and-fix

- Task/tray 再次退出、backend 再度 orphan、owner 無法確認或 port 衝突時，立即停止 release acceptance。
- 不反覆 restart、不 broad-kill、不改 port 繞過；改為定位並修復 launcher lifecycle P1 defect，再重新從本 milestone 驗收。

## Milestone 5：正式 runtime acceptance

### REST gate

- 驗證 health、domains、events、stories、brief、freshness、sources、changes。
- 檢查 media lineage、effective policy、cursor、warnings 與 error shape。
- 驗證八個 canonical verification query 值可被接受，舊 alias 仍被拒絕。

### MCP gate

- 驗證 server discovery、tool list。
- 呼叫 `atlas.latest`、`atlas.brief`、`atlas.story.get`、`atlas.changes`、`atlas.sources.status`。
- 對照同一 evidence 的 REST/MCP verification、freshness、coverage、lineage 與 warning 語意。

### Browser gate

- Newsroom desktop 與約 390px mobile。
- 四個 domain 的導覽、列表、來源數與 media/fallback 呈現。
- Map desktop 與 mobile；驗證實際 network request 或等價 live evidence只使用目前 `/api/v1/...` contract。
- 搜尋、detail dialog、status/error surface 與鍵盤/基本互動。
- 檢查 horizontal overflow、文字截斷、raw enum、空白 media、console error 與 failed request。

### 資料完整性 gate

- 對正式 DB 做 read-only `quick_check` 與 schema/version 確認。
- 驗證 media/document/source lineage invariant，不做資料修補。
- Partial/stale/warnings 若與來源證據一致，記錄為資料狀態而非測試失敗。

### 驗收條件

- REST、MCP 與 browser 使用同一正式 runtime，語意無分叉。
- Browser 不顯示舊 verification alias 或 raw canonical key。
- 沒有 legacy request path、破版、空白假圖或以 fallback 隱藏 missing evidence。
- 所有異常都能被分類為已接受資料狀態或明確 release blocker。

## Milestone 6：封版判定與發布邊界

### 範圍

- 將各 gate 的命令、時間、摘要與例外寫入 `Progress.md`。
- 列出 accepted debt、未完成項與是否影響 1.3.0 封版。
- 只有所有 release gate 成立時才給出 `GO`；否則給 `NO-GO` 與最短修復路徑。
- 封版通過後，才把仍長期成立的結果回寫 `docs/product/Roadmap.md`。
- 使用者明確要求 commit 時，精確 stage 本任務檔案、檢查 secret/垃圾/無關 diff，再建立小型 closeout commit。
- Push 與 tag 必須另有明確要求；完成後核對 remote ancestry、remote SHA 與 tag target。

### 驗收條件

- Source、runtime adoption、live acceptance、commit、push、tag 六種狀態分開記錄。
- `GO` / `NO-GO` 有對應 evidence，不以「看起來正常」代替證據。
- 未授權的外部發布不會發生。

## 全域 Stop-and-fix 規則

- Canonical enum、UI mapping 或文件 vocabulary 不一致：停止後續驗收。
- Targeted/full validation 失敗：先修正本次回歸；若證明無關，明確隔離證據後才繼續。
- Runtime owner 不明、tray 不存活、backend orphan 或 duplicate listener：不得宣稱 runtime adoption。
- REST/MCP 同一 evidence 語意不一致：不得封版。
- Browser 使用 legacy path、顯示 raw state、破版、console error 或空白媒體：回到對應 source milestone 修正。
- 不以改資料、換 provider、改 freshness 或隱藏 warning 讓驗收變綠。
- 若修正需要跨出本任務 non-goals，先停下來取得新的範圍決策。

## 決策紀錄

### 2026-08-30

- 使用單一共享 presentation mapping 修復 UI drift，不把顯示責任上移或下放成第二套 schema。
- 把 tray → backend ownership 納入 P1 封版 gate，因為單獨 backend health 不能證明正式 launcher 已採用 source。
- 同一任務修正已確認的 current-contract 文件 drift；不藉此擴充 target architecture。
- 保留既有 `0b5a391`，收尾變更未來以小 commit 疊加；commit、push、tag 維持分離授權。
