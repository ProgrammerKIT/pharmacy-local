Kit於2026-11-15明確授權發布並部署v1.5.108；正式裝置切換、資料不變性及iPhone版本另行核對。下列隔離紀錄的「未發布」為驗收當時狀態。

# 外部CSV隔離修正驗收

v1.5.108 外部CSV獨立呈現隔離候選（2026-11-15，未發布／未部署）
完整1110項回歸通過，0失敗／取消／略過。命令：node --test test/*.test.mjs。原先本機HTTPS測試受沙箱listen EPERM阻擋；允許暫時本機測試埠後整套重新執行通過，非跳過。退役的CSV UI新增／補欄／整併測試改為獨立來源事件驗收；歷史解析及純函式相容稽核仍保留，正式App保存入口明確拒絕其store／visit輸出。
新增驗證source-only前綴與blob不變性、已手改／來源缺失舊筆記保留、對應預設空白、逐列與最後確認、未知列保留原件、不同地點識別／通路、刪除／分歧／待確認門市、重傳與新版／歷史、並行來源不任選、CSV逐字與HTML轉義、精確來源版本、加密往返、保存失敗、CAS／工作階段／跨背景及最後名單準備競態。
Chrome localhost虛構庫完成桌面及393×852操作：取消不寫入、未勾最後確認不可保存、兩版原件獨立保存、原2店／1筆拜訪與原文／下次跟進保持、各門市仍1版本、原文之後收合的外部資料入口、新舊來源及重開保持。這是Chrome手機尺寸，不是實體iPhone。原生選檔受ChatGPT擴充功能file URL權限阻擋，未修改權限；用隔離頁專用虛構File/DataTransfer按鈕觸發真實input change，不能冒稱原生選檔已驗收。
本輪不接正式服務、不匯入真實檔、不改密碼／配對／排程、不執行還原／推送／合併／發布／部署。未重分類或移除舊CSV人物來源，不改容量或佑全閉環契約。正式基準為v1.5.107，雙端正式升版需另授權。


保存層：`saveCSVBundle` → `assertExternalCSVAppendOnly` → 原有加密persist/CAS。新流程：`planExternalCSV`／`buildExternalCSVImport`；讀取：`externalCSVSourcesForStore`／`readExternalCSVSource`。source內mappings只綁定原件列與既有門市精確版本；supersedes只切換外部來源呈現。歷史純函式不是目前UI可呼叫的寫入流程，保存閘門對其輸出有負向測試。

候選程式與正式基準使用相同21條runtime路徑、schema2／protocol1。禁止為驗收直接操作正式庫、猜配來源或代替使用者審核人物。
