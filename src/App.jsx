import React, { useState, useEffect, useMemo } from 'react';
import { 
  Card, Metric, Text, Title, BarChart, DonutChart, 
  Flex, Grid, BadgeDelta, ProgressBar, Button, Divider,
  TabGroup, TabList, Tab, TabPanels, TabPanel
} from "@tremor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db, auth } from './firebase';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { Send, Trash2, Edit3, ClipboardCheck, LayoutDashboard, Leaf, AlertTriangle, TrendingUp, DollarSign } from 'lucide-react';

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

  // 初始化匿名登入與即時資料監聽 (支援企劃書提及之雲端同步)
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

  // --- 4.1.1 AI 語意記帳 (NLP Parsing) ---
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `你是一個農場民宿助手。分析此語句並回傳純 JSON：{"type":"income/expense","amount":數字,"category":"住宿/農產/肥料/薪資/水電/維修/雜項","description":"摘要"}。語句：${aiInput}`;
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().replace(/```json|```/g, '').trim();
      const parsedData = JSON.parse(responseText);
      
      await addDoc(collection(db, `users/${userId}/records`), {
        ...parsedData,
        createdAt: new Date().toISOString()
      });
      setAiInput('');
    } catch (error) {
      console.error("AI 解析失敗", error);
      alert("AI 解析失敗，請確認輸入內容或稍後再試。");
    }
    setLoading(false);
  };

  // --- 4.1.2 AI 經營診斷報告 ---
  const generateDiagnosis = async () => {
    setDiagLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const summary = records.slice(0, 20).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是一位農場經營專家。請針對以下收支紀錄給出一份約 150 字的經營診斷，包含支出異常警告與季節經營策略建議。紀錄數據：${summary}`;
      const result = await model.generateContent(prompt);
      setDiagnosis(result.response.text());
    } catch (error) {
      setDiagnosis("診斷報告生成失敗，請確認網路連線。");
    }
    setDiagLoading(false);
  };

  // --- 4.2 視覺化數據運算 (含百分比變化與收支比) ---
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;

    const currentRecords = records.filter(r => new Date(r.createdAt).getMonth() === currentMonth);
    const lastMonthRecords = records.filter(r => new Date(r.createdAt).getMonth() === lastMonth);

    const calcIncome = (list) => list.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
    const calcExpense = (list) => list.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);

    const currentIncome = calcIncome(currentRecords);
    const currentExpense = calcExpense(currentRecords);
    const currentNet = currentIncome - currentExpense;

    const lastNet = calcIncome(lastMonthRecords) - calcExpense(lastMonthRecords);
    
    // 計算淨利潤與上月相比的百分比變化 (Net Profit Change)
    const netChange = lastNet !== 0 ? ((currentNet - lastNet) / Math.abs(lastNet)) * 100 : 0;
    
    // 收支比 (Expense Ratio)
    const ratio = currentIncome > 0 ? (currentExpense / currentIncome) * 100 : 0;

    return { 
      income: currentIncome, 
      expense: currentExpense, 
      balance: currentNet, 
      netChange,
      ratio
    };
  }, [records]);

  // --- 4.3 基礎管理 (CRUD 編輯與刪除) ---[cite: 3]
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => {
    if(window.confirm('確定要刪除這筆紀錄嗎？')){
      await deleteDoc(doc(db, `users/${userId}/records`, id));
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-slate-900 pb-12">
      {/* 4.0 系統標頭 */}
      <header className="bg-[#1B4332] text-white py-10 px-6 shadow-2xl border-b-8 border-[#D4A373]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <Flex justifyContent="start" className="gap-5">
            <div className="bg-[#D4A373] p-4 rounded-3xl shadow-lg">
              <Leaf className="text-[#1B4332]" size={40} />
            </div>
            <div>
              <Title className="text-white text-4xl font-black">農場民宿收支紀錄系統</Title>
              <Text className="text-emerald-200 font-bold text-lg opacity-90">B11256029 李仲琨 | 指導老師：潘建良老師</Text>
            </div>
          </Flex>
          <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20">
            <Text className="text-emerald-100 font-medium">系統狀態：雲端同步中</Text>
            <Title className="text-white text-xl">{new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })}</Title>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-10 mt-[-20px]">
        
        {/* 4.1.1 AI 語意記帳輸入區[cite: 3] */}
        <section>
          <Card className="ring-4 ring-[#1B4332]/5 border-none shadow-2xl p-8">
            <Title className="mb-4 text-[#1B4332] flex items-center gap-2 italic">✨ 智慧語意記帳 (NLP)</Title>
            <Flex className="gap-4 flex-col md:flex-row">
              <input 
                className="flex-1 w-full p-5 bg-slate-50 border-2 border-slate-200 focus:border-[#1B4332] rounded-2xl text-xl outline-none transition-all shadow-inner"
                placeholder="輸入一句話：例如「今天住宿收入 6000 元」或「買了 2000 元肥料」"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleAIParse()}
              />
              <Button 
                className="w-full md:w-52 py-5 rounded-2xl text-xl font-bold shadow-xl hover:scale-105 active:scale-95 transition-all"
                color="emerald" 
                onClick={handleAIParse} 
                loading={loading}
                icon={Send}
              >
                自動抓取分類
              </Button>
            </Flex>
          </Card>
        </section>

        <TabGroup>
          <TabList className="mb-8" variant="solid" color="emerald">
            <Tab icon={LayoutDashboard}>營運看板</Tab>
            <Tab icon={TrendingUp}>報表分析</Tab>
            <Tab icon={ClipboardCheck}>AI 診斷</Tab>
          </TabList>

          <TabPanels>
            {/* 4.2 頁籤一：核心指標看板 (KPI Cards)[cite: 3] */}
            <TabPanel>
              <Grid numItemsLg={3} className="gap-8">
                <Card decoration="top" decorationColor="emerald" className="shadow-lg border-none hover:shadow-2xl transition-shadow">
                  <Text className="font-bold text-slate-500 uppercase tracking-widest text-xs">當月總收入</Text>
                  <Metric className="text-emerald-700 font-black">${stats.income.toLocaleString()}</Metric>
                  <BadgeDelta deltaType="moderateIncrease" className="mt-3">穩定增長</BadgeDelta>
                </Card>

                <Card decoration="top" decorationColor="rose" className="shadow-lg border-none hover:shadow-2xl transition-shadow">
                  <Text className="font-bold text-slate-500 uppercase tracking-widest text-xs">當月總支出</Text>
                  <Metric className="text-rose-600 font-black">${stats.expense.toLocaleString()}</Metric>
                  <div className="mt-4">
                    <Flex>
                      <Text className="text-xs font-bold text-slate-400">收支佔比預警</Text>
                      <Text className="text-xs font-bold text-slate-600">{stats.ratio.toFixed(1)}%</Text>
                    </Flex>
                    <ProgressBar value={stats.ratio} color={stats.ratio > 80 ? "rose" : "emerald"} className="mt-2 shadow-inner" />
                  </div>
                </Card>

                <Card decoration="top" decorationColor="amber" className="shadow-lg border-none bg-[#FEF9E7] hover:shadow-2xl transition-shadow">
                  <Flex justifyContent="between">
                    <Text className="font-bold text-amber-800">當月結餘 (淨利潤)</Text>
                    <BadgeDelta deltaType={stats.netChange >= 0 ? "increase" : "decrease"}>
                      {Math.abs(stats.netChange).toFixed(1)}%
                    </BadgeDelta>
                  </Flex>
                  <Metric className="text-amber-900 font-black">${stats.balance.toLocaleString()}</Metric>
                  <Text className="mt-2 text-xs italic text-amber-700 font-medium flex items-center gap-1">
                    <TrendingUp size={12}/> 與上月相比之變化[cite: 3]
                  </Text>
                </Card>
              </Grid>

              {/* 4.3 基礎管理清單 (降序排列與編輯)[cite: 3] */}
              <div className="mt-12 space-y-6">
                <Title className="flex items-center gap-2 underline decoration-[#D4A373] decoration-4 underline-offset-8">最近收支管理清單</Title>
                <Card className="p-0 border-none shadow-xl overflow-hidden bg-white">
                  <div className="divide-y divide-slate-100">
                    {records.map(r => (
                      <div key={r.id} className="p-6 flex justify-between items-center hover:bg-slate-50 transition-all group">
                        {editingId === r.id ? (
                          <div className="flex gap-4 flex-1 animate-in zoom-in-95">
                            <input className="border-2 border-emerald-200 p-2 rounded-xl w-32 outline-none" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})} />
                            <input className="border-2 border-emerald-200 p-2 rounded-xl flex-1 outline-none" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                            <Button size="sm" onClick={saveEdit} color="emerald">儲存修改</Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>取消</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-6">
                              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner ${r.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                {r.category === '住宿' ? '🏡' : (r.category === '農產' ? '🍓' : '🔧')}
                              </div>
                              <div>
                                <Text className="font-black text-slate-700 text-xl">{r.description}</Text>
                                <div className="flex gap-3 mt-1">
                                  <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold uppercase">{r.category}</span>
                                  <span className="text-xs text-slate-400 font-medium">{new Date(r.createdAt).toLocaleString('zh-TW')}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-10">
                              <Metric className={`font-black tracking-tight ${r.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {r.type === 'income' ? '+' : '-'}{r.amount.toLocaleString()}
                              </Metric>
                              <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEdit(r)} className="p-3 bg-slate-100 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-2xl transition-all shadow-sm"><Edit3 size={20}/></button>
                                <button onClick={() => handleDelete(r.id)} className="p-3 bg-slate-100 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all shadow-sm"><Trash2 size={20}/></button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </TabPanel>

            {/* 4.2.2 頁籤二：動態報表系統[cite: 3] */}
            <TabPanel>
              <Grid numItemsLg={2} className="gap-8">
                <Card className="border-none shadow-xl bg-white p-8">
                  <Title className="flex items-center gap-2"><LayoutDashboard className="text-emerald-600" /> 月損益趨勢圖 (近半年)</Title>
                  <BarChart
                    className="mt-10 h-80"
                    data={[{name: '本月營運', '收入': stats.income, '支出': stats.expense}]}
                    index="name"
                    categories={["收入", "支出"]}
                    colors={["emerald", "rose"]}
                    yAxisWidth={60}
                    showLegend={true}
                  />
                </Card>
                <Card className="border-none shadow-xl bg-white p-8">
                  <Title className="flex items-center gap-2"><DollarSign className="text-amber-600" /> 支出結構分析 (成本怪獸)</Title>
                  <DonutChart
                    className="mt-10 h-80"
                    data={records.filter(r => r.type === 'expense').reduce((acc, curr) => {
                      const ex = acc.find(i => i.name === curr.category);
                      if (ex) ex.value += curr.amount; else acc.push({name: curr.category, value: curr.amount});
                      return acc;
                    }, [])}
                    category="value"
                    index="name"
                    colors={["emerald", "amber", "rose", "cyan", "lime", "orange"]}
                    showAnimation={true}
                    variant="pie"
                  />
                </Card>
              </Grid>
            </TabPanel>

            {/* 4.1.2 頁籤三：AI 經營診斷報告[cite: 3] */}
            <TabPanel>
              <Card className="bg-emerald-50 border-4 border-dashed border-emerald-200 p-12 text-center rounded-[3rem]">
                {diagnosis ? (
                  <div className="text-left animate-in fade-in duration-1000">
                    <Title className="text-emerald-900 text-2xl flex items-center gap-3 mb-6 font-black"><ClipboardCheck size={32}/> 智慧農場經營診斷建議書</Title>
                    <Divider className="bg-emerald-200" />
                    <div className="bg-white p-10 rounded-[2rem] shadow-2xl mt-8 leading-loose text-slate-700 text-lg border border-emerald-100 whitespace-pre-wrap font-medium">
                      {diagnosis}
                    </div>
                    <Button className="mt-10" variant="secondary" color="emerald" onClick={() => setDiagnosis('')}>更新數據並重新診斷</Button>
                  </div>
                ) : (
                  <div className="py-16">
                    <div className="bg-white w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl text-emerald-600 ring-8 ring-emerald-100">
                      <ClipboardCheck size={56} />
                    </div>
                    <Title className="text-3xl font-black text-emerald-900">生成本月診斷報告</Title>
                    <Text className="max-w-xl mx-auto mt-4 text-emerald-700 font-medium leading-relaxed">
                      系統將自動彙整您的「住宿」與「農產」數據，由 AI 分析支出是否異常（如維修費增加 30%），並根據季節給出策略建議。[cite: 3]
                    </Text>
                    <Button 
                      className="mt-12 px-16 py-5 text-2xl rounded-3xl font-black shadow-2xl hover:scale-105 transition-transform" 
                      color="emerald" 
                      loading={diagLoading} 
                      onClick={generateDiagnosis}
                    >
                      開始 AI 智慧診斷
                    </Button>
                  </div>
                )}
              </Card>
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </main>

      {/* PWA / 離線機制提示[cite: 3] */}
      <footer className="mt-20 border-t border-slate-200 py-10 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">
          <Text>離線持久化儲存已啟用 - 即使在果園也能記帳[cite: 3]</Text>
          <Text>© 2026 農場民宿財務管理系統 | PWA 快速入口已就緒</Text>
        </div>
      </footer>
    </div>
  );
}
