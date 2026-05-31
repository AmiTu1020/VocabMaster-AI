# English Vocab Master - 技術架構說明 (README)

本文件詳細說明 English Vocab Master 各项功能所使用的底層技術與架構。

## 🛠 技術棧與架構

### 1. 核心開發環境
- **Frontend**: React 18 (Vite)
- **Styling**: Tailwind CSS
- **Animation**: Framer Motion (用於面板切換與平滑過渡)
- **Language**: TypeScript (確保型別安全與開發維護性)

### 2. 人工智慧 (AI) 整合
- **模型引擎**: Google Gemini 1.5 Flash
- **API 整合**: 使用 `@google/genai` SDK。
- **進階 Extraction Logic**:
    - **Prompt 指令優化**：特別針對「群組單字」進行處理，要求 AI 識別如 -able, portable, foldable 等結構並拆分為獨立學習項目，而非僅提取根節點。
    - **完整解析**：除單字與翻譯外，強制要求 AI 提取國際音標與 1-3 個上下文例句。

### 3. 後端與儲存 (Backend)
- **資料庫**: Firebase Firestore
- **身份驗證**: Firebase Authentication (Google Login)
- **資料結構**: 
    - 採用 `collections/documents` 架構儲存用戶個人單字集。
    - 針對安全性實施嚴格的 Firestore Security Rules (Identity-Based Access)，並已配置對 `isHard` (常忘單字) 標記欄位的更新權限。

### 4. 瀏覽器原生 API (Web APIs)
- **語音輸入 (STT)**: Web Speech API (`SpeechRecognition`)
    - 透過語音辨識將用戶口說轉為文字，用於智能測驗。
- **語音合成 (TTS)**: Web Speech API (`SpeechSynthesis`)
    - 提供標準美式英語語音。
    - **單字連播 (Auto-play)**: 自動循環播放雲端庫中的單字發音。配合 `scrollIntoView` 實作自動滾動與高亮顯示，並在每個單字間預留閒置時間 (4.5s) 供用戶記憶。支援根據「全部」或「常忘單字」標籤進行子集播放。
- **檔案存取 (File System Access API)**:
    - **技術參考**: [Chrome Developer Docs - Deleting Files](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#deleting_files_and_folders_in_a_directory)
    - **資料夾記憶**: 使用 `showOpenFilePicker` 並帶入固定 ID (`vocab-master-import`)，讓 Chrome 記住用戶偏好的截圖路徑。
    - **環境偵測 (Strict Browser Check)**: 實施嚴格的 User-Agent 檢查。僅對真正的 Chrome (Desktop/Mobile) 開放檔案刪除功能。會主動排除 Samsung Browser、Edge、Opera 等雖然基於 Chromium 但對 File System API 限制較多或 UA 行為不一的環境，以優化使用者體驗。
    - **自動化刪除程序**:
        - **權限鏈接**: 將 `window.confirm` 與 `handle.requestPermission({ mode: 'readwrite' })` 封裝在同一個同步任務中，確保符合瀏覽器的「使用者啟動」安全規範。
        - **UI 同步更新**: 圖片刪除或同步雲端後，立即重設 React State（清空 `extractedItems`, `previewImage`），達成「存完即走 (Sync & Clear)」的流暢體感。

### 5. 數據處理優化
- **圖片壓縮**: 使用 Canvas API 在上傳前將圖片等比例縮放至最長邊 1200px (JPEG/Quality 0.8)，減少頻寬消耗並提升 Gemini 處理速度。
