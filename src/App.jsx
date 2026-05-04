import React, { useState, useEffect } from 'react';
import { Card, Metric, Text, Title, BarChart, DonutChart, Flex, Grid, BadgeDelta } from "@tremor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db, auth } from './firebase';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { Mic, Send, Trash2 } from 'lucide-react';

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

export default function App() {
  const [records, setRecords] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);

  // 初始化匿名登入與資料監聽
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

  // Gemini API 語意解析邏輯
  const handleAIParse = async () => {
    if (!aiInput.trim()) return;
    setLoading(true);
    try {
      // 已經將模型更新為 2.0 版本
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `
        請分析以下這句話，判斷是一筆財務收支紀錄。
        請回傳純 JSON 格式，不要加任何其他文字或 Markdown 標記 (如 \`\`\`json)。
        格式需求：
        {
          "type": "income" 或是 "expense",
          "amount": 數字 (絕對值),
          "category": "住宿" 或 "農產" 或 "肥料" 或 "薪資" 或 "水電" 或 "雜項",
          "description": "原始描述的摘要"
        }
        分析句子：「${aiInput}」
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(responseText);

      await addDoc(collection(db, `users/${userId}/records`), {
        ...parsedData,
        createdAt: new Date().toISOString()
      });
      setAiInput('');
    } catch (error) {
      console.error("AI 解析失敗", error);
      alert("解析失敗，請確認輸入格式或稍微換個說法。");
    }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if(window.confirm('確定要刪除這筆資料嗎？')){
      await deleteDoc(doc(db, `users/${userId}/records`, id));
    }
  };

  // 財務數據計算
  const totalIncome = records.filter(r => r.type === 'income').reduce((acc, curr) => acc + curr.amount, 0);
  const totalExpense = records.filter(r => r.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0);
  const netBalance = totalIncome - totalExpense;

  const donutData = records.filter(r => r.type === 'expense').reduce((acc, curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) existing.value += curr.amount;
    else acc.push({ name: curr.category, value: curr.amount });
    return acc;
  }, []);

  const barData = [
    { name: '總結', '收入': totalIncome, '支出': totalExpense }
  ];

  return (
    <div className="p-4 md:p-10 mx-auto max-w-7xl">
      <Title className="mb-6 text-3xl font-bold text-gray-800">農場民宿智慧收支主控台</Title>
      
      {/* AI 語意記帳區塊 */}
      <Card className="mb-8 border-l-4 border-blue-500">
        <Title className="mb-4">🤖 AI 語意記帳 (Gemini NLP 解析)</Title>
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <input 
            type="text" 
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            placeholder="例如：今天賣出三間雙人房共 6000 元，或買了 2000 元的肥料" 
            className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full"
            onKeyPress={(e) => e.key === 'Enter' && handleAIParse()}
          />
          <button 
            onClick={handleAIParse}
            disabled={loading}
            className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '解析中...' : <><Send size={18} /> 智慧輸入</>}
          </button>
        </div>
      </Card>

      {/* KPI 看板 */}
      <Grid numItemsSm={1} numItemsLg={3} className="gap-6 mb-8">
        <Card decoration="top" decorationColor="green">
          <Text>總收入</Text>
          <Metric className="text-green-600">${totalIncome.toLocaleString()}</Metric>
        </Card>
        <Card decoration="top" decorationColor="red">
          <Text>總支出</Text>
          <Metric className="text-red-600">${totalExpense.toLocaleString()}</Metric>
        </Card>
        <Card decoration="top" decorationColor="blue">
          <Flex alignItems="baseline">
            <div>
              <Text>目前結餘</Text>
              <Metric>${netBalance.toLocaleString()}</Metric>
            </div>
            <BadgeDelta deltaType={netBalance >= 0 ? "increase" : "decrease"} />
          </Flex>
        </Card>
      </Grid>

      {/* 視覺化圖表 */}
      <Grid numItemsSm={1} numItemsLg={2} className="gap-6 mb-8">
        <Card>
          <Title>收支對比圖</Title>
          <BarChart
            className="mt-6 h-72"
            data={barData}
            index="name"
            categories={["收入", "支出"]}
            colors={["emerald", "rose"]}
            yAxisWidth={48}
          />
        </Card>
        <Card>
          <Title>支出結構分析</Title>
          <DonutChart
            className="mt-6 h-72"
            data={donutData}
            category="value"
            index="name"
            colors={["slate", "violet", "indigo", "rose", "cyan", "amber"]}
          />
        </Card>
      </Grid>

      {/* 歷史紀錄表單 */}
      <Card>
        <Title>近期收支紀錄</Title>
        <div className="mt-4 flex flex-col gap-3">
          {records.length === 0 ? (
            <Text className="text-center py-4">目前尚無資料，試著用 AI 記一筆吧！</Text>
          ) : (
            records.map(record => (
              <div key={record.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border">
                <div>
                  <div className="flex gap-2 items-center">
                    <span className={`px-2 py-1 text-xs rounded-full text-white ${record.type === 'income' ? 'bg-green-500' : 'bg-red-500'}`}>
                      {record.type === 'income' ? '收入' : '支出'}
                    </span>
                    <span className="font-bold text-gray-700">{record.category}</span>
                  </div>
                  <Text className="mt-1 text-sm text-gray-500">{record.description}</Text>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`font-bold ${record.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {record.type === 'income' ? '+' : '-'}${record.amount.toLocaleString()}
                  </span>
                  <button onClick={() => handleDelete(record.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
