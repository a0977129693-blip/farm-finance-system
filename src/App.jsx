import React, { useState, useEffect, useMemo } from 'react';
import { 
  Card, Metric, Text, Title, BarChart, DonutChart, 
  Flex, Grid, BadgeDelta, ProgressBar, Button, Divider 
} from "@tremor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db, auth } from './firebase';
import { 
  collection, addDoc, query, orderBy, onSnapshot, 
  deleteDoc, doc, updateDoc, enableIndexedDbPersistence 
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { 
  Send, Trash2, Edit3, ClipboardCheck, LayoutDashboard, 
  Leaf, AlertTriangle, TrendingUp, Wallet, PenLine, Sparkles, PlusCircle 
} from 'lucide-react';

// 初始化離線持久化機制
try {
  enableIndexedDbPersistence(db);
} catch (err) {
  console.log("離線模式已在其他分頁啟動");
}

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

// 語意記帳常用語句
const QUICK_SUGGESTIONS = [
  { label: "客房收入", text: "昨天三間雙人房住宿收入 6000 元", icon: "🏠" },
  { label: "賣農產", text: "賣出高麗菜 20 斤共 800 元", icon: "🥦" },
  { label: "買肥料", text: "購買有機肥料支出 1200 元", icon: "🌿" },
  { label: "繳電費", text: "繳交本月農場電費 3500 元", icon: "💡" },
  { label: "發薪水", text: "支付臨時工兩天工資 3200 元", icon: "👷" },
];

// ✅ 修正一：Tremor colors prop 只接受內建色彩名稱字串，不能用 HEX
// BarChart categories 對應的顏色名稱必須是 Tremor 色系（emerald, rose, blue...）
const BAR_CHART_COLORS = ["emerald", "rose"];   // 收入=emerald綠, 支出=rose紅
const DONUT_COLORS = ["emerald", "amber", "rose", "blue", "violet"]; // 支出結構圓餅

// ✅ 修正二：改用 gemini-2.0-flash（你的 API Key 確認可用，最穩定）
// gemini-2.5-flash 高峰時段會回傳 503，gemini-2.0-flash 較穩定
const GEMINI_MODEL = "gemini-2.0-flash";

// 指數退避重試工具函式
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const generateWithRetry = async (model, prompt, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result;
    } catch (err) {
      const isRateLimit = err?.message?.includes('429') || err?.status === 429;
      const isServerError = err?.message?.includes('503') || err?.status === 503;
      
      if ((isRateLimit || isServerError) && attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.log(`API 限流，等待 ${waitTime / 1000} 秒後重試 (第 ${attempt + 1} 次)...`);
        await sleep(waitTime);
        continue;
      }
      throw err;
    }
  }
};

