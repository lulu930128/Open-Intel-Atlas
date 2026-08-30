# Open Intel Atlas 1.3.0 最終封版收尾進度

## 目前狀態

- 階段：Milestone 0–4 完成；正式 runtime 已採用目前 source，待 Milestone 5 live acceptance。
- 最後更新：2026-08-30 17:16 Asia/Taipei。
- 封版判定：尚未判定。
- Source 修正：完成並通過 source verification gate。
- Runtime adoption：通過；scheduled task/tray 已重新取得 backend lifecycle ownership。
- Commit：本任務尚未建立。
- Push / tag：尚未執行。

## 已完成

- [x] 讀取 1.3.0 final release closeout 規劃輸入。
- [x] 對照產品願景、運作模型、品質標準、Roadmap 與前一階段 architecture convergence 任務。
- [x] 盤點 canonical verification enum 與 Newsroom/Domain presentation mapping drift。
- [x] 盤點 current architecture/interface 文件 drift。
- [x] 分離 source validation、runtime adoption、live acceptance、commit 與 publication gate。
- [x] 建立 `Prompt.md`、`Plan.md`、`Progress.md` 與文件索引。
- [x] 完成 Milestone 0 唯讀 preflight，重新確認 Git 與 Windows runtime ownership。
- [x] 建立共用 `public/verificationLabels.js`，讓 Newsroom 與 Domain 使用同一份 canonical eight-state mapping。
- [x] 補上八態完整性、未知值 fail-closed 與兩個 consumer 接線測試。
- [x] 將 `SystemArchitecture.md` 的 verification、severity、freshness、coverage 收斂到 executable 1.3.0 contract。
- [x] 將 `ExternalInterfaces.md` 拆成 1.3.0 current endpoints/filters 與未實作 target state。
- [x] 完成 syntax、targeted、full test、verify、tray self-test、static audit、dependency audit 與 diff check。
- [x] 經使用者明確授權後，只停止已驗證的 Atlas orphan PID，並由既有 scheduled task 恢復正式 runtime ownership。
- [x] 完成延遲 stability、health、domain count 與 served-source hash adoption proof。

## 本輪驗證證據

- `node --check public/verificationLabels.js public/newsroom.js public/domain.js`：通過。
- `node --test test/newsroom-domain-navigation-v2.test.js`：7 passed；第一次在 restricted sandbox 因 `spawn EPERM` 未執行，允許 Node child process 後重跑通過。
- `npm run check`：39 files syntax check passed。
- `npm test`：31 passed、0 failed。
- `npm run verify`：check 與 31 tests 全部通過。
- `npm audit --audit-level=high --ignore-scripts`：0 vulnerabilities。
- `npm run tray:selftest`：`success=true`；project root、server、icon、Node、WinForms、TaskbarCreated listener、8790 與 health URL 全部通過。SelfTest 分支在建立 mutex 或啟動 backend 前退出。
- Production static audit：`public/` 無 `/api/dashboard`、`COUNTRY_HINTS`、`inferCountryCode`；舊 verification alias 不存在於 production mapping。
- `git diff --check`：通過。
- Runtime read-only preflight：scheduled task `Open Intel Atlas` action 精確指向本 repo `scripts/atlas-tray.ps1`，State `Ready`，LastRun `2026-08-30 16:04:30 +08:00`，LastTaskResult `0xC000013A`。
- Runtime read-only preflight：`127.0.0.1:8790` owner PID `40268`，command line 精確指向本 repo `src/atlasServer.js`；parent PID `57392` 不存在，與 tray log 的 16:04 launcher 相符，因此目前 backend 是 orphan，不算正式 adoption。

## Runtime recovery 與 adoption 證據

