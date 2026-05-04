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

import { Send, Trash2, Edit3, ClipboardCheck, LayoutDashboard, Leaf, AlertTriangle, TrendingUp, Wallet } from 'lucide-react';



// 初始化離線持久化機制 (企劃書 4.3)
try {
  enableIndexedDbPersistence(db);
} catch (err) {
  console.log("離線模式已在其他分頁啟動");
}



const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);



export default function App() {
  const [records, setRecords] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagLoading, setDiagLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: 0, category: '', description: '', type: 'income' });



  // 1. 系統啟動與身份驗證 (企劃書 5.1)
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
      // 支援日期降序排列 (企劃書 4.3)
      const q = query(collection(db, `users/${userCredential.user.uid}/records`), orderBy("createdAt", "desc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const recordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRecords(recordsData);
      });
      return () => unsubscribe();
    }).catch(console.error);
  }, []);



  // 2. AI 語意記帳 (NLP Parsing) (企劃書 4.1.1)
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `你現在是農場財務助理。分析語句並回傳純 JSON。
      類別：住宿、農產、肥料、薪資、水電、維修、雜項。
      語句：「${aiInput}」
      格式：{"type": "income"或"expense", "amount": 數字, "category": "上述類別", "description": "內容摘要"}`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/```json|```/g, '').trim();
      const data = JSON.parse(text);
      
      await addDoc(collection(db, `users/${userId}/records`), {
        ...data,
        createdAt: new Date().toISOString()
      });
      setAiInput('');
    } catch (e) {
      alert("AI 解析失敗，請嘗試更清楚的描述，例如：賣出農產500元");
    }
    setLoading(false);
  };



  // 3. AI 經營診斷報告 (企劃書 4.1.2)
  const generateDiagnosis = async () => {
    if (records.length === 0) return alert("尚無數據可分析");
    setDiagLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const history = records.slice(0, 15).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是經營顧問，分析這些農場帳目並提供經營策略建議(含支出異常預警)：${history}`;
      const result = await model.generateContent(prompt);
      setDiagnosis(result.response.text());
    } catch (e) {
      setDiagnosis("診斷報告生成失敗，請檢查網路連線。");
    }
    setDiagLoading(false);
  };



  // 4. 數據運算 - 核心指標看板 (企劃書 4.2.1)
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth());
    const prevMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth() - 1);

    const income = currentMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = currentMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const prevIncome = prevMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    
    // 計算淨利潤百分比變化
    const profit = income - expense;
    const prevProfit = prevIncome - prevMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const profitChange = prevProfit !== 0 ? ((profit - prevProfit) / Math.abs(prevProfit)) * 100 : 0;

    const ratio = income > 0 ? (expense / income) * 100 : 0;
    
    return { income, expense, balance: profit, ratio, profitChange };
  }, [records]);



  // 5. CRUD 基礎管理 (企劃書 4.3)
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => {
    if (confirm("確定刪除此筆紀錄？")) await deleteDoc(doc(db, `users/${userId}/records`, id));
  };



  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-10">

      {/* 導航標頭 - 高對比深色背景 */}
      <header className="bg-emerald-900 text-white p-6 shadow-2xl border-b-4 border-amber-500">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Flex justifyContent="start" className="gap-3">
            <div className="bg-white p-2 rounded-lg">
              <Leaf className="text-emerald-800" size={28} />
            </div>
            <div>
              <Title className="text-white text-2xl font-black">農場民宿收支系統</Title>
              <Text className="text-emerald-200">專業財務管理</Text>
            </div>
          </Flex>
          <div className="text-right hidden sm:block">
            <Text className="text-emerald-300 text-xs font-bold uppercase">雲端同步中</Text>
            <div className="w-3 h-3 bg-green-400 rounded-full ml-auto mt-1 animate-pulse"></div>
          </div>
        </div>
      </header>



      <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-8">
        
        {/* 4.1 AI 智慧功能入口 */}
        <Card className="bg-white border-2 border-emerald-100 shadow-xl ring-4 ring-emerald-500/5">
          <Title className="text-emerald-900 mb-4 flex items-center gap-2">
            <Send size={20} className="text-emerald-600" /> AI 語意快速記帳
          </Title>
          <div className="flex flex-col sm:flex-row gap-4">
            <input 
              className="flex-1 p-4 bg-slate-100 border-2 border-slate-200 rounded-xl text-lg focus:border-emerald-500 outline-none transition-all placeholder:text-slate-400 text-slate-800"
              placeholder="輸入如：今天賣出三間雙人房共 6000 元"
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleAIParse()}
            />
            {/* ── 修正：改用原生 button，確保文字可見 ── */}
            <button
              onClick={handleAIParse}
              disabled={loading}
              className="py-4 px-8 text-lg font-bold rounded-lg shadow-lg bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 min-w-[120px]"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                  </svg>
                  解析中
                </>
              ) : '解析存檔'}
            </button>
          </div>
        </Card>



        {/* 4.2.1 核心指標看板 (KPI Cards) */}
        <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
          <Card decoration="top" decorationColor="emerald" className="bg-white shadow-lg">
            <Text className="text-slate-500 font-bold">總收入 (住宿/農產)</Text>
            <Metric className="text-emerald-700 font-black">${stats.income.toLocaleString()}</Metric>
            <BadgeDelta deltaType="moderateIncrease" className="mt-2">本月目標 80%</BadgeDelta>
          </Card>

          <Card decoration="top" decorationColor="rose" className="bg-white shadow-lg">
            <Text className="text-slate-500 font-bold">總支出</Text>
            <Metric className="text-rose-600 font-black">${stats.expense.toLocaleString()}</Metric>
            <Text className="mt-2 text-xs font-medium text-rose-400 flex items-center gap-1">
              <AlertTriangle size={12}/> 支出類別：{records.filter(r => r.type === 'expense').length} 筆
            </Text>
          </Card>

          <Card decoration="top" decorationColor="blue" className="bg-blue-50 shadow-lg">
            <Flex justifyContent="between">
              <Text className="text-blue-800 font-bold">目前結餘 (Net Profit)</Text>
              <BadgeDelta deltaType={stats.profitChange >= 0 ? "increase" : "decrease"}>
                {stats.profitChange.toFixed(1)}%
              </BadgeDelta>
            </Flex>
            <Metric className="text-blue-900 font-black">${stats.balance.toLocaleString()}</Metric>
            <Flex className="mt-4">
              <Text className="text-xs font-bold text-blue-700">收支比預警</Text>
              <Text className="text-xs font-bold text-blue-900">{stats.ratio.toFixed(0)}%</Text>
            </Flex>
            <ProgressBar value={stats.ratio} color={stats.ratio > 80 ? "rose" : "blue"} className="mt-2" />
          </Card>
        </Grid>



        {/* 4.2.2 動態報表系統 (Bar & Donut Charts) */}
        <Grid numItemsLg={2} className="gap-8">
          <Card className="bg-white shadow-lg">
            <Title className="text-slate-800 flex items-center gap-2">
              <TrendingUp className="text-emerald-600" /> 月損益趨勢圖
            </Title>
            <BarChart
              className="mt-6 h-72"
              data={[{name: '本月數據', '收入': stats.income, '支出': stats.expense}]}
              index="name"
              categories={["收入", "支出"]}
              colors={["emerald", "rose"]}
              yAxisWidth={60}
            />
          </Card>

          <Card className="bg-white shadow-lg text-center flex flex-col items-center justify-center">
            <Title className="text-slate-800 self-start flex items-center gap-2">
              <Wallet className="text-amber-600" /> 支出結構分析
            </Title>
            <DonutChart
              className="mt-6 h-64"
              data={records.filter(r => r.type === 'expense').reduce((acc, curr) => {
                const ex = acc.find(i => i.name === curr.category);
                if (ex) ex.value += curr.amount; else acc.push({name: curr.category, value: curr.amount});
                return acc;
              }, [])}
              category="value"
              index="name"
              colors={["emerald", "amber", "rose", "blue", "yellow"]}
              variant="pie"
            />
          </Card>
        </Grid>



        {/* 4.1.2 AI 經營診斷報告 */}
        <Card className="bg-emerald-50 border-2 border-dashed border-emerald-300 p-8 shadow-inner">
          <Flex className="mb-4">
            <Title className="text-emerald-800 flex items-center gap-2">
              <ClipboardCheck /> AI 智慧經營診斷
            </Title>
            {/* ── 修正：次要按鈕改用有明確邊框與文字色的樣式 ── */}
            <button
              onClick={generateDiagnosis}
              disabled={diagLoading}
              className="py-2 px-5 text-sm font-bold rounded-lg border-2 border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {diagLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-emerald-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                  </svg>
                  生成中
                </>
              ) : '重新生成報告'}
            </button>
          </Flex>
          {diagnosis ? (
            <div className="bg-white p-6 rounded-2xl border-2 border-emerald-100 text-emerald-900 leading-relaxed shadow-sm font-medium whitespace-pre-wrap">
              {diagnosis}
            </div>
          ) : (
            <div className="text-center py-10">
              <Text className="text-emerald-600 italic">點擊上方按鈕，AI 將分析您的損益數據並提供經營建議</Text>
            </div>
          )}
        </Card>



        {/* 4.3 基礎管理 - 詳細清單 (CRUD) */}
        <div className="space-y-4">
          <Title className="text-xl font-black text-slate-800 border-l-4 border-amber-500 pl-3">
            最近收支明細清單
          </Title>
          <Card className="p-0 overflow-hidden shadow-2xl border-none">
            <div className="divide-y-2 divide-slate-100 bg-white">
              {records.map(r => (
                <div key={r.id} className="p-5 flex justify-between items-center hover:bg-slate-50 transition-colors">
                  {editingId === r.id ? (
                    <div className="flex gap-2 flex-1 items-center flex-wrap">
                      <input
                        className="border-2 border-blue-500 p-2 rounded w-28 text-slate-800 bg-white focus:outline-none"
                        type="number"
                        value={editForm.amount}
                        onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})}
                      />
                      <input
                        className="border-2 border-blue-500 p-2 rounded flex-1 text-slate-800 bg-white focus:outline-none min-w-[120px]"
                        value={editForm.description}
                        onChange={e => setEditForm({...editForm, description: e.target.value})}
                      />
                      {/* ── 修正：編輯列「儲存」按鈕 ── */}
                      <button
                        onClick={saveEdit}
                        className="py-2 px-4 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
                      >
                        儲存
                      </button>
                      {/* ── 修正：編輯列「取消」按鈕 ── */}
                      <button
                        onClick={() => setEditingId(null)}
                        className="py-2 px-4 text-sm font-bold rounded-lg border-2 border-slate-400 bg-white text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-inner ${r.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {r.category === '住宿' ? '🛌' : (r.category === '農產' ? '🥦' : '⚙️')}
                        </div>
                        <div>
                          <Text className="font-black text-slate-800 text-lg">{r.description}</Text>
                          <div className="flex gap-2 items-center">
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 text-slate-600 rounded uppercase">{r.category}</span>
                            <Text className="text-xs text-slate-400 font-medium">{new Date(r.createdAt).toLocaleDateString()}</Text>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <Text className={`font-black text-xl ${r.type === 'income' ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {r.type === 'income' ? '+' : '-'}${r.amount.toLocaleString()}
                        </Text>
                        <div className="flex gap-2">
                          <button onClick={() => startEdit(r)} className="text-slate-400 hover:text-emerald-600 p-2 hover:bg-emerald-50 rounded-lg transition-all"><Edit3 size={18}/></button>
                          <button onClick={() => handleDelete(r.id)} className="text-slate-400 hover:text-rose-600 p-2 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={18}/></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {records.length === 0 && (
                <div className="py-16 text-center">
                  <Text className="text-slate-400 text-base">尚無收支紀錄，請使用上方 AI 快速記帳</Text>
                </div>
              )}
            </div>
          </Card>
        </div>

      </main>



      {/* 底部導航提示 */}
      <footer className="fixed bottom-0 left-0 w-full bg-emerald-900 text-white/60 py-2 text-center text-[10px] font-bold tracking-widest uppercase border-t border-emerald-800 z-50">
        農場財務雲端管理系統 | 離線存取已就緒
      </footer>

    </div>
  );
}
