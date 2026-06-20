# 專案開發規範 (Project Rules)

## 技術文件維護規則
- **檔案存取技術參考網址**：在整理或維護 `Technical_ReadMe.md` 或任何相關技術文件時，必須永久保留以下 Chrome 官方開發者文件網址：
  `https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#deleting_files_and_folders_in_a_directory`
- 此網址是關於 `File System Access API` 的核心實作依據，不可移除。

## 環境偵測與功能限制
- 僅對原生 Chrome (Desktop/Mobile) 開啟檔案刪除功能。
- 排除 Samsung Browser, Edge, Opera 等非純 Chrome 環境的刪除詢問。

## 行動版瀏覽器與版面配置限制 (Mobile Browser Layout & Sticky Rules)
- **固定視窗與內部捲動機制**：為了解決行動版 Chrome 等瀏覽器在向下滑動時自動隱藏網址列（URL bar）導致視窗高度重新計算，進而造成 `position: sticky` 元素跑位或失效的問題，必須遵循以下版面設計原則：
  1. **取消整頁滾動**：最外層容器（例如 `App` 根容器）必須設定為固定高度及隱藏溢出（例如 `h-[100dvh] flex flex-col overflow-hidden`），不可使用 `min-h-screen`，將滾動權從全域 Window/Body 拿走。
  2. **限制內部捲動**：將可以滾動的主要內容區塊設定為 `flex-1 overflow-y-auto`，確保只有內容區域本身可以捲動。
  3. **穩定的 Sticky 定位**：所有 `position: sticky` 導覽列與選單需放置於正確的 Flex 結構中，藉由內部捲動確保 Sticky 效果完美跟隨且不被外層視窗大小變更干擾。