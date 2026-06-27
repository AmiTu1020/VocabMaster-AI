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
  - 此舉完美排除了 StrictMode 或 React 18 Concurrent Rendering 掛載 and 重新訂閱時帶來的短暫狀態不同步。

- **行動版瀏覽器網址列自適應與內部滾動機制 (Mobile Browser URL Bar & Sticky Fix Layout - 2026/06/20)**:
  - **背景痛點**：行動版 Safari / Chrome 在向下滑動時會自動隱藏頂部網址列（URL Bar），導致視窗高度重新計算，使綁定於 `min-h-screen` 和基於全域滾動的 `position: sticky` 元素瞬間失效或嚴重跳動脫排。
  - **全域滾動權接管 (Scroll Takeover)**：將最外層 `App` 根容器高度設定為支援動態視口的 `h-[100dvh] flex flex-col overflow-hidden`，捨棄 `min-h-screen`，從全域 Window/Body 徹底拿走滾動權限。
  - **內部驅動分層滾動 (Internal Y-Axis Scroll)**：將主要內容區塊獨立封裝並設定為 `flex-1 overflow-y-auto`。此舉使得 `position: sticky` 的各級導覽列僅受內部 flex 容器滾動計算，完全免疫因網址列伸縮帶來的外部視窗大小改變，確保 Sticky 排版在行動設備上實現鋼鐵般的完美吸頂與平滑度。

- **三維常忘單字異步更新架構 (Multi-Entry Async Star Persistence Model - 2026/06/12)**:
  - **資料同步策略**：實作 `toggleWordHardById(wordId, currentStatus, sessionIndex, wordStr)` 多維同步函數。在使用者於測驗卡、答畢提醒卡、完賽結算複習清單點擊星星標記時，同步進行三層狀態變更：
    1. **本機測驗序列更新**：變更 `sessionList` 單字對象之 `.isHard` 屬性，確保測驗主卡片與結算卡片立即動態重繪。
    2. **全局緩存更新**：變更 `vocabPool` 單字清單對象之屬性，確保使用者回到單字本頁面（LibraryPanel）時讀取到最新的常忘狀態。
    3. **異步雲端持久化**：使用 `setDoc(docRef, { isHard: newHardStatus }, { merge: true })` 向 Firestore 資料庫寫入更新，杜絕空值衝突，兼顧無感本地響應與數據庫高可靠性。
  - **交互一致性設計**：整合級聯狀態與多星按鈕，讓通關清單上的各個單字星星相互獨立、自由切換，而不影響其他單字或觸發非預期重繪；並在測驗卡左上角引入按鈕觸發本機單字狀態轉換，保證多設備、多場景一致體感。

- **語音異步監聽生命週期閉包修復 (Speech Recognition Closure Trap & Ref Binding - 2026/06/12)**:
  - **背景**：`webkitSpeechRecognition` 事件回調（onresult）時會捕捉初次掛載時之過期 React State，形成閉包陷阱（Closure Trap）。這使語音辨識成功能，在異步回調呼叫 `updateUserInputAndWordInputs` 處理時，讀取不到最新變更的字元格屬性（`wordInputs`），導致辨識字串無法即時在拼字獨立框中順利顯現。
  - **實作**：增設 `latestUpdateRef = useRef(updateUserInputAndWordInputs)` 伴隨最新 Render 動態更新。在 `onresult` 觸發時藉由呼叫 `latestUpdateRef.current(...)` 穿透閉包牆，將語音單字 100% 精準投射至各個客製字元格子中。

- **複習清單 TTS 語音朗讀與冒泡防禦 (Speech Synthesis Integration in Quiz Review - 2026/06/12)**:
  - **實作**：將現有 Web Speech API (`window.speechSynthesis`) 全局發音器引用至大滿貫結算畫面。為本輪複習清單的每個拼寫單字追加獨立的喇叭播放按鈕，其 `onClick` 函數內部呼叫 `e.stopPropagation()` 防止觸發卡片父容器其他非預設行為，提供直觀、立竿見影的高效糾錯學習模式。

