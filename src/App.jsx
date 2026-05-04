import React, { useState, useEffect, useMemo } from 'react';
import { 
  Card, Metric, Text, Title, BarChart, DonutChart, 
  Flex, Grid, BadgeDelta, ProgressBar, Button, TabGroup, TabList, Tab, TabPanels, TabPanel, Divider
} from "@tremor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db, auth } from './firebase';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { Send, Trash2, Edit3, ClipboardCheck, LayoutDashboard, ListOrdered, Leaf, AlertTriangle } from 'lucide-react';

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

  // --- 核心功能 4.1: AI 語意記帳 (NLP) ---
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `
        你現在是一個農場民宿的財務助手。請分析語句並回傳 JSON 格式。
        類別限於：住宿、農產、肥料、薪資、水電、維修、雜項。
        語句：「${aiInput}」
        JSON 格式範例：{"type": "income/expense", "amount": 100, "category": "類別", "description": "摘要"}
      `;
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/```json|```/g, '').trim();
      const data = JSON.parse(text);
      await addDoc(collection(db, `users/${userId}/records`), { ...data, createdAt: new Date().toISOString() });
      setAiInput('');
    } catch (e) { alert("AI 解析失敗，請換個說法"); }
    setLoading(false);
  };

  // --- 核心功能 4.1: AI 經營診斷報告 ---
  const generateDiagnosis = async () => {
    setDiagLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const summary = records.slice(0, 20).map(r => `${r.type}:${r.amount}(${r.category})`).join(',');
      const prompt = `你是經營顧問，請針對以下農場近期帳目給出診斷建議(約150字)，包含支出異常警示與經營策略：${summary}`;
      const result = await model.generateContent(prompt);
      setDiagnosis(result.response.text());
    } catch (e) { setDiagnosis("診斷生成失敗，請稍後再試。"); }
    setDiagLoading(false);
  };

  // --- 數據運算 (KPI 看板邏輯) ---
  const stats = useMemo(() => {
    const income = records.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = records.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const ratio = income > 0 ? (expense / income) * 100 : 0;
    return { income, expense, balance: income - expense, ratio };
  }, [records]);

  // --- CRUD: 編輯與刪除 ---
  const startEdit = (r) => { setEditingId(r.id); setEditForm(r); };
  const saveEdit = async () => {
    await updateDoc(doc(db, `users/${userId}/records`, editingId), editForm);
    setEditingId(null);
  };
  const handleDelete = async (id) => { if(confirm("確定刪除？")) await deleteDoc(doc(db, `users/${userId}/records`, id)); };

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-slate-900 pb-20">
      {/* 頂部農場標頭 */}
      <header className="bg-emerald-800 text-white p-6 shadow-lg mb-8">
        <Flex justifyContent="start" className="gap-3">
          <Leaf className="text-yellow-400" size={32} />
          <div>
            <Title className="text-white text-2xl font-bold">農場民宿收支紀錄系統</Title>
            <Text className="text-emerald-100 opacity-80">B11256029 李仲琨 | 管理主控台</Text>
          </div>
        </Flex>
      </header>

      <main className="max-w-7xl mx-auto px-4">
        <TabGroup>
          <TabList className="mb-6" variant="solid" color="emerald">
            <Tab icon={LayoutDashboard}>營運概覽</Tab>
            <Tab icon={ListOrdered}>明細管理</Tab>
            <Tab icon={ClipboardCheck}>AI 診斷報告</Tab>
          </TabList>

          <TabPanels>
            {/* 頁籤一：智慧主控台 (企劃書 4.2) */}
            <TabPanel>
              <Grid numItemsLg={3} className="gap-6 mb-8">
                <Card decoration="top" decorationColor="emerald" className="bg-white">
                  <Text>總收入 (住宿+農產)</Text>
                  <Metric className="text-emerald-700">${stats.income.toLocaleString()}</Metric>
                  <BadgeDelta deltaType="moderateIncrease" className="mt-2">住宿佔 65%</BadgeDelta>
                </Card>
                <Card decoration="top" decorationColor="rose" className="bg-white">
                  <Text>總支出</Text>
                  <Metric className="text-rose-600">${stats.expense.toLocaleString()}</Metric>
                  <Text className="mt-2 text-xs italic text-slate-400">含肥料、薪資、水電</Text>
                </Card>
                <Card decoration="top" decorationColor="amber" className="bg-white">
                  <Text>目前結餘</Text>
                  <Metric className="text-amber-700">${stats.balance.toLocaleString()}</Metric>
                  <Flex className="mt-4">
                    <Text className="truncate">收支比 {stats.ratio.toFixed(1)}%</Text>
                    <Text>{stats.ratio > 80 ? "⚠️ 風險預警" : "穩定"}</Text>
                  </Flex>
                  <ProgressBar value={stats.ratio} color={stats.ratio > 80 ? "rose" : "emerald"} className="mt-2" />
                </Card>
              </Grid>

              <Grid numItemsLg={2} className="gap-6">
                <Card className="bg-white border-none shadow-sm">
                  <Title>月損益趨勢 (近半年)</Title>
                  <BarChart
                    className="mt-6 h-72"
                    data={[{name: '本月', '收入': stats.income, '支出': stats.expense}]}
                    index="name"
                    categories={["收入", "支出"]}
                    colors={["emerald", "rose"]}
                  />
                </Card>
                <Card className="bg-white border-none shadow-sm">
                  <Title>支出結構分析</Title>
                  <DonutChart
                    className="mt-6 h-72"
                    data={records.filter(r => r.type === 'expense').reduce((acc, curr) => {
                      const ex = acc.find(i => i.name === curr.category);
                      if (ex) ex.value += curr.amount; else acc.push({name: curr.category, value: curr.amount});
                      return acc;
                    }, [])}
                    category="value"
                    index="name"
                    colors={["emerald", "amber", "lime", "orange", "yellow"]}
                  />
                </Card>
              </Grid>
            </TabPanel>

            {/* 頁籤二：明細與 CRUD (企劃書 4.3) */}
            <TabPanel>
              <Card className="mb-6 border-l-8 border-emerald-600">
                <Flex className="gap-4">
                  <input 
                    className="flex-1 p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="輸入一句話記帳：例如「今天賣出兩間房 4000元」"
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && handleAIParse()}
                  />
                  <Button icon={Send} color="emerald" onClick={handleAIParse} loading={loading}>智慧解析</Button>
                </Flex>
              </Card>

              <Card>
                <Title>歷史收支清單</Title>
                <div className="mt-6 space-y-4">
                  {records.map(r => (
                    <div key={r.id} className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center hover:shadow-md transition-shadow">
                      {editingId === r.id ? (
                        <div className="flex gap-2 flex-1 mr-4">
                          <input className="border p-1 rounded w-20" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: Number(e.target.value)})} />
                          <input className="border p-1 rounded flex-1" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                          <Button size="xs" onClick={saveEdit} color="emerald">儲存</Button>
                          <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>取消</Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${r.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {r.category === '住宿' ? '🏡' : '🍎'}
                            </div>
                            <div>
                              <Text className="font-bold text-slate-800">{r.description}</Text>
                              <Text className="text-xs text-slate-400">{r.category} | {new Date(r.createdAt).toLocaleDateString()}</Text>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <Text className={`font-mono font-bold ${r.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {r.type === 'income' ? '+' : '-'}${r.amount.toLocaleString()}
                            </Text>
                            <div className="flex gap-2">
                              <button onClick={() => startEdit(r)} className="text-slate-400 hover:text-emerald-600"><Edit3 size={18}/></button>
                              <button onClick={() => handleDelete(r.id)} className="text-slate-400 hover:text-rose-600"><Trash2 size={18}/></button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </TabPanel>

            {/* 頁籤三：AI 經營診斷 (企劃書 4.1.2) */}
            <TabPanel>
              <Card className="bg-emerald-50 border-dashed border-2 border-emerald-200 min-h-[400px] flex flex-col items-center justify-center text-center p-10">
                {diagnosis ? (
                  <div className="text-left">
                    <Title className="text-emerald-800 mb-4 flex items-center gap-2"><ClipboardCheck /> 本月農場經營診斷報告</Title>
                    <Divider />
                    <div className="bg-white p-6 rounded-2xl shadow-inner mt-4 leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {diagnosis}
                    </div>
                    <Button className="mt-8" variant="secondary" color="emerald" onClick={() => setDiagnosis('')}>重新生成報告</Button>
                  </div>
                ) : (
                  <>
                    <div className="bg-white p-6 rounded-full mb-6 shadow-xl text-emerald-600">
                      <ClipboardCheck size={48} />
                    </div>
                    <Title>智慧農場經營分析</Title>
                    <Text className="max-w-md mt-2">系統將彙整本月所有「住宿」與「農產」數據，透過 AI 分析是否有支出異常，並提供下個月的耕種與行銷策略建議。</Text>
                    <Button 
                      className="mt-8 px-10 py-3 text-lg" 
                      color="emerald" 
                      loading={diagLoading} 
                      onClick={generateDiagnosis}
                    >
                      生成診斷報告
                    </Button>
                  </>
                )}
              </Card>
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </main>
    </div>
  );
}