- 授權：使用者於本輪明確要求直接重啟。
- 防護條件：再次確認 8790 只有 PID `40268`、其 command line 指向本 repo `src/atlasServer.js`、parent PID `57392` 不存在、scheduled task action 指向本 repo `scripts/atlas-tray.ps1`；四項同時成立後才執行。
- 精確處置：只停止 PID `40268`；確認 8790 釋放後，執行既有 `Open Intel Atlas` scheduled task。未依 image name broad-kill，未修改 task、port、DB 或 launcher。
- 新 ownership：task `Running`；tray PID `23520`；backend PID `25876`；backend parent PID `23520`；兩者 command line 均指向本 repo 的正式 tray/server entrypoint。
- 20 秒 bounded recheck：task、PID lineage 與唯一 8790 listener 維持不變；tray log 記錄 17:16 正常 starting、backend started、tray ready。
- Live health：`ok=true`、version `1.3.0`、contract `1.1`、schema `4`；四個 domains 可讀。
- Truthful data state：coverage `partial`、freshness `stale`、warnings `4`，未因重啟或封版而被掩蓋。
- Served-source adoption：runtime `/verificationLabels.js` 與工作區 `public/verificationLabels.js` 的 SHA-256 同為 `A96E7A21A6EDBFA302D1C6B0787BA33DEAFEB7311EF2A7CBD05FDB262B487DED`。

## 規劃前唯讀證據

以下是建立計畫前的觀察，只用來界定工作，不可直接當作完成驗收：

- Branch：`main`；HEAD `0b5a391`；相對 `origin/main` ahead 1；當時 working tree clean。
- REST health：服務可回應，版本 `1.3.0`、schema `4`、contract `1.1`。
- REST：四個 domains 可見；events/stories/brief 已觀察到 `document_id`、`source_id` 與 effective media policy lineage。
- Data state：freshness stale、coverage partial、warnings 4；這應保留為 truthful partial state。
- MCP：discovery、tool list 與五個關鍵 Atlas tool 呼叫可回應。
- Static audit：public production reference 未發現 `/api/dashboard`、`COUNTRY_HINTS` 或 `inferCountryCode`。
- Browser：Newsroom 與 Map 的 desktop/mobile 基礎畫面未觀察到 horizontal overflow 或 console error；domain technology 可切換並顯示資料。
- 尚缺 formal live Map network request capture；source/static evidence 不能單獨取代這個 runtime gate。
- Canonical verification enum 為八個值；`public/newsroom.js`、`public/domain.js` 仍含舊 alias 且缺少 canonical keys。
- Live API 拒絕舊 alias、接受 canonical values；因目前資料主要使用 `single_source` / `official_confirmed`，UI defect 尚未被資料觸發。
- `SystemArchitecture.md` 與 `ExternalInterfaces.md` 仍有舊 verification vocabulary；同區 current severity/coverage vocabulary 也需對照 executable schema 修正。
- Runtime snapshot：backend 曾由 PID 40268 監聽 8790，但其 parent PID 57392 已不存在；scheduled task 為 Ready，最近結果 `0xC000013A`，tray log 無正常 shutdown。執行 milestone 4 前必須重新解析，不能直接使用這些 PID。

## 已做決策

- Verification 修正採單一共享 UI label mapping，不在 consumer 端推導 evidence semantics。
- Runtime ownership 是封版必要條件；僅有 health 200 不足以證明 tray lifecycle 正常。
- 文件只修正 current-vs-target truth，不擴大 1.3.0 架構範圍。
- `partial` / `stale` / warnings 不是要消掉的視覺瑕疵，而是必須被保留的產品證據。
- 已接受 P2 debt 留待 1.3.0 之後處理，不趁封版做大型重構。
- 既有 commit `0b5a391` 不 amend；未來 closeout commit、push 與 tag 各自等待授權。

## 已知風險與 blockers

- Tray/backend ownership 已恢復；若後續再次 orphan，必須重新開啟 launcher lifecycle P1，不可只反覆重啟。
- UI mapping 與文件 vocabulary drift 已完成 source 修正及 runtime served-source adoption，尚待 browser readback。
- 驗收缺口：Map 的正式 live request path 尚未捕捉。
- 發布狀態：本機已有一個未 push commit；不得把本任務文件或未完成修正誤稱為 remote release。

## 下一步

執行 Milestone 5 的正式 live acceptance：REST/MCP 語意對照、read-only DB integrity、Newsroom／Domain／Map desktop/mobile、實際 Map `/api/v1` request path、console 與版面驗收。Commit、push、tag 仍維持分離授權。

## 後續 evidence 記錄格式

每個 milestone 完成時追加：

- 時間與 checkout/HEAD。
- 實際執行命令。
- exit code 與關鍵結果。
- 任何偏差、accepted risk 或 stop-and-fix 決策。
- 該結果屬於 source、runtime、live acceptance、commit、push 或 tag 的哪一個 gate。
