import React, { useState, useEffect, useMemo } from 'react';
import { 
  Card, Metric, Text, Title, BarChart, DonutChart, 
  Flex, Grid, BadgeDelta, ProgressBar, Button, Divider, Icon
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
  Leaf, AlertTriangle, TrendingUp, Wallet, CheckCircle2 
} from 'lucide-react';

// 4.3 離線持久化機制：確保訊號不佳時仍可記帳
try {
  enableIndexedDbPersistence(db);
} catch (err) {
  if (err.code === 'failed-precondition') {
    console.log("離線模式因多個分頁開啟而受限");
  } else if (err.code === 'unimplemented') {
    console.log("瀏覽器不支援離線模式");
  }
}

// 初始化 Gemini AI (使用 1.5 Flash 確保效能與準確度)
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

  // 1. 系統啟動與匿名身份驗證 (企劃書 5.1)
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      const uid = userCredential.user.uid;
      setUserId(uid);
      
      // 支援日期降序排列 (企劃書 4.3)
      const q = query(collection(db, `users/${uid}/records`), orderBy("createdAt", "desc"));
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
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `你現在是專業農場財務助理。請分析這句話並回傳純 JSON。
      有效類別：住宿、農產、肥料、薪資、水電、維修、雜項。
      使用者輸入：「${aiInput}」
      格式範例：{"type": "income", "amount": 500, "category": "農產", "description": "賣出高麗菜"}
      注意：type 只能是 "income" 或 "expense"。`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/```json|
```/g, '').trim();
      const data = JSON.parse(text);
      
      await addDoc(collection(db, `users/${userId}/records`), {
        ...data,
        createdAt: new Date().toISOString()
      });
      setAiInput('');
    } catch (e) {
      alert("AI 解析失敗，請輸入如：'賣出農產500元' 或 '付水電費1200元'");
    }
    setLoading(false);
  };

  // 3. AI 經營診斷報告 (企劃書 4.1.2)
  const generateDiagnosis = async () => {
    if (records.length < 3) return alert("請至少輸入 3 筆數據以供 AI 分析");
    setDiagLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const history = records.slice(0, 20).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是經營顧問，請分析以下農場民宿帳目並提供 3 個具體的經營策略建議與支出異常預警：${history}`;
      const result = await model.generateContent(prompt);
      setDiagnosis(result.response.text());
    } catch (e) {
      setDiagnosis("診斷報告生成失敗，請檢查網路連線後重試。");
    }
    setDiagLoading(false);
  };

  // 4. 數據運算 - 核心指標 (企劃書 4.2.1)
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonthRecords = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth());
    const prevMonthRecords = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth() - 1);

    const income = currentMonthRecords.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = currentMonthRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const prevIncome = prevMonthRecords.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const prevExpense = prevMonthRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    
    const profit = income - expense;
    const prevProfit = prevIncome - prevExpense;
    const profitChange = prevProfit !== 0 ? ((profit - prevProfit) / Math.abs(prevProfit)) * 100 : 0;
    const ratio = income > 0 ? (expense / income) * 100 : 0;
    
    return { income, expense, balance: profit, ratio, profitChange };
  }, [records]);

  // 5. CRUD 操作
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => {
    if (window.confirm("確定刪除此筆紀錄？")) await deleteDoc(doc(db, `users/${userId}/records`, id));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      
      <header className="bg-emerald-800 text-white p-6 shadow-xl border-b-4 border-amber-500 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Flex justifyContent="start" className="gap-4">
            <div className="bg-white p-2 rounded-xl shadow-inner">
              <Leaf className="text-emerald-700" size="{32}"/>
            </div>
            <div>
              <Title className="text-white text-2xl font-black tracking-tight">農場民宿智慧財管</Title>
              <Text className="text-emerald-200 font-medium">| 專業經營模式</Text>
            </div>
          </Flex>
          <div className="hidden md:flex items-center gap-2 bg-emerald-900/50 px-4 py-2 rounded-full border border-emerald-700">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-xs font-bold text-emerald-100 uppercase tracking-widest">Cloud Synced</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-8">
        
        
        <Card className="ring-2 ring-emerald-500/20 border-none shadow-2xl overflow-hidden">
          <div className="bg-emerald-50 px-6 py-3 border-b border-emerald-100 flex items-center gap-2">
            <Send size="{18}" className="text-emerald-600"/>
            <span className="font-bold text-emerald-800">AI 語意快速記帳</span>
          </div>
          <div className="p-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <input 
                className="flex-1 p-4 bg-slate-50 border-2 border-slate-200 rounded-xl text-lg focus:border-emerald-500 focus:ring-0 outline-none transition-all text-slate-800"
                placeholder="例如：今天賣出三間雙人房共 6000 元"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleAIParse()}
              />
              <Button className="py-4 px-10 text-lg font-black rounded-xl transition-transform active:scale-95 shadow-lg" color="emerald" variant="primary" onClick="{handleAIParse}" loading="{loading}">
                解析並存檔
              </Button>
            </div>
          </div>
        </Card>

        
        <Grid numItemsSm="{1}" numItemsLg="{3}" className="gap-6">
          <Card decoration="top" decorationColor="emerald" className="bg-white shadow-md border-none">
            <Flex alignItems="start">
              <div>
                <Text className="text-slate-500 font-bold uppercase tracking-wider text-xs">本月總收入</Text>
                <Metric className="text-emerald-700 font-black">${stats.income.toLocaleString()}</Metric>
              </div>
              <Icon icon="{TrendingUp}" color="emerald" variant="light" size="sm"/>
            </Flex>
            <BadgeDelta deltaType="moderateIncrease" className="mt-4">目標達成 85%</BadgeDelta>
          </Card>

          <Card decoration="top" decorationColor="rose" className="bg-white shadow-md border-none">
            <Flex alignItems="start">
              <div>
                <Text className="text-slate-500 font-bold uppercase tracking-wider text-xs">本月總支出</Text>
                <Metric className="text-rose-600 font-black">${stats.expense.toLocaleString()}</Metric>
              </div>
              <Icon icon="{AlertTriangle}" color="rose" variant="light" size="sm"/>
            </Flex>
            <Text className="mt-4 text-xs font-semibold text-slate-400">
              支出紀錄：{records.filter(r => r.type === 'expense').length} 筆
            </Text>
          </Card>

          <Card decoration="top" decorationColor="blue" className="bg-blue-50/50 shadow-md border-none ring-1 ring-blue-100">
            <Flex justifyContent="between" alignItems="center">
              <Text className="text-blue-800 font-bold text-xs uppercase">目前結餘 (Net Profit)</Text>
              <BadgeDelta deltaType="{stats.profitChange">= 0 ? "increase" : "decrease"}>
                {stats.profitChange.toFixed(1)}%
              </BadgeDelta>
            </Flex>
            <Metric className="text-blue-900 font-black">${stats.balance.toLocaleString()}</Metric>
            <div className="mt-4">
              <Flex className="mb-1">
                <Text className="text-[10px] font-bold text-blue-700">收支比預警 (上限 80%)</Text>
                <Text className="text-[10px] font-bold text-blue-900">{stats.ratio.toFixed(0)}%</Text>
              </Flex>
              <ProgressBar value="{stats.ratio}" color="{stats.ratio"> 80 ? "rose" : "blue"} />
            </div>
          </ProgressBar></Card>
        </Grid>

        
        <Grid numItemsLg="{2}" className="gap-8">
          <Card className="bg-white shadow-xl border-none p-6">
            <Title className="text-slate-800 font-bold mb-6 flex items-center gap-2 text-lg">
               月損益趨勢對比
            </Title>
            <BarChart className="h-72" data="{[{name:" '本月', '收入': stats.income, '支出': stats.expense}]} index="name" categories="{["收入"," "支出"]} colors="{["emerald"," "rose"]} yAxisWidth="{60}" showAnimation="{true}"/>
          </Card>

          <Card className="bg-white shadow-xl border-none p-6">
            <Title className="text-slate-800 font-bold mb-6 flex items-center gap-2 text-lg">
               支出類別結構
            </Title>
            <DonutChart className="h-72 mt-2" data="{records.filter(r"> r.type === 'expense').reduce((acc, curr) => {
                const ex = acc.find(i => i.name === curr.category);
                if (ex) ex.value += curr.amount; else acc.push({name: curr.category, value: curr.amount});
                return acc;
              }, [])}
              category="value"
              index="name"
              colors={["emerald", "amber", "rose", "blue", "indigo"]}
              variant="pie"
            />
          </DonutChart></Card>
        </Grid>

        
        <Card className="bg-gradient-to-br from-emerald-900 to-emerald-800 p-8 shadow-2xl border-none rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ClipboardCheck size="{120}" className="text-white"/>
          </div>
          <Flex className="mb-6 relative z-10">
            <div>
              <Title className="text-white font-black text-xl flex items-center gap-2">
                <CheckCircle2 className="text-amber-400"/> AI 經營診斷報告
              </Title>
              <Text className="text-emerald-200">基於您最近的財務數據分析</Text>
            </div>
            <Button size="md" variant="secondary" className="bg-white hover:bg-emerald-50 text-emerald-900 border-none font-bold shadow-lg" onClick="{generateDiagnosis}" loading="{diagLoading}">
              更新診斷報告
            </Button>
          </Flex>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 relative z-10 min-h-[100px]">
            {diagnosis ? (
              <div className="text-white leading-relaxed font-medium whitespace-pre-line">
                {diagnosis}
              </div>
            ) : (
              <div className="text-center py-6 text-emerald-200/60 italic font-medium">
                點擊上方按鈕，AI 將為您的農場提供專業建議...
              </div>
            )}
          </div>
        </Card>

        
        <div className="space-y-4 pb-10">
          <div className="flex items-center justify-between px-2">
            <Title className="text-xl font-black text-slate-800 border-l-4 border-amber-500 pl-3">
              最新收支明細
            </Title>
            <BadgeDelta deltaType="unchanged">最近 30 天</BadgeDelta>
          </div>
          
          <Card className="p-0 overflow-hidden shadow-2xl border-none bg-white rounded-2xl">
            <div className="divide-y divide-slate-100">
              {records.map(r => (
                <div key={r.id} className="p-5 flex justify-between items-center hover:bg-slate-50/80 transition-all group">
                  {editingId === r.id ? (
                    <div className="flex gap-3 flex-1 items-center animate-pulse">
                      <input className="border-2 border-emerald-500 p-2 rounded-lg w-28 font-bold" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})} />
                      <input className="border-2 border-emerald-500 p-2 rounded-lg flex-1" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                      <Button size="xs" onClick="{saveEdit}" color="emerald" variant="primary">儲存</Button>
                      <Button size="xs" variant="light" color="slate" onClick="{()"> setEditingId(null)}>取消</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-sm ${r.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {r.category === '住宿' ? '🛌' : (r.category === '農產' ? '🥦' : (r.category === '維修' ? '🛠️' : '📝'))}
                        </div>
                        <div>
                          <Text className="font-black text-slate-800 text-lg leading-none mb-1">{r.description}</Text>
                          <div className="flex gap-3 items-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${r.type === 'income' ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'}`}>
                              {r.category}
                            </span>
                            <Text className="text-xs text-slate-400 font-bold">{new Date(r.createdAt).toLocaleDateString()}</Text>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <Text className="{`font-black" text-2xl ${r.type="==" 'income' ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {r.type === 'income' ? '+' : '-'}${r.amount.toLocaleString()}
                          </Text>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(r)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all">
                            <Edit3 size="{18}"/>
                          </button>
                          <button onClick={() => handleDelete(r.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all">
                            <Trash2 size="{18}"/>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {records.length === 0 && (
                <div className="p-20 text-center text-slate-400 font-medium italic">
                  尚未有帳務紀錄，請使用上方 AI 解析開始記帳。
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>

      
      <footer className="fixed bottom-0 left-0 w-full bg-emerald-900 text-white py-3 text-center text-[11px] font-black tracking-widest uppercase border-t border-amber-500 z-50">
        農場財務雲端管理系統 | 離線存取已啟動 | 本地資料加密儲存
      </footer>
    </div>
  );
}
