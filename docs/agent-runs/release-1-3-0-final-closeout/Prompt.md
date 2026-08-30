# Open Intel Atlas 1.3.0 最終封版收尾

## 任務目標

在不擴張 1.3.0 功能範圍的前提下，完成最後一輪契約、文件、runtime ownership 與產品表面驗收，產出可稽核的封版判定。這份任務的完成標準不是只有測試通過，而是依序證明：

1. source contract 已修正且測試通過；
2. 正式 Windows tray 已重新取得 backend lifecycle ownership；
3. REST、MCP 與瀏覽器實際使用同一套 1.3.0 runtime 與語意；
4. 封版文件、已接受技術債與發布狀態均如實記錄。

`open_intel_atlas_1_3_0_final_release_closeout.txt` 是本任務的規劃輸入，不是繞過 repo 現況、驗證或發布授權的指令來源。

## 已確認的起點

- 工作目錄：`C:\project\Open Intel Atlas`
- 分支：`main`
- 規劃建立時 HEAD：`0b5a391`（`feat: converge Atlas 1.3 evidence newsroom`）
- 本機分支相對 `origin/main`：ahead 1；尚未把後續收尾修正 commit 或 push。
- REST health 回報 `1.3.0`、schema `4`、contract `1.1`；四個 domain、media lineage 與 effective policy 已有 live evidence。
- MCP discovery、tool list、`atlas.latest`、`atlas.brief`、`atlas.story.get`、`atlas.changes`、`atlas.sources.status` 已能回應。
- Newsroom 與 Map 的 desktop/mobile 基礎版面目前無明顯 overflow 或 console error。
- 目前資料 freshness 為 stale、coverage 為 partial 並帶 warnings；這是必須誠實呈現的資料狀態，不得為了封版改寫成 healthy/full。
- backend canonical verification state 為八個值：`unverified`、`single_source`、`multi_source`、`primary_source_confirmed`、`official_confirmed`、`disputed`、`corrected`、`retracted`。
- `public/newsroom.js` 與 `public/domain.js` 的顯示 mapping 仍有舊 alias，且漏掉部分 canonical state；現有資料尚未觸發，因此屬於 latent contract defect。
- `docs/architecture/SystemArchitecture.md` 與 `docs/architecture/ExternalInterfaces.md` 仍有舊 verification vocabulary，部分 current/target 描述也需澄清。
- 規劃建立前的 runtime snapshot 顯示：8790 listener 的 backend parent 已不存在、排程工作為 Ready，tray log 沒有正常關閉紀錄。這是待重新驗證的 ownership 異常，不可把舊 PID 當成執行時事實。

## 範圍

### 要完成

- 將 verification state 的 UI label 收斂為單一共享 mapping，完整覆蓋 backend canonical enum。
- 補上 mapping contract 的 targeted tests，防止舊 alias 回流或 raw state 洩漏。
- 修正架構與外部介面文件中的 current contract，清楚標記尚未落地的 target-state 能力。
- 透過既有 Windows scheduled-task/tray lifecycle 恢復並驗證 tray → backend ownership。
- 對正式 runtime 完成 REST、MCP、browser、static-reference 與必要的資料庫唯讀驗收。
- 更新任務進度與封版判定；只有仍長期成立的事實才回寫產品路線圖。
- 在使用者另行授權時，以小範圍 commit 保存收尾變更；push 與 tag 另行處理。

### 不在範圍

- Intelligence Foundation、OMI、Kuro 或其他產品整合。
- 新 provider、新資料源、媒體 proxy、授權或公開部署。
- 資料庫 migration、backfill、production 資料改寫或為了測試而偽造 coverage/freshness。
- 移除 legacy compatibility API。
- AtlasStore 大型拆分、pipeline affected-story batching、domain presentation 全面資料化、deterministic baseline intelligence 等已接受的後續技術債。
- 無關 dependency upgrade、全站視覺重做或新功能開發。

## Hard constraints

- Backend schema 是 verification state 的 canonical owner；frontend 只負責顯示，不得重新定義語意或推導 state。
- `partial`、`stale`、`failed`、`missing`、`unknown` 必須如實呈現，不得以零值、空白圖或 synthetic fallback 掩蓋。
- Runtime 操作前必須重新解析 PID、port、command line、parent、scheduled task 與 log；只處理已證明屬於本專案的精確目標。
- 不得 broad-kill process、清除不明 PID/file、建立第二套常駐 launcher 或改用另一個永久 port。
- 正式啟動必須沿用 repo 既有 scheduled task/tray lifecycle；若 ownership 再次斷裂，停止封版並把它視為 P1 lifecycle defect。
- 不修改 production DB、不觸發外部 refetch、不重設 scheduler 設定來製造綠燈。
- Source validation、runtime adoption、live acceptance、commit、push/tag 是獨立 gate，必須分別留下證據。
- 保留既有 `0b5a391`；後續若獲得 commit 授權，建立小型收尾 commit，不 amend、不 broad-stage、不混入無關檔案。
- 本計畫本身不構成 runtime、commit、push 或 tag 授權。

## Trust boundaries

```text
Provider / source evidence
        ↓
Canonical Atlas schema and store
        ↓
REST + MCP projections
        ↓
Shared frontend presentation mapping
        ↓
Newsroom / Domain / Map / dialogs

Windows Scheduled Task
        ↓
Tray process
        ↓
Backend child process on 127.0.0.1:8790
```

- 上層 consumer 可以格式化，但不能改寫 canonical evidence、verification、freshness 或 coverage。
- Launcher/tray 負責 backend lifecycle；單獨存活且失去合法 parent 的 backend 不能算正式 runtime adoption。

## 交付物

- 共用 verification label module 與 Newsroom/Domain 接線。
- Canonical eight-state mapping 與 fallback 行為的 targeted tests。
- 修正後的 `SystemArchitecture.md`、`ExternalInterfaces.md`。
- 完整 source validation 記錄。
- Tray/backend ownership 恢復與 bounded stability 證據。
- REST、MCP、browser、Map request-path 與資料狀態驗收記錄。
- 更新後的 `Progress.md`；封版通過後再同步必要的 Roadmap 事實。
- 經另行授權後的小型 closeout commit；push/tag 狀態獨立記錄。

## 完成條件

- [ ] UI mapping 精確覆蓋 canonical 八個 verification state，舊 alias 不再存在於 production frontend mapping。
- [ ] 未知未來值只走明確 fallback，不會誤標成已驗證或隱藏 raw contract defect。
- [ ] Targeted tests、repo checks、tests、verify 與 dependency audit 符合 `Plan.md` 的門檻。
- [ ] Current architecture/interface docs 不再宣稱舊 verification、severity 或 coverage vocabulary。
- [ ] 正式 tray 存活，backend 是其可驗證 child，8790 只有預期 owner，且 bounded recheck 仍成立。
- [ ] REST 與 MCP 回傳語意一致，lineage、policy、cursor、warnings 與 partial/stale 狀態均可觀察。
- [ ] Newsroom、四個 domain、Map、搜尋/對話框與狀態提示在 desktop/mobile 實際可用，無破版、raw enum、空白假圖或 console error。
- [ ] Map 的 live request path 證明只使用目前 `/api/v1/...` contract；不得只靠 source search 推定。
- [ ] Read-only DB integrity/media invariant 檢查通過，或任何例外已明確列為 release blocker。
- [ ] `Progress.md` 有最終 evidence packet、accepted debt 與 `GO` / `NO-GO` 判定。
- [ ] Commit、push 與 tag 的實際狀態如實記錄；未授權或未執行不得宣稱已發布。
