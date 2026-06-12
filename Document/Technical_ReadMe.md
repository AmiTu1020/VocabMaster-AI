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

### 6. 最新技術架構增強 (2026/06/08 與近期更新)
- **AI 內容過濾與情境翻譯動態覆寫機制 (Boilerplate Stripper & Meaningless Translation Fallback)**:
  - 建立正則表達式過濾器 (Boilerplate Stripper)，自動移除 AI 產出中常見的無效機器人贅字與標記 (如「請根據上下文寫出對應作答」、「提示：...」)。
  - **中英句型解析分離 (Mixed Sentence Extraction)**：自動偵測並剝離錯置於英文例句後方的整句中文翻譯。
  - **無效翻譯動態覆蓋機制**：當 AI 生成的 `translation` 被過濾器洗空，或者 AI 直接將單字的「字典解釋」塞入情境翻譯時，系統會動態觸發失效條件 (`isMeaningless = !cleanTrans || cleanTrans === currentWord.translation`)，並自動拿前面剝離下來的完美「整句情境大意」來覆蓋原先的無效內容，徹底解決測驗區與單字庫面臨的翻譯被洗掉遺失的殘留邊界問題。
- **Firestore 防禦性深度清理機制**: 
  - 由於 Firestore 全面禁止在更新 Map 時夾帶 Javascript 的 `undefined` 値（即使身處巢狀物件中亦然），我們在 `QuizPanel` 的 `handleSaveChallengeToCloud` 本地手動落實了顯式屬性 Fallback 設計，並在 `ImportPanel` 與批次存儲端導入了基於 `JSON.parse(JSON.stringify())` 的深拷貝序列化技術，確保任何不為人知的選填型別空值不會阻礙資料庫存儲。
- **批次圖片單字優先度決策 (Precedence Filter)**: 
  - 修改 `ImportPanel` 的截圖比對模組。在遍歷 local 佇列與 cloud 資料庫時，若有重疊單字，程式會提取單字物件的 `.data()`，一律強制將新圖片產出的 `quizChallenge` 物件深層序列化並覆寫 `updateDoc`，徹底覆蓋舊數據，解決了舊情境資料殘留的邊界條件。
- **單字拼寫對齊與輸入框部分字元預留算法 (Partial String Diffing Input Alignment)**:
  - 實作了字元級對齊演算法：分析 `wordInputs` 的各個字元並比對目標單字，拼錯或未輸入字元以首字下劃線 `_` 展現，而拼對的部分則實時過濾大小寫保留。隨後動態更新 `wordInputs` 及 `userInput` state，使用戶在拼錯後可以直接使用上一次拼對的字元進行無痛修改。
- **音標框顯示濾除與延遲語音播報機制 (Phonetic Elimination & Delayed TTS Activation)**:
  - 針對拼寫測驗情境卡，系統主動「隱藏測驗卡底部的音標提示」，防止不支援國際音標字型的裝置顯示令人困惑的「空白字方框 (Square Box Font Fallback)」。
  - 為了強化使用者的「先拼寫思考、後聆聽加深印象」的學習效果，將**整句朗讀發音按鈕的顯示時機，延遲到答案正式公布 (確認答案正確或被揭曉) 之後才動態出現** (配有精美 bounce 微動畫引導使用者點擊)，達成測驗過程中的「耳腦專注」與答對時的「聽覺記憶強化」。
- **一體化高效率單一維度篩選狀態機 (Unified Dimension State Filter Ribbon)**:
  - 捨棄多列過濾面板所引發的多重狀態重疊與計算混淆。
  - 將「常忘狀態」與「測驗狀態」解耦，轉化為強健的單一狀態機模式 (`activeFilter: 'all' | 'hard' | 'hasQuiz' | 'noQuiz'`)，在 `filter()` 遍歷中實現極速 O(1) 的分支過濾評估。
  - 降低介面複雜度的同時大幅提高效能，並完美融合動態統計指示器 (`hardCount`, `withQuizCount`, `withoutQuizCount`) 的即時 React State 更新。
- **無斷層寬度自適應美學折行引擎 (Zero-Truncation Text Wrapping Engine)**:
  - 為了解決長字串在固定寬度容器（特別是卡片）下因 `truncate` 或 `text-ellipsis` 導致內容損失的 UX 痛點，全面廢除固定長度截斷。
  - 改採 `items-start` 分層對齊，結合 Tailwind CSS 的 `break-words` 與 `whitespace-normal` 佈局。使所有長單字、複雜詞語、國際音標及中文描述能流暢地按寬度邊界作垂直向下的自適應多行擴充，在根本上避免了文字被裁切的現象。
- **寫入對齊與 Firebase 快照 ID 強制映射映射 (Strict Document Snapshot ID Decoupling)**:
  - 為避免前端在進行讀寫和實時快照（onSnapshot）訂閱時，由於 object spread 解構順序混亂 (`{...doc.data(), id: doc.id}`) 而丟失 ID 或導致臨時性 ID 丟失、重整。
  - 重新標準化資料映射：在解構 `.data()` 時，確保將 `id: doc.id` 覆蓋在屬性最尾端，或作顯式屬性聲明，從而在資料層保證 UI 全生命週期內每個 VocabEntry 只有唯一權威 ID。
  - 此舉完美排除了 StrictMode 或 React 18 Concurrent Rendering 掛載和重新訂閱時帶來的短暫狀態不同步。


