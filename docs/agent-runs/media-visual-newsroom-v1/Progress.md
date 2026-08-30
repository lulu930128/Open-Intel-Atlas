# Progress

## Status

- Current phase: first bounded provider live-adopted and UI-verified
- Last updated: 2026-08-30 15:06 +08:00

## Completed

- 將 `open_intel_atlas_media_visual_newsroom_v1_upgrade.txt` 視為工程提案，先完成 repo truth／架構缺口與 security／rights review，再依使用者後續授權實作。
- 對齊 ProductVision、OperatingModel、QualityBar、Roadmap、DataModel、SystemArchitecture、ExternalInterfaces 與既有 Editorial Newsroom／Consumer Gateway 邊界。
- Source release 收斂為 `1.3.0`；README、package、lockfile 與 runtime health version 一致，consumer contract 維持 additive-compatible `1.1`。
- 新增 fail-closed media policy 與 Document media normalizer：拒絕 userinfo、IP、localhost／`.local`、非 HTTP(S)、不安全 MIME；`remote_embed` 另要求 HTTPS、可嵌入 rights 與 allowed host。
- Schema v4 新增 `sources.media_policy_json`、`document_media`、Document+media transaction、URL dedupe、enum/dimension checks 與每 Document 最多一筆 representative 的 partial unique index。
- GDELT `socialimage`、RSS/Atom `media:content`／`media:thumbnail`／image enclosure 已進 normalized candidate path；未抓 article HTML。
- Document、Story、Event、REST 與 MCP 共用 representative media projection；compact latest／brief 不再逐筆 `getEvent()`，只有 evidence pack 進 detail hydration。
- Newsroom 加入 Evidence Aperture：Hero、Latest 前三則、每 Domain 首則與 detail 支援 source image／Atlas editorial visual；Live Desk 維持 text-first。使用者 live 驗收發現純文字 field card 容易被理解成圖片空白後，fallback 已改為政治、科技、金融、災害四種清楚可見的內建圖形，仍不冒充來源圖片。
- Static UI 加入 CSP、Referrer-Policy、Permissions-Policy；後續 policy cleanup 將 remote image failure 改為移除整個 visual，不隱藏 headline 或 evidence。
- Hazards mini-map、Finance data visual 與更完整 domain-specific visual 延後至 Media v1.1。
- 依使用者最新產品決策移除 production missing-image fallback：只有 `remote_embed` 產生 visual block；Hero、Latest、Domain 與 detail 無圖時直接進純文字內容，Latest／Domain class 依實際 visual 決定。
- Broken source image 會移除整個 figure，並在 containing section 留下 `data-media-state=failed` 供診斷；沒有來源 alt text 時使用空 alt，避免重複朗讀 headline。
- Source media policy 新增 `display_authorization`、`terms_url`、`reviewed_at` gate；`publisher_owned` 不再單獨構成展示授權。
- BBC News World RSS 已加入第一個 bounded live policy：官方 feed 的 240×135 thumbnail 只有在 `ATLAS_MEDIA_USAGE_CONTEXT=personal_noncommercial` 時，才允許 exact `ichef.bbci.co.uk` remote embed；其他情境維持 `candidate`。

## Validation evidence

