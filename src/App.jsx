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

// 4.3 離線持久化機制 (企劃書需求)
try {
  enableIndexedDbPersistence(db);
} catch (err) {
  console.log("離線模式已在其他分頁啟動或不支援");
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

  // 1. 系統啟動與匿名驗證 (企劃書 5.1)
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
      // 支援日期降序排列 (企劃書 4.3)[cite: 1]
      const q = query(collection(db, `users/${userCredential.user.uid}/records`), orderBy("createdAt", "desc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const recordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRecords(recordsData);
      });
      return () => unsubscribe();
    }).catch(console.error);
  }, []);

  // 2. AI 語意記帳 (NLP Parsing) (企劃書 4.1.1)[cite: 1]
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `你現在是農場財務助理。分析語句並回傳純 JSON。
      類別：住宿、農產、肥料、薪資、水電、維修、雜項。
      語句：「${aiInput}」
      格式：{"type": "income"或"expense", "amount": 數字, "category": "上述類別", "description": "內容摘要"}`;
      
      const result = await model.generateContent(prompt);
      // 修正後的第 71 行：確保 Regex 在同一行且不被斷開
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

  // 3. AI 經營診斷報告 (企劃書 4.1.2)[cite: 1]
  const generateDiagnosis = async () => {
    if (records.length === 0) return alert("尚無數據可分析");
    setDiagLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const history = records.slice(0, 15).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是經營顧問，分析這些農場帳目並提供經營策略建議(含支出異常預警)：${history}`;
      const result = await model.generateContent(prompt);
      setDiagnosis(result.response.text());
    } catch (e) {
      setDiagnosis("診斷報告生成失敗，請檢查網路連線。");
    }
    setDiagLoading(false);
  };

  // 4. 數據運算 - 核心指標 (企劃書 4.2.1)[cite: 1]
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth());
    const prevMonth = records.filter(r => new Date(r.createdAt).getMonth() === now.getMonth() - 1);

    const income = currentMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = currentMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const prevIncome = prevMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const prevExpense = prevMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    
    const profit = income - expense;
    const prevProfit = prevIncome - prevExpense;
    const profitChange = prevProfit !== 0 ? ((profit - prevProfit) / Math.abs(prevProfit)) * 100 : 0;
    const ratio = income > 0 ? (expense / income) * 100 : 0;
    
    return { income, expense, balance: profit, ratio, profitChange };
  }, [records]);

  // 5. CRUD 基礎管理 (企劃書 4.3)[cite: 1]
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => {
    if (window.confirm("確定刪除此筆紀錄？")) await deleteDoc(doc(db, `users/${userId}/records`, id));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* 導航標頭 - 高對比度優化 */}
      <header className="bg-emerald-800 text-white p-6 shadow-xl border-b-4 border-amber-500">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Flex justifyContent="start" className="gap-3">
            <div className="bg-white p-2 rounded-lg">
              <Leaf className="text-emerald-800" size={28} />
            </div>
            <div>
              <Title className="text-white text-2xl font-black">農場民宿收支系統</Title>
              <Text className="text-emerald-200">B11256029 李仲琨 | 專業財務管理</Text>
            </div>
          </Flex>
          <div className="hidden sm:block text-right">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></span>
              <Text className="text-emerald-300 text-xs font-bold uppercase tracking-widest">Cloud Sync</Text>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-8">
        
        {/* AI 智慧功能入口 */}
        <Card className="bg-white border-2 border-emerald-100 shadow-xl ring-4 ring-emerald-500/5">
          <Title className="text-emerald-900 mb-4 flex items-center gap-2 font-bold">
            <Send size={20} className="text-emerald-600" /> AI 語意快速記帳
          </Title>
          <div className="flex flex-col sm:flex-row gap-4">
            <input 
              className="flex-1 p-4 bg-slate-100 border-2 border-slate-200 rounded-xl text-lg focus:border-emerald-500 outline-none transition-all text-slate-800"
              placeholder="輸入如：今天賣出三間雙人房共 6000 元"
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleAIParse()}
            />
            <Button 
              className="py-4 px-8 text-lg font-bold shadow-lg" 
              color="emerald" 
              onClick={handleAIParse} 
              loading={loading}
            >
              解析存檔
            </Button>
          </div>
        </Card>

        {/* 4.2.1 核心指標看板 */}
        <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
          <Card decoration="top" decorationColor="emerald" className="bg-white shadow-lg border-none">
            <Text className="text-slate-500 font-bold uppercase text-xs tracking-wider">總收入 (住宿/農產)</Text>
            <Metric className="text-emerald-700 font-black">${stats.income.toLocaleString()}</Metric>
            <BadgeDelta deltaType="moderateIncrease" className="mt-2">目標達成率 85%</BadgeDelta>
          </Card>

          <Card decoration="top" decorationColor="rose" className="bg-white shadow-lg border-none">
            <Text className="text-slate-500 font-bold uppercase text-xs tracking-wider">總支出</Text>
            <Metric className="text-rose-600 font-black">${stats.expense.toLocaleString()}</Metric>
            <Flex className="mt-2" justifyContent="start">
              <AlertTriangle size={14} className="text-rose-400 mr-1" />
              <Text className="text-xs font-medium text-rose-400">類別筆數：{records.filter(r => r.type === 'expense').length}</Text>
            </Flex>
          </Card>

          <Card decoration="top" decorationColor="blue" className="bg-blue-50 shadow-lg border-none">
            <Flex justifyContent="between">
              <Text className="text-blue-800 font-bold uppercase text-xs tracking-wider">目前結餘</Text>
              <BadgeDelta deltaType={stats.profitChange >= 0 ? "increase" : "decrease"}>
                {stats.profitChange.toFixed(1)}%
              </BadgeDelta>
            </Flex>
            <Metric className="text-blue-900 font-black">${stats.balance.toLocaleString()}</Metric>
            <ProgressBar value={stats.ratio} color={stats.ratio > 80 ? "rose" : "blue"} className="mt-4" />
          </Card>
        </Grid>

        {/* 4.2.2 動態報表圖表 */}
        <Grid numItemsLg={2} className="gap-8">
          <Card className="bg-white shadow-lg border-none">
            <Title className="text-slate-800 flex items-center gap-2 font-bold">
              <TrendingUp className="text-emerald-600" /> 月損益趨勢
            </Title>
            <BarChart
              className="mt-6 h-72"
              data={[{name: '當月', '收入': stats.income, '支出': stats.expense}]}
              index="name"
              categories={["收入", "支出"]}
              colors={["emerald", "rose"]}
              yAxisWidth={60}
            />
          </Card>

          <Card className="bg-white shadow-lg border-none">
            <Title className="text-slate-800 flex items-center gap-2 font-bold">
              <Wallet className="text-amber-600" /> 支出結構分析
            </Title>
            <DonutChart
              className="mt-6 h-72"
              data={records.filter(r => r.type === 'expense').reduce((acc, curr) => {
                const ex = acc.find(i => i.name === curr.category);
                if (ex) ex.value += curr.amount; else acc.push({name: curr.category, value: curr.amount});
                return acc;
              }, [])}
              category="value"
              index="name"
              colors={["emerald", "amber", "rose", "blue", "indigo"]}
              variant="pie"
            />
          </Card>
        </Grid>

        {/* 4.1.2 AI 經營診斷 */}
        <Card className="bg-emerald-50 border-2 border-dashed border-emerald-300 p-8 shadow-inner rounded-2xl">
          <Flex className="mb-4">
            <Title className="text-emerald-800 flex items-center gap-2 font-black">
              <ClipboardCheck /> AI 智慧經營診斷報告
            </Title>
            <Button variant="secondary" color="emerald" onClick={generateDiagnosis} loading={diagLoading} className="font-bold">
              重新診斷
            </Button>
          </Flex>
          {diagnosis ? (
            <div className="bg-white p-6 rounded-xl border border-emerald-100 text-emerald-900 leading-relaxed shadow-sm whitespace-pre-wrap font-medium">
              {diagnosis}
            </div>
          ) : (
            <div className="text-center py-10 italic text-emerald-600">
              點擊上方按鈕，AI 將分析您的損益數據並提供經營建議
            </div>
          )}
        </Card>

        {/* 4.3 基礎管理 - 明細清單 */}
        <div className="space-y-4">
          <Title className="text-xl font-black text-slate-800 border-l-4 border-amber-500 pl-3">
            最近收支明細清單
          </Title>
          <Card className="p-0 overflow-hidden shadow-2xl border-none rounded-xl">
            <div className="divide-y divide-slate-100 bg-white">
              {records.map(r => (
                <div key={r.id} className="p-5 flex justify-between items-center hover:bg-slate-50 transition-colors group">
                  {editingId === r.id ? (
                    <div className="flex gap-2 flex-1 items-center">
                      <input className="border-2 border-emerald-500 p-2 rounded-lg w-28 font-bold" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})} />
                      <input className="border-2 border-emerald-500 p-2 rounded-lg flex-1" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                      <Button size="xs" onClick={saveEdit} color="emerald">儲存</Button>
                      <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>取消</Button>
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
                            <span className="text-[10px] font-black px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full uppercase">{r.category}</span>
                            <Text className="text-xs text-slate-400 font-bold">{new Date(r.createdAt).toLocaleDateString()}</Text>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <Text className={`font-black text-xl ${r.type === 'income' ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {r.type === 'income' ? '+' : '-'}${r.amount.toLocaleString()}
                        </Text>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(r)} className="text-slate-300 hover:text-emerald-600 p-2 hover:bg-emerald-50 rounded-lg transition-all"><Edit3 size={18}/></button>
                          <button onClick={() => handleDelete(r.id)} className="text-slate-300 hover:text-rose-600 p-2 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={18}/></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 w-full bg-emerald-900 text-white/80 py-3 text-center text-[10px] font-black tracking-widest uppercase border-t border-amber-500 z-50 shadow-2xl">
        農場財務管理系統 | B11256029 李仲琨 | 離線存取已就緒
      </footer>
    </div>
  );
}