export default function App() {
  const [records, setRecords] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagLoading, setDiagLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: 0, category: '', description: '', type: 'income' });

  // 手動記帳表單狀態
  const [manualForm, setManualForm] = useState({ type: 'income', category: '住宿', amount: '', description: '' });
  const [manualLoading, setManualLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // 1. 系統啟動與身份驗證
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
      const q = query(collection(db, `users/${userCredential.user.uid}/records`), orderBy("createdAt", "desc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const recordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRecords(recordsData);
      });
      return () => unsubscribe();
    }).catch(console.error);
  }, []);

  // 2. AI 語意記帳 (NLP Parsing)
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      const prompt = `你現在是農場財務助理。分析語句並回傳純 JSON。
      類別：住宿、農產、肥料、薪資、水電、維修、雜項。
      語句：「${aiInput}」
      格式：{"type": "income"或"expense", "amount": 數字, "category": "上述類別", "description": "內容摘要"}`;
      
      const result = await generateWithRetry(model, prompt);
      const text = result.response.text().replace(/```json|```/g, '').trim();
      const data = JSON.parse(text);
      
      await addDoc(collection(db, `users/${userId}/records`), {
        ...data,
        createdAt: new Date().toISOString()
      });
      setAiInput('');
    } catch (e) {
      if (e?.message?.includes('429')) {
        alert("AI 請求已達上限，請稍候幾分鐘再試，或改用手動輸入。");
      } else if (e?.message?.includes('503')) {
        alert("AI 服務暫時繁忙（503），已自動重試 3 次仍失敗。請稍後再試或改用手動輸入。");
      } else {
        alert("AI 解析失敗，請嘗試更清楚的描述，或使用手動輸入。\n錯誤：" + (e?.message || '未知'));
      }
    }
    setLoading(false);
  };

  // 3. AI 經營診斷報告
  const generateDiagnosis = async () => {
    if (records.length === 0) return alert("尚無數據可分析");
    setDiagLoading(true);
    setDiagnosis('');
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      const history = records.slice(0, 15).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是農場經營顧問，分析這些帳目並提供經營策略建議(含支出異常預警，請用繁體中文回覆)：${history}`;
      const result = await generateWithRetry(model, prompt);
      setDiagnosis(result.response.text());
    } catch (e) {
      if (e?.message?.includes('429')) {
        setDiagnosis("⚠️ AI 請求次數已達上限（429 Too Many Requests）。\n請稍候 1～2 分鐘後再點擊生成報告，或改用付費 API Key 以提升配額。");
      } else if (e?.message?.includes('503')) {
        setDiagnosis("⚠️ AI 服務暫時繁忙（503 Service Unavailable）。\n已自動重試 3 次，請稍候幾分鐘後再點擊生成報告。");
      } else {
        setDiagnosis("診斷報告生成失敗，請檢查網路連線。\n錯誤訊息：" + (e?.message || '未知錯誤'));
      }
    }
    setDiagLoading(false);
  };

  // 4. 數據運算
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth());
    const prevMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth() - 1);

    const income = currentMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = currentMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const prevIncome = prevMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    
    const profit = income - expense;
    const prevProfit = prevIncome - prevMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const profitChange = prevProfit !== 0 ? ((profit - prevProfit) / Math.abs(prevProfit)) * 100 : 0;
    const ratio = income > 0 ? (expense / income) * 100 : 0;
    
    return { income, expense, balance: profit, ratio, profitChange };
  }, [records]);

  // ✅ 圖表資料 - categories 名稱須與資料 key 完全對應
  const barChartData = useMemo(() => ([
    { name: '當前統計', '收入': stats.income, '支出': stats.expense }
  ]), [stats]);

  const donutChartData = useMemo(() => {
    return records
      .filter(r => r.type === 'expense')
      .reduce((acc, curr) => {
        const ex = acc.find(i => i.name === curr.category);
        if (ex) ex.value += curr.amount;
        else acc.push({ name: curr.category, value: curr.amount });
        return acc;
      }, []);
  }, [records]);

  // 5. CRUD 基礎管理
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => {
    if (confirm("確定刪除此筆紀錄？")) await deleteDoc(doc(db, `users/${userId}/records`, id));
  };

  // 6. 手動記帳新增
  const handleManualAdd = async () => {
    if (!manualForm.amount || Number(manualForm.amount) <= 0) return alert("請輸入有效金額");
    if (!manualForm.description.trim()) return alert("請輸入描述");
    setManualLoading(true);
    try {
      await addDoc(collection(db, `users/${userId}/records`), {
        type: manualForm.type,
        amount: Number(manualForm.amount),
        category: manualForm.category,
        description: manualForm.description.trim(),
        createdAt: new Date().toISOString()
      });
      setManualForm({ type: 'income', category: '住宿', amount: '', description: '' });
      setManualOpen(false);
    } catch (e) {
      alert("儲存失敗，請檢查網路連線");
    }
    setManualLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-10">
      
      {/* 導航標頭 */}
      <header className="bg-emerald-900 text-white p-6 shadow-2xl border-b-4 border-amber-500">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Flex justifyContent="start" className="gap-3">
            <div className="bg-white p-2 rounded-lg">
              <Leaf className="text-emerald-800" size={28} />
            </div>
            <div>
              <Title className="text-white text-2xl font-black">農場民宿收支雲端系統</Title>
              <Text className="text-emerald-200">數位財務助手</Text>
            </div>
          </Flex>
          <div className="text-right hidden sm:block">
            <Text className="text-emerald-300 text-xs font-bold uppercase tracking-widest">Database Linked</Text>
            <div className="w-3 h-3 bg-green-400 rounded-full ml-auto mt-1 animate-pulse"></div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-8">
        
        {/* AI 語意記帳區 */}
        <Card className="bg-white border-2 border-emerald-100 shadow-xl ring-4 ring-emerald-500/5">
          <div className="flex items-center justify-between mb-4">
            <Title className="text-emerald-900 flex items-center gap-2">
              <Sparkles size={22} className="text-emerald-600" /> AI 語意快速記帳
            </Title>
            <BadgeDelta deltaType="increase" size="xs">精準解析中</BadgeDelta>
          </div>
          
          {/* 語意快速建議按鈕 */}
          <div className="mb-4 flex flex-wrap gap-2">
            <Text className="w-full text-xs font-bold text-slate-400 uppercase mb-1">常用範例點擊輸入：</Text>
            {QUICK_SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                onClick={() => setAiInput(s.text)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-full text-sm text-slate-600 transition-all active:scale-95"
              >
                <span>{s.icon}</span> {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <input 
                className="w-full p-4 pr-12 bg-slate-50 border-2 border-slate-200 rounded-xl text-lg focus:border-emerald-500 focus:bg-white outline-none transition-all placeholder:text-slate-400 text-slate-800"
                placeholder="例如：今天賣出五盒草莓收入 1000 元..."
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleAIParse()}
              />
              {aiInput && (
                <button onClick={() => setAiInput('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <button
              onClick={handleAIParse}
              disabled={loading || !aiInput.trim()}
              className="py-4 px-8 text-lg font-bold rounded-xl shadow-lg bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 min-w-[140px]"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Send size={20} />}
              {loading ? '解析中' : '快速存檔'}
            </button>
          </div>
        </Card>

        {/* 手動記帳入口 */}
        <Card className={`border-2 transition-all duration-300 ${manualOpen ? 'border-amber-400 shadow-2xl' : 'border-slate-200 shadow-sm'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${manualOpen ? 'bg-amber-100' : 'bg-slate-100'}`}>
                <PlusCircle size={24} className={manualOpen ? 'text-amber-600' : 'text-slate-500'} />
              </div>
              <div>
                <Title className="text-slate-800 text-lg">標準手動記帳</Title>
                <Text className="text-xs">如果您需要精確選擇類別，請點擊右側按鈕展開</Text>
              </div>
            </div>
            <button
              onClick={() => setManualOpen(o => !o)}
              className={`py-2 px-6 rounded-full font-bold transition-all border-2 ${
                manualOpen ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {manualOpen ? '收合介面' : '展開手動輸入'}
            </button>
          </div>

          {manualOpen && (
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-6 animate-in fade-in slide-in-from-top-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* 類型選擇 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">收支類型</label>
                  <div className="flex gap-4">
                    {['income', 'expense'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setManualForm(f => ({ ...f, type: t, category: t === 'income' ? '住宿' : '肥料' }))}
                        className={`flex-1 py-3 rounded-xl font-bold border-2 transition-all ${
                          manualForm.type === t 
                            ? (t === 'income' ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-rose-600 border-rose-600 text-white shadow-lg')
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                        }`}
                      >
                        {t === 'income' ? '＋ 收入' : '－ 支出'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 類別 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">項目類別</label>
                  <select
                    value={manualForm.category}
                    onChange={e => setManualForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full p-3 rounded-xl border-2 border-slate-200 bg-slate-50 font-bold focus:border-amber-400 focus:bg-white outline-none"
                  >
                    {manualForm.type === 'income' ? (
                      <>
                        <option value="住宿">🛌 住宿租金</option>
                        <option value="農產">🥦 農產銷售</option>
                        <option value="雜項">📦 其他收入</option>
                      </>
                    ) : (
                      <>
                        <option value="肥料">🌿 肥料採購</option>
                        <option value="薪資">👷 人工薪資</option>
                        <option value="水電">💡 水電支出</option>
                        <option value="維修">🔧 設備維修</option>
                        <option value="雜項">📦 其他雜項</option>
                      </>
                    )}
                  </select>
                </div>

                {/* 金額 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">交易金額 (NTD)</label>
                  <input
                    type="number"
                    placeholder="例如：3600"
                    value={manualForm.amount}
                    onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full p-3 rounded-xl border-2 border-slate-200 bg-slate-50 text-xl font-mono font-bold focus:border-amber-400 outline-none"
                  />
                </div>

                {/* 描述 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">細節說明</label>
                  <input
                    type="text"
                    placeholder="簡短紀錄這筆錢的用途..."
                    value={manualForm.description}
                    onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full p-3 rounded-xl border-2 border-slate-200 bg-slate-50 focus:border-amber-400 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setManualOpen(false)}
                  className="py-3 px-6 text-sm font-bold rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleManualAdd}
                  disabled={manualLoading}
                  className="py-3 px-10 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 shadow-lg flex items-center gap-2"
                >
                  {manualLoading ? '存檔中...' : '確認新增紀錄'}
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* 核心指標卡片 */}
        <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
          <Card decoration="top" decorationColor="emerald" className="bg-white shadow-lg">
            <Text className="text-slate-500 font-bold">總收入 (Revenue)</Text>
            <Metric className="text-emerald-700 font-black">${stats.income.toLocaleString()}</Metric>
            <BadgeDelta deltaType="moderateIncrease" className="mt-2">本月目標 80%</BadgeDelta>
          </Card>

          <Card decoration="top" decorationColor="rose" className="bg-white shadow-lg">
            <Text className="text-slate-500 font-bold">總支出 (Expenses)</Text>
            <Metric className="text-rose-600 font-black">${stats.expense.toLocaleString()}</Metric>
            <Text className="mt-2 text-xs font-medium text-rose-400 flex items-center gap-1">
              <AlertTriangle size={12}/> 目前有 {records.filter(r => r.type === 'expense').length} 筆支出紀錄
            </Text>
          </Card>

          <Card decoration="top" decorationColor="blue" className="bg-blue-50 shadow-lg">
            <Flex justifyContent="between">
              <Text className="text-blue-800 font-bold">目前淨利潤</Text>
              <BadgeDelta deltaType={stats.profitChange >= 0 ? "increase" : "decrease"}>
                {stats.profitChange.toFixed(1)}%
              </BadgeDelta>
            </Flex>
            <Metric className="text-blue-900 font-black">${stats.balance.toLocaleString()}</Metric>
            <ProgressBar value={stats.ratio} color={stats.ratio > 80 ? "rose" : "blue"} className="mt-4" />
            <Text className="text-[10px] mt-1 text-blue-700 text-right font-bold">收支比 {stats.ratio.toFixed(0)}%</Text>
          </Card>
        </Grid>

        {/* ✅ 修正一：BarChart/DonutChart colors 改用 Tremor 內建色彩名稱，不能用 HEX */}
        <Grid numItemsLg={2} className="gap-8">
          <Card className="bg-white shadow-lg">
            <Title className="text-slate-800 flex items-center gap-2">
              <TrendingUp className="text-emerald-600" /> 月度損益分佈
            </Title>
            <BarChart
              className="mt-6 h-72"
              data={barChartData}
              index="name"
              categories={["收入", "支出"]}
              colors={BAR_CHART_COLORS}
              valueFormatter={(value) => `$${value.toLocaleString()}`}
              yAxisWidth={80}
              showLegend={true}
              showGridLines={true}
              showAnimation={true}
            />
          </Card>

          <Card className="bg-white shadow-lg">
            <Title className="text-slate-800 flex items-center gap-2">
              <Wallet className="text-amber-600" /> 支出結構明細
            </Title>
            {donutChartData.length > 0 ? (
              <DonutChart
                className="mt-6 h-64"
                data={donutChartData}
                category="value"
                index="name"
                colors={DONUT_COLORS}
                valueFormatter={(value) => `$${value.toLocaleString()}`}
                showAnimation={true}
                showLabel={true}
              />
            ) : (
              <div className="mt-6 h-64 flex items-center justify-center text-slate-400 text-sm">
                尚無支出紀錄
              </div>
            )}
          </Card>
        </Grid>

        {/* AI 診斷報告 */}
        <Card className="bg-emerald-50 border-2 border-dashed border-emerald-300 p-6 shadow-inner">
          <Flex className="mb-4">
            <Title className="text-emerald-800 flex items-center gap-2">
              <ClipboardCheck /> 農場經營診斷報告
            </Title>
            <button
              onClick={generateDiagnosis}
              disabled={diagLoading}
              className="py-2 px-5 text-sm font-bold rounded-lg border-2 border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-100 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {diagLoading 
                ? <><div className="w-4 h-4 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin"></div> 分析中（自動重試）</>
                : '生成 AI 報告'
              }
            </button>
          </Flex>
          {diagnosis ? (
            <div className="bg-white p-6 rounded-2xl border border-emerald-100 text-emerald-900 leading-relaxed shadow-sm whitespace-pre-wrap">
              {diagnosis}
            </div>
          ) : (
            <div className="text-center py-6 text-emerald-600 italic">
              點擊按鈕，AI 將為您分析最近的經營數據
            </div>
          )}
        </Card>

        {/* 明細清單 */}
        <div className="space-y-4">
          <Title className="text-xl font-black text-slate-800 border-l-4 border-amber-500 pl-3">
            最近收支明細清單
          </Title>
          <Card className="p-0 overflow-hidden shadow-2xl border-none ring-1 ring-slate-200">
            <div className="divide-y divide-slate-100 bg-white">
              {records.map(r => (
                <div key={r.id} className="p-5 flex justify-between items-center hover:bg-slate-50 transition-colors">
                  {editingId === r.id ? (
                    <div className="flex gap-2 flex-1 items-center flex-wrap">
                      <input className="border-2 border-blue-500 p-2 rounded w-28 text-slate-800" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})}/>
                      <input className="border-2 border-blue-500 p-2 rounded flex-1 text-slate-800" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})}/>
                      <button onClick={saveEdit} className="py-2 px-4 bg-emerald-600 text-white rounded-lg font-bold">儲存</button>
                      <button onClick={() => setEditingId(null)} className="py-2 px-4 border border-slate-300 rounded-lg">取消</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-inner ${r.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {r.category === '住宿' ? '🏠' : (r.category === '農產' ? '🥦' : (r.category === '肥料' ? '🌿' : '⚙️'))}
                        </div>
                        <div>
                          <Text className="font-black text-slate-800 text-lg">{r.description}</Text>
                          <div className="flex gap-2 items-center">
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 text-slate-600 rounded">{r.category}</span>
                            <Text className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</Text>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <Text className={`font-black text-xl ${r.type === 'income' ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {r.type === 'income' ? '+' : '-'}${r.amount.toLocaleString()}
                        </Text>
                        <div className="flex gap-2">
                          <button onClick={() => startEdit(r)} className="text-slate-400 hover:text-emerald-600 p-2"><Edit3 size={18}/></button>
                          <button onClick={() => handleDelete(r.id)} className="text-slate-400 hover:text-rose-600 p-2"><Trash2 size={18}/></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {records.length === 0 && (
                <div className="py-16 text-center text-slate-400">目前尚無紀錄</div>
              )}
            </div>
          </Card>
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 w-full bg-emerald-900 text-white/60 py-2 text-center text-[10px] font-bold border-t border-emerald-800 z-50">
        農場財務雲端管理系統 | SECURE CLOUD STORAGE
      </footer>
    </div>
  );
}
