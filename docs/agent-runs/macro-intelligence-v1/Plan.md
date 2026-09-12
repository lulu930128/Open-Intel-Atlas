# 實作計畫

1. 官方 HTML 表格與日曆 parser、明確 indicator registry、時間與口徑測試。
2. additive schema migration、Macro store、Source Result／pipeline 交易接點、修訂與重抓驗證。
3. 既有 scheduler 的 Macro bounded watch policy、錯誤退避與重啟恢復。
4. 共用 capability、REST／MCP registration、唯讀與 parity／pagination regression。
5. 官方樣本驗證、相關既有 regression、文件與 scoped diff 檢查。

任何身份、reference period、欄位口徑無法驗證時 fail closed；修正後才前進。正式發布延遲不能由 fixture 或過去資料替代。
