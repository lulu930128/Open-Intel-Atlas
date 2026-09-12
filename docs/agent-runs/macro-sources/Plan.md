# 施工計畫

1. 檢查 BLS Employment Situation、BEA GDP、DOL weekly claims PDF、Fed calendar/statement/implementation 的真實樣本。
2. 新增明確指標 metadata、四組 parser 與 bounded adapters；HTML/PDF 格式不符 fail closed，缺值不補零。Poppler 路徑採設定，不寫死機器值。
3. 加入 FOMC typed decision／date-only effective date、來源日曆與 artifact lineage，維持查詢唯讀。
4. 補官方 fixture、negative/partial/idempotency、REST/MCP、shared regression；前端加入四組與決議／附件投影。
5. 官方樣本在隔離 DB 驗證，整理程式碼入口、實測範圍與未通過項目；正式載入須先備份與副本檢查。