- Baseline `npm run verify`：Open Intel Atlas `1.2.0`、34 files syntax check、10/10 tests passed。
- Media targeted tests：policy／URL gate、RSS media parser、v3-shaped migration、transactional persistence 與 representative invariant 4/4 passed。
- Backend contract tests：fixture remote media 由 Event／brief／REST／MCP 一致投影；test double 證明 compact latest／brief 不呼叫逐筆 `getEvent()`。
- Actual copied-DB migration：live read-only backup 的 schema `3→4`；Documents `1,033→1,033`、Stories `589→589`、Events `508→508`、Story updates `400→400`，`countsPreserved=true`；copy 中 `document_media=0` 符合 no-backfill 設計。
- Isolated runtime：copy DB、`ATLAS_AUTO_COLLECT=false`、port `43215`；health/UI 使用 source `1.3.0`／schema v4，完成後已停止且清除 temp DB。
- Browser：desktop 與 390px mobile 實際畫面通過；mobile `scrollWidth=clientWidth=375`、8 個 visual slot、0 remote image、0 failed image、console errors/warnings 為空；event detail dialog 可讀 evidence 並正常關閉。
- Final regression：`npm run verify` 通過，37 files syntax check、17/17 tests passed；`npm audit --audit-level=high --ignore-scripts` 為 0 vulnerabilities；`git diff --check` 通過。
- Live browser：runtime adoption 後 reload，8/8 visual slots 均輸出 domain-specific SVG motif；1265px desktop 與 626px 窄畫面皆 `scrollWidth=clientWidth`，無水平 overflow。Live `document_media=0`／remote image=0 仍如實標示為來源圖片未提供。
- Live adoption：schema v4 已於前一階段完成；本輪沒有 schema migration。採用新 backend policy 時發現 tray stop 留下 PID 43656 orphan，經 command／parent／port 精準確認後只停止該 PID，再由 `Open Intel Atlas` Scheduled Task 恢復為 tray PID 39960 → backend PID 50716，task `Running`。
- Display-policy targeted tests：no media／candidate／link_only／blocked 不輸出 visual；remote fixture 輸出 `<img>`；broken image helper 移除 figure 並保留診斷狀態；10/10 targeted tests passed。
- Isolated browser：copied DB、scheduler off、port 43216；desktop 1265px 與 mobile 375px 都是 0 visual、0 fallback label、`scrollWidth=clientWidth`，detail title／evidence 可讀，console error/warning 為 0；隔離 runtime、分頁與 temp DB 已清除。
- Live browser：31 筆 representative media sample 全部為 `candidate`、0 `remote_embed`；桌面與 mobile 都不產生 visual block，headline 可讀、無 overflow、console error/warning 為 0。Live DB `quick_check=ok`、schema 4、representative violations 0。
- BBC official feed probe：HTTP 200，當期 item 直接提供 240×135 `media:thumbnail`，host 為 `ichef.bbci.co.uk`；BBC Terms of Use 的 RSS 章節允許個人將 BBC News RSS feed 放到網站並要求 attribution，商業使用另需 license／permission。
- BBC bounded recollect：source policy 為 `bbc-news-rss-personal-v1`、`public_terms`、exact host allowlist；30 筆 current feed media 升為 `remote_embed`，3 筆歷史 media 保持 `candidate`，未做無界 backfill。
- Live runtime：精確清除已驗證的 PID 50716 Atlas orphan 後，由既有 Scheduled Task 重建 tray PID 51524 → backend PID 55852；task `Running`、health `ok`、version `1.3.0`、schema 4。
- Live DB：BBC `remote_embed=30`、`candidate=3`、remote host 只有 `ichef.bbci.co.uk`；`quick_check=ok`、representative violation groups 0。
- Live browser：desktop 1265px 與 mobile 360px 圖片皆實際完成載入（natural 240×135），BBC attribution 可見、0 failed image、console error/warning 為 0；mobile `scrollWidth=clientWidth=360`。驗收過程發現長內容可撐寬 Latest grid，已以局部 `min-width: 0`／`overflow-wrap` 修正。
- Final regression：`npm run verify` 通過，37 files syntax check、18/18 tests passed；`git diff --check` 通過。

## Decisions made

- `remote_embed` 採 fail-closed；沒有 source-specific display authorization、terms evidence、review time 或 host evidence 時只保存 candidate／link，Newsroom 不產生 visual。
- Schema migration 與舊資料 media backfill 分離；第一版不在 DDL migration 解析 raw JSON 或抓網路。
- Media／rights policy 變化不冒充 Story semantic update；若未來需要 presentation change stream，另定 contract。
- Story／Event 優先沿 representative Document 選圖；該 Document 無 media 時才由既有 evidence lineage deterministic fallback，不建立第二份圖片 truth。
- Source-ready、copied-DB-ready、isolated-runtime-ready、runtime-adopted、provider-live 與 UI-visible 分別記錄。

## Known issues / risks

- 目前沒有 GDELT live Document 可證明真實 source image；fixture path 已完成，但 provider-live 仍依賴上游狀態。
- BBC policy 只涵蓋目前本機個人非商業 runtime；不代表商業、公網、多使用者或其他 BBC metadata 使用已獲授權。
- Source image remote embedding 涉及 rights、privacy、Referer、tracking 與內網 URL 風險；不得只以 scheme validation 放行。
- BBC feed 僅提供 240×135 thumbnail，適合列表與 domain card；放大到 Hero 可能有清晰度限制。
- Live freshness 仍為 `stale`、coverage 為 `partial`，4 個既有 warning（含 GDELT failure／latest-only gap）與本次 BBC 圖片接入分開處理。

## Next step

- 逐一 review 其他真實來源，不沿用 BBC 授權；若要提高 BBC 圖片解析度，需先確認可取得且授權範圍相符的官方 syndication 介面，不改寫 feed thumbnail URL。
