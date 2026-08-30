# Release A／台灣第四個新增專用來源 preflight

## 範圍與邊界

- 日期：2026-08-30 Asia/Taipei。
- 目標是補足台灣新增專用來源，不以美國或全球 aggregator 的更多查詢替代 regional evidence。
- 本批只做官方文件查核、bounded live read、adapter／fixture／isolated store；沒有寫入正式 DB、沒有操作 8790、沒有 commit 或 push。

## `tw-ncdr-active-cap-alerts`：source-ready

- 官方介接說明：`https://alerts.ncdr.nat.gov.tw/web/developer/alerts-rss`。平台明示可由程式週期性讀取固定 Atom feed，且生效中示警適合網站引用。
- 採用端點：`https://alerts.ncdr.nat.gov.tw/RssAtomFeeds.ashx`。只讀生效中示警，不追抓每筆 CAP detail，也不使用需要會員/API key 的完整地方與事業單位資料。
- Feed 自身宣告 `<rights>Public Domain</rights>`。Adapter 每次都驗證此宣告；缺少或改為其他值時整個 run fail closed，不繼續持久化。
- 系統 client preflight：HTTP 200；約 97,930 bytes、142 entries、payload 在 256 KiB raw-payload bound 內。官方限制相鄰存取至少 3 秒，Atlas cadence 設為 5 分鐘且單次只有 1 fetch。
- Atlas Node no-write probe：HTTP 200、793 ms、1 fetch、95 Documents、payload 未截斷。
- 每次按 entry `updated` 由新到舊排序，最多投影 100 Documents；保存 CAP ID、status、msgType、effective、expires、原發布機關、原始 CAP URL 與 rights。
- 只有 `status=Actual`、`msgType=Alert|Update`、具 provider ID 且 URL 位於官方 `/Capstorage/` 才 `event_eligible=true`。Cancel、非官方 URL 或缺 identity 均 fail closed。
- `source_scope=TW` 可形成 TW／EAST_ASIA relevance；不從摘要中的地名猜座標、location 或 event country。
- Source class 為 `official_aggregator`，避免把同一平台內不同公告誤算成獨立媒體證據；authority class 為 `official`，因其承載原發布機關的正式 CAP lifecycle。

## `TWCERT/CC`：rights hold

- 官方 RSS 說明：`https://www.twcert.org.tw/tw/cp-40-2835-507dc-1.html`。
- 技術上存在資安新聞與 TVN RSS，但官方版權說明明載 RSS 僅供使用者閱讀，且不得逕自使用、修改、重製、改作、散布、發行或公開發表。
- 因 Atlas 會持久化、投影並對 UI/API/MCP 提供資料，不能把「瀏覽器可讀」解讀為允許產品再利用。
- 在取得明確授權或官方改採可再利用條款前，不註冊 adapter、不保存 metadata/full text、不以未文件化 API 繞過。

## Source-level acceptance

- Targeted tests 4/4：registry、CAP lifecycle、Taiwan localized timestamp、official-host allowlist、rights fail-closed、isolated idempotency、no-fake-location 與 TW relevance。
- Isolated store 第一次插入 1 Document／1 Event，第二次 inserted 0／updated 1；`event_locations=0`，RegionalRelevance 只有 TW 與 EAST_ASIA 各 0.75。
- Working-tree registry 為 33 registered／26 enabled；正式 runtime 仍維持既有 26-source tree，尚未 adoption。

正式 runtime adoption、跨 cadence health observation、正式 DB bounded reprocess 與 G5 browser/MCP 驗收仍是後續獨立 gates。
