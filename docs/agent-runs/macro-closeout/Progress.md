# Macro 基準版本收尾紀錄

2026-09-12。使用者已明確授權 commit、push 與 minor version 升級至 1.4.0。以下指紋與 PID 為升版前收尾證據；1.4.0 驗證另記於 Release-1.4.0.md。

先前 commit 授權缺口已由本次明確指令解除；提交僅涵蓋已審查的 staged 範圍。

## 已完成

- 七組 Macro：CPI、PPI、PCE、Employment、GDP、Claims、FOMC。schema 11、39 indicators、79 observations。
- `atlasSourceFingerprint.js` 保存啟動時來源指紋，`/api/v1/runtime` 與 endpoint 檔一致。LF normalization 消除 Git/Windows 換行差異；內容改動必須改變 digest，`.env` 不參與雜湊。
- `scripts/lib/macro-parity.mjs` 對照 calendar、release、indicator、observations 的 data/coverage/freshness/warnings。
- `verify-macro-closeout.mjs --copy` 用正式 DB online backup 啟動隔離 runtime，禁止 provider I/O，檢查服務 owner connection 的 total_changes；`--formal` 只讀正式服務並核對啟動指紋，明確不冒充 owner connection 寫入計數驗證。
- release-window 工具補逐次 HTTP status、raw fetch lineage 與完整 REST/MCP projection。此次舊 CPI 發布窗口捕捉正確標為 after_window/verified=false，沒有用事後採集冒充即時驗收。

## 候選提交驗證

候選目錄：`.tmp/macro-closeout-candidate/`，由精準 staged index 匯出，未複製 `.env`、DB 或工作目錄未 stage 的程式。Node 使用既有安裝依賴，package-lock 保留；本輪沒有重新從網路安裝 dependencies。

- `npm run check`：135 files passed。
- `node --test --test-isolation=none`：162 passed，0 failed，含 fresh schema、Macro migration、scheduler、backend、Entity/Company、regional 相容性。
- 初次全套測試找出 regional brief 的假 Store 缺少 macroCatalog；補齊替身後全套通過，正式查詢行為未為此變更。
- `git diff --cached --check` 通過。官方 HTML/PDF-text fixture 保留 upstream 空白與表格排版，`.gitattributes` 僅對這兩個 fixture 目錄排除 whitespace lint；未修改抓取內容迎合格式檢查。
- candidate 與正式 working source 指紋一致：`fc581065aafb543591e74022e525f3d90ba9534c8b2bf7ee74b6ef3eb4f43733`；69 files，`sha256-utf8-lf`，scope `atlas-backend-and-macro-ui-v1`。
- candidate 的真實資料副本：七組 × 四種能力全部 parity，complete/current，FK 0、57 筆舊觀測逐欄相同，owning connection total_changes 不變。

## 正式採用

原 backend 在確認 idle、PID/endpoint/command line 一致後停止，由既有 Tray 啟動新 owner。正式 PID 48188，2026-09-12 14:09:41 臺北時間啟動，8790，指紋與候選版本相同。

正式驗證於 14:09 完成：七組 complete/current，28 組 REST/MCP 投影一致；schema 11、39 indicators、79 observations、FK 0、原有 57 筆逐欄保留；讀取期間 source runs 與 observation counts 不變。正式 total_changes 欄位為 null，避免錯誤地拿另一個 read-only DB connection 作證。

證據保存在 Git 外：

- `data/runtime/macro-closeout-copy-2026-09-12T06-03-11-324Z/proof.json`
- `.tmp/macro-closeout-candidate/data/runtime/macro-closeout-copy-2026-09-12T06-08-08-047Z/proof.json`
- `data/runtime/macro-closeout-formal-2026-09-12T06-09-47-438Z/proof.json`
- `data/runtime/macro-release-windows/US_CPI_2026-08-2026-09-12T06-10-07-688Z.json`
- 備份與原始設定：`data/db/backups/macro-generalization-2026-09-12T05-20-59-453Z/`。

## 提交範圍審查

詳見 Plan.md 與 CheckpointFiles.txt。Macro 共用的 schema 6–8、Entity/Company、source-result、分類與 canonical pipeline 是 HEAD schema 5 到現行正式 backend 的依賴，這次明列保存；沒有用 `git add .`。Macro 導覽直接使用的股票頁及 view model/CSS 一併保留，避免 clean checkout 出現壞連結。首頁只 stage 總體數據入口；其他 newsroom/domain 視覺、controller、Tray、runtime 與修復作業腳本留在工作目錄。

高可信 credential pattern 與 staged paths 檢查未發現 private key/token、正式 `.env`、DB、logs、runtime artifacts。原有官方 fixture 與 test-only synthetic credentials 為測試資料。

## 明確保留的限制

Release-window latency 尚未實戰。下一次正式窗口前啟動觀察，保存各次嘗試、首次值/complete、health、lineage 與 parity 後才能驗收。此次不安排自動提醒或監控。

Full historical vintage、structured dot plot、Event bridge、forecast/surprise、OMI、下一批來源維持 backlog。Claims 六小時 cadence／無臆測假日發布日曆、PDF raw archive 截斷照實揭露。checkpoint 不包含 `.env` 私人機器設定，也不宣稱在另一台機器零設定即可取得官方資料；DOL 需安裝 Poppler 並設定 executable path。
