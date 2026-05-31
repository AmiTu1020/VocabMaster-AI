# 專案開發規範 (Project Rules)

## 技術文件維護規則
- **檔案存取技術參考網址**：在整理或維護 `Technical_ReadMe.md` 或任何相關技術文件時，必須永久保留以下 Chrome 官方開發者文件網址：
  `https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#deleting_files_and_folders_in_a_directory`
- 此網址是關於 `File System Access API` 的核心實作依據，不可移除。

## 環境偵測與功能限制
- 僅對原生 Chrome (Desktop/Mobile) 開啟檔案刪除功能。
- 排除 Samsung Browser, Edge, Opera 等非純 Chrome 環境的刪除詢問。