- **自適應雙層/三層置頂控制系統 (Adaptive Two-Tier/Three-Tier Sticky Stacking CSS Layout - 2026/06/20)**:
  - **CSS 層疊與位置配置**：精細化重塑頁面響應式骨架，避免由於 `scrollIntoView` 呼喚時將核心控制鈕捲出移動版視口之外、或是造成置頂與導覽被推跑：
    1. **主窗面標題欄 (App Header)**：手機端設為 `relative` 伴隨滑動自如收合，將螢幕高度還給主要學習視窗；桌機端設為 `sm:sticky top-0 z-30 border-b bg-white/80`，常駐固定。
    2. **TabsList 置頂容器 (Tabs navigation)**：在 `App.tsx` 中將分頁頁籤 `<TabsList>` 封裝在 `sticky top-0 sm:top-[64px] z-20 bg-slate-50/95 backdrop-blur-sm py-2` 特性容器中。巧妙運用 `mb-4` 及負邊距 `-mx-4 px-4 sm:-mx-0` 讓它在移動端能以 `top-0` 完美替代滾走的 Header，而 PC 端大螢幕則以 `top-[64px]` 無縫承接在 Header 之下。
    3. **底層功能分類與播放器控制條**：在 `LibraryPanel.tsx` 中將 `雲端存檔 / 智慧分類` 條設定為 `sticky top-[64px] sm:top-[128px] z-10 bg-white/95 backdrop-blur-md`。在手機上它能精確吸附在高度為 64px 的 Tabs 之下（`top-[64px]`）；在桌機端則恰到好處排列於 `top-[128px]`，實現齒輪般的精準對齊。
  - **優化成果**：不論在桌機還是手機 Native / Chrome 瀏覽、或是 nested iframe preview 環境內，當單字連播觸發 auto-scroll 或使用者手動滾動頁面時，頂部面板皆能以絕對、牢不可破的形式完美「keep 住」在螢幕最上方，控制面板無任何位移、重疊或遮擋，達到頂尖音訊播放器級別的操作手感。

- **分頁激活狀態感知與 TTS 語音發音即時截載 (Smart Tab-Switching Active Sensing & Speech Cancellation - 2026/06/20)**:
  - **核心邏輯**：
    1. **屬性注入 (Prop Injection)**：在 `LibraryPanel.tsx` 導出元件中引入 `isActive?: boolean`（預設為 `true`）。
    2. **狀態綁定 (Binding)**：在主介面 `App.tsx` 中 rendering `<LibraryPanel isActive={activeTab === "library"} />`，使其與選中的分頁 activeTab 建立起直接的單向數據流。
    3. **即時暫停副作用 (Auto-Pause Effect)**：在 `LibraryPanel.tsx` 中建立依賴於 `[isActive, touringIndex, isPaused]` 的 React `useEffect`。當偵測到 `isActive` 轉向 `false` 且當前為「連播進行中」時，即刻呼叫 `setIsPaused(true)` 讓連播進入「暫停狀態」。
    4. **語音即時取消 (Web Speech Cancellation)**：在自動暫停的同時，直接調用 Web Speech API 原生端點 `window.speechSynthesis.cancel()` 瞬時清除並中斷背景正處於工作中的任何單字或例句語音合成，徹底根除跨 TAB 播放引起的繁雜語音疊加，實現完美的音訊流管理。

