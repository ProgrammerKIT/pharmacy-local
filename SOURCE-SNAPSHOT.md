# Source Snapshot 不變條件

版本：1.0。適用於藥局關係筆記從 Google Maps CSV 進入 App 的來源保存層。

## 目的

每次使用者確認提交一批 CSV 時，先保存每一份原始 CSV 的完整 bytes。後續門市整合、欄位補值、人工裁定、文字整理、商品／議題字典、關聯探索與圖譜，都只能引用來源快照，不得回寫或重建原始檔內容。

## 固定規則

1. 每份已確認提交的 CSV 建立一筆 Source Snapshot。即使該檔所有資料列最後都略過或排除，Source Snapshot 仍須保存。
2. Source Snapshot 保存原始檔名、來源清單、批次識別、SHA-256 blob、原始欄名、解析列數、編碼與分隔符號。完整原始 bytes 以 SHA-256 為鍵加密保存在資料庫 blobs。
3. 相同 bytes 可共用同一 blob，避免重複佔空間；每一次確認提交仍建立新的 Source Snapshot，以保留該次來源事件。
4. Source Snapshot 是 append-only：不能建立父版本、不能標記刪除、不能由門市或拜訪編輯器修改。
5. 被納入門市／拜訪的來源列另外保存原始 headers、cells、實體行號、row fingerprint，並指回本次 Source Snapshot。
6. 顯示名稱、臺／台或全半形正規化、門市合併、字典標準名、摘要與關聯圖均屬 derived data；不得改變 Source Snapshot 或原始 cells。
7. 同一來源後續 CSV 有變更時，建立新的 Source Snapshot；舊快照不覆蓋。來源新版可形成門市／備註的新版本，但原始檔各自保留。
8. App 可從「匯入 CSV」頁查看已保存 Source Snapshot，並在使用者確認明文風險後下載原始 bytes。
9. Source Snapshot 跟隨既有加密備份與裝置同步。舊版 App 不認得 source record，因此 Mac 與 iPhone 必須先更新到支援 Source Snapshot 的版本，再提交新批次。
10. 目前資料庫總容量上限仍為 24 MB；達上限時整批提交失敗，不能為了騰空間自動刪除舊 Source Snapshot。

## 驗收條件

- 一般匯入：原始 bytes 逐位元保留；Source Snapshot SHA 與檔案 blob 一致。
- 全列排除：零門市、零拜訪仍留下完整原始 CSV。
- 相同檔案重傳：不新增客戶門市或拜訪版本，但新增一次來源快照事件；blob 可去重。
- 新版 CSV：舊 Source Snapshot 與新 Source Snapshot 同時存在。
- 門市／拜訪人工編輯、刪除、還原、裁定與關聯分析後，既有 Source Snapshot 不變。
- 嘗試對 source record 建立修改版本或刪除版本時，資料驗證必須拒絕。
- 加密備份、還原與雙裝置 merge 後，Source Snapshot 與原始 blob 仍存在。
- 來源快照可由 App 下載，下載 bytes 必須等於當初提交的 CSV bytes。