- **AI 辨識萃取針對子句與片語的深度搜索防重複保護 (Phrase Variation Search Mechanism - 2026/06/20)**:
  - **核心邏輯**：
    1. **Schema 與 Prompt 擴充**：於 `server.ts` 內調整 Gemini 的 API Schema，新增並請求 AI 萃取出 `searchVariations` 字串陣列。若截圖目標是片語（如：`a couple of`）但單詞辨識出 `Couple`，則 AI 會在此回傳其變體與原始片語內容。
    2. **展開查詢樹**：於 `ImportPanel.tsx` 中將提取之 `word`、`baseForm` 以及 `searchVariations` 與其大小寫字串變化版本全部攤平至一個陣列中，接續運用 ES6 `[...new Set(array)]` 原型函數做去重，最終使用 `where("word", "in", searchTerms)` 完整核對 Firestore，若該筆資料早已於雲端內存在如 `a couple (of)` 之形式，即可精準命中並排除重複。

- **雲端單字與辨識萃取自動補全美式音標架構 (Automated Phonetic Transcription Supplement & Batch Generation - 2026/06/27)**:
  - **背景痛點**：截圖中經常缺乏音標資訊，導致匯入雲端後發音學習受阻。
  - **前端批次補全調度 (Batch Processing & Throttling)**：
    - 於 `LibraryPanel.tsx` 實作 `supplementPhonetics` 函數，過濾出雲端資料庫中音標缺失（如為空、`/`、`//` 或 `N/A`）的單字集合。
    - 將待處理清單以 `batchSize = 15` 的大小進行分塊 (Chunking) 批次發送，避免因一次性請求過大觸發 API 負載限制，並利用迴圈逐步處理與更新 Firestore。
  - **後端專屬端點與 AI 精準生成 (Dedicated Backend Endpoint & LLM Prompting)**：
    - 新增 `/api/gemini/generate-phonetics-batch` 伺服器端點，利用 Gemini 模型處理傳入的單字陣列。
    - **Prompt 嚴格規範**：強制賦予 Gemini 專家級辭書學者 (Expert Lexicographer) 角色，並嚴格規定回傳標準美式 K.K. 音標（Standard American English phonetic symbols, IPA），且需包含斜線包裹（如 `/ˈtʃærəti/`）。透過 `responseSchema` 綁定 JSON 陣列結構 `[{ word, phonetic }]`，確保前端解析 100% 穩定。
  - **萃取階段強制補全 (Extraction-Phase Enforcement)**：
    - 同步升級 `/api/gemini/extract-vocab` 伺服器端點內的 AI 提示詞 (Prompt)，指示模型在分析圖片時，若圖片中未見明顯音標，**必須自動生成並補全標準美式音標**，不可留空。達成從源頭建檔到事後修補的完美音標覆蓋率。

- **動詞不定詞前端與 AI 雙向裁切防禦架構 (Infinitive Prefix Stripping & Retroactive Cleanup - 2026/06/27)**:
  - **背景痛點**：當截圖中辨識出 `to evolve` 這類附帶 `to ` 前置詞的動詞不定詞時，會直接破壞資料庫單一詞性的純粹度，阻礙防重複搜尋。
  - **提取層預防 (Extraction-Phase Prevention)**：
    - **後端 AI 指令升級**：在 `server.ts` 內加入 `CRITICAL` 提示規則，嚴格要求 Gemini 在擷取字元時若發現 `to ` 前綴（例：`to evolve`），必須自動截斷並只回傳純動詞 (`evolve`)。
    - **前端服務二次防護 (Frontend Payload Sanitization)**：於 `geminiService.ts` 解析 JSON 回傳時注入字串裁切機制，凡偵測到 `word` 或 `baseForm` 開頭為 `to ` 且字串長度大於 3，強制透過 `substring(3).trim()` 處理乾淨，確保 100% 寫入安全的字串格式。
  - **事後修補機制 (Retroactive Database Cleanup)**：
    - 於 `LibraryPanel.tsx` 實作 `cleanupToPrefix` 批次掃描函數，前端篩選出 Firestore 歷史紀錄中帶有 `to ` 前綴的不定詞。
    - 使用客戶端批次處理並透過 `updateDoc` 將乾淨的動詞更新回 Firebase，解決既有庫存單字的遺留問題。
