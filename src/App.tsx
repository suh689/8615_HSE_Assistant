import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, MicOff, ShieldAlert, Activity, ShieldCheck, Zap, Radio, BarChart2, Database, Square, Settings, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createChatSession, getAI } from './lib/gemini';
import { Modality } from '@google/genai';
import { Message, TriggerData } from './types';
import { cn } from './lib/utils';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, AreaChart, Area } from 'recharts';
import { RobotAvatar } from './components/RobotAvatar';

// Initialize chat session lazily
let chatSession: any = null;
let currentKnowledgeBase: string = '';

const getChatSession = (knowledgeBase: string, forceRecreate = false) => {
  if (!chatSession || forceRecreate || currentKnowledgeBase !== knowledgeBase) {
    chatSession = createChatSession(knowledgeBase);
    currentKnowledgeBase = knowledgeBase;
  }
  return chatSession;
};

export default function App() {
  const [knowledgeBase, setKnowledgeBase] = useState(`1. 夏季作业：TWL 监测 2359 次，空调 BUS 覆盖，中暑率下降 80%+。
2. 驾驶管理：3+4 老带新机制，高级雇员结对，沙漠驾驶“五不准”，副驾驶监督职责。
3. 培训数据：98 次培训，覆盖 463 人；效果验证 1259 人次。
4. 审计面谈：管理层访谈 94 人次；交叉审计 168 次（含 6 次夜间审计）；管理层检查 35 次。
5. 工具更新：2026 版动态野外检查清单，实时化风险管控。`);

  // 加载本地数据库
  useEffect(() => {
    const loadDb = async () => {
      try {
        // @ts-ignore
        if (window.require) {
          // @ts-ignore
          const { ipcRenderer } = window.require('electron');
          const data = await ipcRenderer.invoke('get-hse-data');
          if (data && data.knowledgeBase) {
            setKnowledgeBase(data.knowledgeBase);
            setUpdateText(data.knowledgeBase);
          }
        } else {
          // 浏览器环境回退
          const localData = localStorage.getItem('hse_database');
          if (localData) {
            const parsed = JSON.parse(localData);
            setKnowledgeBase(parsed.knowledgeBase);
            setUpdateText(parsed.knowledgeBase);
          }
        }
      } catch (err) {
        console.error("Failed to load DB:", err);
      }
    };
    loadDb();
  }, []);

  const saveKnowledgeBase = async (newKb: string) => {
    setKnowledgeBase(newKb);
    knowledgeBaseRef.current = newKb; // 立即更新 ref 避免闭包旧值
    getChatSession(newKb, true); // 强制重建会话以应用新知识库
    
    try {
      // @ts-ignore
      if (window.require) {
        // @ts-ignore
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('save-hse-data', { knowledgeBase: newKb });
      } else {
        localStorage.setItem('hse_database', JSON.stringify({ knowledgeBase: newKb }));
      }
    } catch (err) {
      console.error("Failed to save DB:", err);
    }
  };

  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome',
    role: 'assistant',
    content: '长官您好，我是 8615 队 HSE 数字化智能指挥官。系统已就绪，随时准备为您汇报核心安全数据。',
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoListen, setAutoListen] = useState(false);
  const [activeTrigger, setActiveTrigger] = useState<TriggerData | null>(null);
  
  const [dashboardData, setDashboardData] = useState({
    safeManHours: 1254300,
    ltif: 0.00,
    trir: 0.15,
    twlStatus: 'Green',
    ptwActive: 32,
    safetyScore: 96,
    trainingCount: 128,
    riskResolved: 85,
    hiddenDangers: 2,
    incidentCount: 0
  });
  const [showDashboard, setShowDashboard] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateText, setUpdateText] = useState(knowledgeBase);
  const [micLang, setMicLang] = useState('zh-CN');
  const [isPlaying, setIsPlaying] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [ttsProvider, setTtsProvider] = useState(() => localStorage.getItem('ttsProvider') || 'gemini');
  const [geminiVoice, setGeminiVoice] = useState(() => localStorage.getItem('geminiVoice') || 'Zephyr');
  const [elKey, setElKey] = useState(() => localStorage.getItem('elevenLabsKey') || '');
  const [elVoice, setElVoice] = useState(() => localStorage.getItem('elevenLabsVoice') || '21m00Tcm4TlvDq8ikWAM');

  useEffect(() => {
    localStorage.setItem('ttsProvider', ttsProvider);
    localStorage.setItem('geminiVoice', geminiVoice);
    localStorage.setItem('elevenLabsKey', elKey);
    localStorage.setItem('elevenLabsVoice', elVoice);
  }, [ttsProvider, geminiVoice, elKey, elVoice]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const isListeningRef = useRef(isListening);
  const autoListenRef = useRef(autoListen);
  const isLoadingRef = useRef(isLoading);
  const knowledgeBaseRef = useRef(knowledgeBase);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { autoListenRef.current = autoListen; }, [autoListen]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { knowledgeBaseRef.current = knowledgeBase; }, [knowledgeBase]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Pre-load voices for TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  const audioQueueRef = useRef<{text: string, bufferPromise: Promise<AudioBuffer | null> | null}[]>([]);
  const isPlayingRef = useRef(false);

  const stopSpeech = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    audioQueueRef.current = [];
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
      } catch (e) {}
      audioSourceRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const fetchAudioBuffer = async (speechText: string): Promise<AudioBuffer | null> => {
    const provider = localStorage.getItem('ttsProvider') || 'gemini';
    if (provider === 'browser') return null;

    const gVoice = localStorage.getItem('geminiVoice') || 'Zephyr';
    const apiKey = localStorage.getItem('elevenLabsKey') || '';
    const voiceId = localStorage.getItem('elevenLabsVoice') || '21m00Tcm4TlvDq8ikWAM';

    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(ctx.destination);
      setAnalyserNode(analyser);
      analyserRef.current = analyser;
    }
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    if (provider === 'elevenlabs' && apiKey) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: speechText,
          model_id: "eleven_multilingual_v2"
        })
      });
      if (!res.ok) throw new Error('ElevenLabs API error');
      const arrayBuffer = await res.arrayBuffer();
      return await audioCtx.decodeAudioData(arrayBuffer);
    } else if (provider === 'gemini') {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: speechText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: gVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return await audioCtx.decodeAudioData(bytes.buffer);
      }
    }
    return null;
  };

  const enqueueAudio = useCallback((text: string) => {
    const speechText = text
      .replace(/[*#_`~]/g, '')
      .replace(/\[TRIGGER_DATA:[\s\S]*?\]/gi, '')
      .replace(/\[UPDATE_DASHBOARD:[\s\S]*?\]/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\bADNOC\b/gi, 'Adnoc')
      .replace(/\bHSE\b/gi, 'H S E')
      .replace(/\bBGP\b/gi, 'B G P')
      .replace(/\bTWL\b/gi, 'T W L')
      .replace(/8615/g, '八六幺五')
      .replace(/2026/g, '二零二六')
      .replace(/3\+4/g, '三加四')
      .trim();

    if (!speechText) return;

    const task = {
      text: speechText,
      bufferPromise: fetchAudioBuffer(speechText).catch(err => {
        console.warn("TTS Fetch error:", err);
        return null;
      })
    };

    audioQueueRef.current.push(task);

    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      playNextInQueue();
    }
  }, []);

  const playLocalTTS = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      playNextInQueue();
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    const isArabic = /[\u0600-\u06FF]/.test(text);
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    
    let targetLang = 'en-US';
    let langPrefix = 'en';
    if (isArabic) { targetLang = 'ar-SA'; langPrefix = 'ar'; } 
    else if (isChinese) { targetLang = 'zh-CN'; langPrefix = 'zh'; }
    
    utterance.lang = targetLang;
    
    const voices = window.speechSynthesis.getVoices();
    const langVoices = voices.filter(v => {
      const vLang = v.lang.toLowerCase();
      const vName = v.name.toLowerCase();
      if (langPrefix === 'zh') return vLang.startsWith('zh') || vName.includes('chinese') || vName.includes('中文');
      if (langPrefix === 'ar') return vLang.startsWith('ar') || vName.includes('arabic') || vName.includes('عربي');
      return vLang.startsWith('en') || vName.includes('english');
    });
    
    const maleKeywords = ['yunxi', '云希', 'male', '男', 'kangkang', '康康', 'yunjian', '云健', 'yunye', '云野', 'xiaoyou', '晓悠'];
    const bestVoice = langVoices.find(v => maleKeywords.some(k => v.name.toLowerCase().includes(k))) || 
                      langVoices.find(v => v.name.includes('Google')) ||
                      langVoices.find(v => v.name.includes('Microsoft')) ||
                      langVoices[0];
                      
    if (bestVoice) utterance.voice = bestVoice;
    
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    
    utterance.onend = () => { if (isPlayingRef.current) playNextInQueue(); };
    utterance.onerror = () => { if (isPlayingRef.current) playNextInQueue(); };

    window.speechSynthesis.speak(utterance);
  }, []);

  const playNextInQueue = useCallback(async () => {
    if (audioQueueRef.current.length === 0 || !isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (autoListenRef.current) {
        setTimeout(() => {
          if (!isListeningRef.current) startRecording();
        }, 500);
      }
      return;
    }

    setIsPlaying(true);
    const task = audioQueueRef.current.shift()!;

    try {
      const audioBuffer = await task.bufferPromise;

      if (audioBuffer && isPlayingRef.current) {
        const audioCtx = audioContextRef.current!;
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyserRef.current!);
        
        source.onended = () => {
          if (isPlayingRef.current) playNextInQueue();
        };
        
        audioSourceRef.current = source;
        source.start(0);
      } else if (isPlayingRef.current) {
        playLocalTTS(task.text);
      }
    } catch (error) {
      if (isPlayingRef.current) playLocalTTS(task.text);
    }
  }, [playLocalTTS]);

  const parseTriggerData = (text: string): { cleanText: string, triggerData?: TriggerData, newDashboardData?: any } => {
    // Match with or without markdown code blocks, allowing newlines
    const regex = /\[TRIGGER_DATA:\s*({[\s\S]*?})\s*\]/;
    const dashboardRegex = /\[UPDATE_DASHBOARD:\s*({[\s\S]*?})\s*\]/;
    
    const match = text.match(regex);
    const dashMatch = text.match(dashboardRegex);
    
    let cleanText = text;
    let triggerData: TriggerData | undefined;
    let newDashboardData: any | undefined;

    if (match && match[1]) {
      try {
        triggerData = JSON.parse(match[1]) as TriggerData;
      } catch (e) {
        console.error("Failed to parse trigger data", e);
      }
    }

    if (dashMatch && dashMatch[1]) {
      try {
        newDashboardData = JSON.parse(dashMatch[1]);
      } catch (e) {
        console.error("Failed to parse dashboard data", e);
      }
    }

    // Aggressively remove ALL trigger data blocks and markdown formatting
    cleanText = cleanText.replace(/(?:```(?:json)?\s*)?\[TRIGGER_DATA:[\s\S]*?\](?:\s*```)?/gi, '');
    cleanText = cleanText.replace(/(?:```(?:json)?\s*)?\[UPDATE_DASHBOARD:[\s\S]*?\](?:\s*```)?/gi, '');
    
    // Also remove incomplete tags at the end of the string
    cleanText = cleanText.replace(/(?:```(?:json)?\s*)?\[TRIGGER_DATA:[\s\S]*$/i, '');
    cleanText = cleanText.replace(/(?:```(?:json)?\s*)?\[UPDATE_DASHBOARD:[\s\S]*$/i, '');
    
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    return { cleanText, triggerData, newDashboardData };
  };

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isLoadingRef.current) return;

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    
    // Don't show system update commands in the UI
    if (!text.startsWith('【系统指令')) {
      setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: text }]);
    }
    
    setInput('');
    setIsLoading(true);
    setActiveTrigger(null);

    try {
      stopRecording();
    } catch(e) {}

    try {
      const session = getChatSession(knowledgeBaseRef.current);
      const stream = await session.sendMessageStream({ message: text });
      
      setMessages(prev => [...prev, { 
        id: assistantMsgId, 
        role: 'assistant', 
        content: ''
      }]);

      let fullText = '';
      let processedCleanTextIndex = 0;

      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        fullText += chunkText;
        
        const { cleanText, triggerData, newDashboardData } = parseTriggerData(fullText);
        
        if (triggerData) {
          setActiveTrigger(triggerData);
        }
        if (newDashboardData) {
          setDashboardData(prev => ({ ...prev, ...newDashboardData }));
        }

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg.id === assistantMsgId) {
            lastMsg.content = cleanText;
            if (triggerData) lastMsg.triggerData = triggerData;
          }
          return newMessages;
        });

        // Chunking for TTS using cleanText
        const unprocessed = cleanText.substring(processedCleanTextIndex);
        // Split by punctuation (including commas) to make chunks smaller and faster
        // 修复：使用负向先行断言 \.(?!\d) 确保不会在数字中间的小数点处断句（例如 125.4）
        const sentenceRegex = /([\s\S]+?(?:[,，。!！?？\n]|\.(?!\d))+)/g;
        let match;
        while ((match = sentenceRegex.exec(unprocessed)) !== null) {
          const sentence = match[1].trim();
          if (sentence) {
            enqueueAudio(sentence);
          }
          processedCleanTextIndex += match[0].length;
        }
      }
      
      // Final parse
      const finalParse = parseTriggerData(fullText);
      if (finalParse.newDashboardData) {
        setDashboardData(prev => ({ ...prev, ...finalParse.newDashboardData }));
      }
      if (finalParse.triggerData) {
        setActiveTrigger(finalParse.triggerData);
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg.id === assistantMsgId) {
            lastMsg.triggerData = finalParse.triggerData;
          }
          return newMessages;
        });
      }

      // Process remaining text for TTS
      const remaining = finalParse.cleanText.substring(processedCleanTextIndex).trim();
      if (remaining) {
        enqueueAudio(remaining);
      }

      setIsLoading(false);

    } catch (error: any) {
      console.error("Error sending message:", error);
      
      let errorMsg = `系统连接异常，请检查网络状态。\n(详细错误: ${error?.message || String(error)})`;
      if (error?.message?.includes('API key not valid') || error?.message?.includes('API key is required')) {
        errorMsg = 'API Key 无效或已过期，请检查您提供的 API Key 是否正确。';
      }

      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: errorMsg 
      }]);
      setIsLoading(false);
    }
  }, [playNextInQueue]);

  // Initialize Speech Recognition via Gemini
  const startRecording = async () => {
    if (isListeningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (micAudioContextRef.current) micAudioContextRef.current.close();
        micStreamRef.current?.getTracks().forEach(track => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        if (audioBlob.size === 0) {
          if (autoListenRef.current && !isLoadingRef.current && !isPlayingRef.current) {
            setTimeout(startRecording, 500);
          }
          return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          const mimeType = audioBlob.type.split(';')[0] || 'audio/webm';

          setIsLoading(true);
          try {
            const ai = getAI();
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: [
                {
                  parts: [
                    {
                      inlineData: {
                        data: base64data,
                        mimeType: mimeType,
                      }
                    },
                    {
                      text: "Please transcribe the following audio exactly as spoken in its original language. Do not answer it or add any extra text. Just output the transcription."
                    }
                  ]
                }
              ]
            });

            const transcript = response.text?.trim();
            if (transcript) {
              setInput(transcript);
              handleSend(transcript);
            } else {
              setIsLoading(false);
              if (autoListenRef.current && !isPlayingRef.current) {
                setTimeout(startRecording, 500);
              }
            }
          } catch (error) {
            console.error("Transcription error:", error);
            setIsLoading(false);
            if (autoListenRef.current && !isPlayingRef.current) {
              setTimeout(startRecording, 500);
            }
          }
        };
      };

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      micAudioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.minDecibels = -50;
      source.connect(analyser);

      const checkSilence = () => {
        if (mediaRecorder.state !== 'recording') return;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const isSpeaking = dataArray.some(val => val > 5);

        if (isSpeaking) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
              }
            }, 2000);
          }
        }
        requestAnimationFrame(checkSilence);
      };

      mediaRecorder.start();
      setIsListening(true);
      checkSilence();

    } catch (error) {
      console.error("Error accessing microphone:", error);
      setIsListening(false);
      setAutoListen(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '麦克风访问失败，请检查设备连接或浏览器权限。'
      }]);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopRecording();
    } else {
      setInput('');
      startRecording();
    }
  };

  const toggleAutoListen = () => {
    const nextState = !autoListen;
    setAutoListen(nextState);
    if (nextState && !isListening && !isLoading) {
      startRecording();
    } else if (!nextState && isListening) {
      stopRecording();
    }
  };

  const handleInduction = () => {
    handleSend("CMD_START_INDUCTION");
  };

  return (
    <div className="flex h-screen bg-[#0d1117] text-[#c9d1d9] font-sans overflow-hidden">
      {/* Left Panel: Chat Interface */}
      <div className="flex flex-col w-full md:w-1/2 lg:w-7/12 border-r border-[#30363d] bg-[#0d1117] relative">
        <RobotAvatar isPlaying={isPlaying} analyser={analyserNode} />
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#1f6feb]/10 rounded-lg border border-[#1f6feb]/30">
              <ShieldCheck className="w-6 h-6 text-[#58a6ff]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white tracking-wide">Crew-8615 HSE Assistant</h1>
              <p className="text-xs text-[#8b949e] font-mono">CNPC BGP Crew 8615 // ADNOC Standard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md transition-colors border border-transparent hover:border-[#30363d]"
              title="Voice Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowUpdateModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-md text-sm text-[#c9d1d9] transition-colors"
            >
              <Database className="w-4 h-4" />
              更新数据
            </button>
            <button 
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[#2ea043] hover:bg-[#3fb950] text-white rounded-md text-sm font-medium transition-colors shadow-[0_0_15px_rgba(46,160,67,0.3)]"
            >
              <BarChart2 className="w-4 h-4" />
              全景看板
            </button>
            <button 
              onClick={toggleAutoListen}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border",
                autoListen 
                  ? "bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/50" 
                  : "bg-transparent text-[#8b949e] border-[#30363d] hover:text-[#c9d1d9]"
              )}
            >
              <Radio className={cn("w-4 h-4", autoListen && "animate-pulse")} />
              {autoListen ? "实时对话中" : "开启实时对话"}
            </button>
            <button 
              onClick={handleInduction}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              一键 Induction
            </button>
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex max-w-[85%]",
                  msg.role === 'user' ? "ml-auto justify-end" : "mr-auto justify-start"
                )}
              >
                <div className={cn(
                  "p-4 rounded-2xl leading-relaxed text-[15px]",
                  msg.role === 'user' 
                    ? "bg-[#1f6feb] text-white rounded-tr-sm" 
                    : "bg-[#21262d] text-[#c9d1d9] rounded-tl-sm border border-[#30363d]"
                )}>
                  {msg.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="flex max-w-[85%] mr-auto justify-start"
            >
              <div className="p-4 rounded-2xl bg-[#21262d] text-[#8b949e] rounded-tl-sm border border-[#30363d] flex items-center gap-2">
                <Activity className="w-4 h-4 animate-pulse" />
                正在分析数据...
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-[#30363d] bg-[#161b22] relative">
          <AnimatePresence>
            {isPlaying && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={stopSpeech}
                className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#f85149] text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium hover:bg-[#ff6a63] transition-colors z-20"
              >
                <Square className="w-4 h-4 fill-current" />
                停止播报
              </motion.button>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-2 bg-[#0d1117] border border-[#30363d] rounded-xl p-2 focus-within:border-[#58a6ff] transition-colors relative overflow-hidden">
            {isListening && (
              <div className="absolute inset-0 bg-[#1f6feb]/5 animate-pulse pointer-events-none" />
            )}
            <button 
              onClick={toggleListening}
              className={cn(
                "p-2 transition-colors rounded-lg z-10",
                isListening ? "text-[#ff7b72] bg-[#ff7b72]/10" : "text-[#8b949e] hover:text-[#c9d1d9]"
              )}
            >
              {isListening ? <Mic className="w-5 h-5 animate-pulse" /> : <MicOff className="w-5 h-5" />}
            </button>
            <select
              value={micLang}
              onChange={(e) => setMicLang(e.target.value)}
              className="bg-transparent text-xs text-[#8b949e] border-none outline-none cursor-pointer z-10 hover:text-[#c9d1d9] transition-colors"
              title="语音输入语言"
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
              <option value="ar-SA">العربية</option>
            </select>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
              placeholder={isListening ? "正在聆听..." : "输入指令或点击麦克风说话..."}
              className="flex-1 bg-transparent border-none outline-none text-[#c9d1d9] placeholder:text-[#8b949e] px-2 z-10"
              disabled={isLoading}
            />
            <button 
              onClick={() => handleSend(input)}
              disabled={!input.trim() || isLoading}
              className="p-2 bg-[#1f6feb] hover:bg-[#388bfd] disabled:bg-[#1f6feb]/50 text-white rounded-lg transition-colors z-10"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel: Data Visualization */}
      <div className="hidden md:flex flex-col w-1/2 lg:w-5/12 bg-[#0d1117] p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(31,111,235,0.05)_0%,transparent_70%)] pointer-events-none" />
        
        <div className="flex items-center gap-2 mb-8">
          <Activity className="w-5 h-5 text-[#8b949e]" />
          <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest">Real-time Telemetry</h2>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <AnimatePresence mode="wait">
            {activeTrigger ? (
              <motion.div
                key={activeTrigger.id + Date.now()}
                initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                className="w-full max-w-md aspect-square bg-[#161b22] border border-[#30363d] rounded-3xl p-8 shadow-[0_0_40px_rgba(31,111,235,0.1)] flex flex-col relative overflow-hidden"
              >
                {/* Decorative elements */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#58a6ff] to-transparent opacity-50" />
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#1f6feb] blur-[100px] opacity-20 rounded-full" />
                
                <div className="text-center mb-6 z-10">
                  <h3 className="text-xl font-semibold text-white mb-1">{activeTrigger.label}</h3>
                  <p className="text-xs font-mono text-[#8b949e]">ID: {activeTrigger.id.toUpperCase()}</p>
                </div>

                <div className="flex-1 flex items-center justify-center z-10 w-full h-full">
                  <svg style={{ height: 0, width: 0, position: 'absolute' }}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#58a6ff" stopOpacity={1} />
                        <stop offset="100%" stopColor="#1f6feb" stopOpacity={0.2} />
                      </linearGradient>
                      <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#2ea043" />
                        <stop offset="100%" stopColor="#3fb950" />
                      </linearGradient>
                      <linearGradient id="pieGradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#a371f7" />
                        <stop offset="100%" stopColor="#d2a8ff" />
                      </linearGradient>
                      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>
                  </svg>

                  {activeTrigger.chart_type === 'gauge' && (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { value: activeTrigger.value },
                              { value: 100 - activeTrigger.value }
                            ]}
                            cx="50%"
                            cy="50%"
                            startAngle={180}
                            endAngle={0}
                            innerRadius="75%"
                            outerRadius="95%"
                            dataKey="value"
                            stroke="none"
                            cornerRadius={8}
                            paddingAngle={2}
                          >
                            <Cell fill="url(#gaugeGradient)" filter="url(#glow)" />
                            <Cell fill="#21262d" />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center mt-12">
                        <span className="text-6xl font-mono font-bold text-white tracking-tighter" style={{ textShadow: '0 0 20px rgba(46,160,67,0.5)' }}>
                          {activeTrigger.value}<span className="text-3xl text-[#8b949e]">%</span>
                        </span>
                      </div>
                    </div>
                  )}

                  {activeTrigger.chart_type === 'bar' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[{ name: activeTrigger.label, value: activeTrigger.value }]} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} opacity={0.5} />
                        <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                          cursor={{ fill: '#21262d', opacity: 0.4 }}
                          contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', borderRadius: '8px', color: '#c9d1d9' }}
                          itemStyle={{ color: '#58a6ff', fontWeight: 'bold' }}
                        />
                        <Bar dataKey="value" fill="url(#barGradient)" radius={[6, 6, 0, 0]} barSize={60} filter="url(#glow)" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}

                  {activeTrigger.chart_type === 'pie' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Target', value: activeTrigger.value },
                            { name: 'Remaining', value: 100 - (activeTrigger.value > 100 ? 0 : activeTrigger.value) }
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius="65%"
                          outerRadius="85%"
                          dataKey="value"
                          stroke="#161b22"
                          strokeWidth={4}
                          cornerRadius={6}
                          paddingAngle={4}
                        >
                          <Cell fill="url(#pieGradient)" filter="url(#glow)" />
                          <Cell fill="#21262d" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', borderRadius: '8px', color: '#c9d1d9' }}
                          itemStyle={{ color: '#a371f7', fontWeight: 'bold' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </motion.div>
            ) : (isLoading || isPlaying) ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="text-center text-[#58a6ff] flex flex-col items-center gap-6"
              >
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <div className="absolute inset-0 border-4 border-[#1f6feb]/30 rounded-full" />
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 border-4 border-transparent border-t-[#58a6ff] rounded-full"
                  />
                  <Activity className="w-8 h-8 animate-pulse" />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="font-mono text-sm tracking-widest uppercase animate-pulse">Analyzing Context...</p>
                  <div className="flex gap-1 justify-center h-4 items-center">
                    <motion.div animate={{ height: [4, 12, 4] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} className="w-1 bg-[#58a6ff] rounded-full" />
                    <motion.div animate={{ height: [4, 16, 4] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} className="w-1 bg-[#58a6ff] rounded-full" />
                    <motion.div animate={{ height: [4, 8, 4] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} className="w-1 bg-[#58a6ff] rounded-full" />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                className="text-center text-[#8b949e] flex flex-col items-center gap-4"
              >
                <ShieldAlert className="w-16 h-16" />
                <p className="font-mono text-sm">Awaiting Telemetry Data...</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {showDashboard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl w-full max-w-[95vw] h-[95vh] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-[#30363d] flex justify-between items-center bg-gradient-to-r from-[#161b22] to-[#0d1117]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#1f6feb]/10 rounded-lg border border-[#1f6feb]/30">
                  <BarChart2 className="w-6 h-6 text-[#58a6ff]" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">HSE 全景数据看板 <span className="text-[#8b949e] text-sm font-normal ml-2">| BGP Crew 8615</span></h2>
                </div>
              </div>
              <button onClick={() => setShowDashboard(false)} className="p-2 text-[#8b949e] hover:text-white hover:bg-[#30363d] rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-[#0d1117]">
              {/* KPI Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                {/* Safe Man Hours */}
                <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl p-5 relative overflow-hidden group hover:border-[#2ea043]/50 transition-colors">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><ShieldCheck className="w-12 h-12 text-[#2ea043]" /></div>
                  <span className="text-[#8b949e] text-sm font-medium mb-1 block">安全人工时 (Safe Man-hours)</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-mono font-bold text-white">{dashboardData.safeManHours.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-xs text-[#2ea043] flex items-center gap-1"><Zap className="w-3 h-3"/> 连续无损工事件</div>
                </div>
                {/* LTIF */}
                <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl p-5 relative overflow-hidden group hover:border-[#58a6ff]/50 transition-colors">
                  <span className="text-[#8b949e] text-sm font-medium mb-1 block">损工事件率 (LTIF)</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-mono font-bold text-white">{dashboardData.ltif.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 text-xs text-[#8b949e]">ADNOC 目标: &lt; 0.1</div>
                </div>
                {/* TRIR */}
                <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl p-5 relative overflow-hidden group hover:border-[#a371f7]/50 transition-colors">
                  <span className="text-[#8b949e] text-sm font-medium mb-1 block">总可记录事件率 (TRIR)</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-mono font-bold text-white">{dashboardData.trir.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 text-xs text-[#8b949e]">ADNOC 目标: &lt; 0.5</div>
                </div>
                {/* TWL */}
                <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl p-5 relative overflow-hidden group hover:border-[#d29922]/50 transition-colors">
                  <span className="text-[#8b949e] text-sm font-medium mb-1 block">热工作限制 (TWL)</span>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-3xl font-mono font-bold", 
                      dashboardData.twlStatus === 'Green' ? 'text-[#2ea043]' :
                      dashboardData.twlStatus === 'Yellow' ? 'text-[#d29922]' :
                      dashboardData.twlStatus === 'Red' ? 'text-[#f85149]' : 'text-black drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]'
                    )}>{dashboardData.twlStatus}</span>
                  </div>
                  <div className="mt-2 text-xs text-[#8b949e]">实时气象监测</div>
                </div>
                {/* PTW */}
                <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl p-5 relative overflow-hidden group hover:border-[#f85149]/50 transition-colors">
                  <span className="text-[#8b949e] text-sm font-medium mb-1 block">高风险作业许可 (Active PTW)</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-mono font-bold text-white">{dashboardData.ptwActive}</span>
                    <span className="text-sm text-[#8b949e]">项</span>
                  </div>
                  <div className="mt-2 text-xs text-[#8b949e]">交叉作业监控中</div>
                </div>
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Trend Chart (Spans 2 cols) */}
                <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-5 flex flex-col shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[#c9d1d9] font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-[#58a6ff]"/> 近6个月隐患排查与闭环趋势</h3>
                    <span className="text-xs text-[#8b949e] bg-[#21262d] px-2 py-1 rounded">100% 闭环率目标</span>
                  </div>
                  <div className="flex-1 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[
                        { name: '10月', found: 45, resolved: 45 },
                        { name: '11月', found: 52, resolved: 50 },
                        { name: '12月', found: 38, resolved: 38 },
                        { name: '1月', found: 65, resolved: 60 },
                        { name: '2月', found: 48, resolved: 48 },
                        { name: '本月', found: dashboardData.riskResolved + dashboardData.hiddenDangers, resolved: dashboardData.riskResolved },
                      ]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2ea043" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#2ea043" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorFound" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f85149" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#f85149" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
                        <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#c9d1d9', borderRadius: '8px' }} />
                        <Area type="monotone" dataKey="found" stroke="#f85149" strokeWidth={2} fillOpacity={1} fill="url(#colorFound)" name="发现隐患 (Found)" />
                        <Area type="monotone" dataKey="resolved" stroke="#2ea043" strokeWidth={2} fillOpacity={1} fill="url(#colorResolved)" name="已整改 (Resolved)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Risk Categories (Pie Chart) */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 flex flex-col shadow-sm">
                  <h3 className="text-[#c9d1d9] font-medium mb-6 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-[#d29922]"/> 隐患类型分布 (Risk Categories)</h3>
                  <div className="flex-1 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: '车辆与驾驶 (Driving)', value: 35 },
                            { name: '防暑降温 (Heat Stress)', value: 25 },
                            { name: '吊装作业 (Lifting)', value: 15 },
                            { name: '环境保护 (Environment)', value: 15 },
                            { name: '其他 (Others)', value: 10 },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius="60%"
                          outerRadius="80%"
                          paddingAngle={5}
                          dataKey="value"
                          stroke="none"
                        >
                          <Cell fill="#58a6ff" />
                          <Cell fill="#d29922" />
                          <Cell fill="#a371f7" />
                          <Cell fill="#2ea043" />
                          <Cell fill="#8b949e" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#c9d1d9', borderRadius: '8px' }}
                          itemStyle={{ color: '#c9d1d9' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <div className="flex items-center gap-2 text-xs text-[#8b949e]"><span className="w-3 h-3 rounded-full bg-[#58a6ff]"></span> 车辆与驾驶</div>
                    <div className="flex items-center gap-2 text-xs text-[#8b949e]"><span className="w-3 h-3 rounded-full bg-[#d29922]"></span> 防暑降温</div>
                    <div className="flex items-center gap-2 text-xs text-[#8b949e]"><span className="w-3 h-3 rounded-full bg-[#a371f7]"></span> 吊装作业</div>
                    <div className="flex items-center gap-2 text-xs text-[#8b949e]"><span className="w-3 h-3 rounded-full bg-[#2ea043]"></span> 环境保护</div>
                  </div>
                </div>

                {/* Sub-crew Performance (Bar Chart) */}
                <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-5 flex flex-col shadow-sm">
                  <h3 className="text-[#c9d1d9] font-medium mb-6 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#2ea043]"/> 各班组安全合规率 (Crew Compliance)</h3>
                  <div className="flex-1 min-h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: '震源组 (Vibrator)', score: 98 },
                        { name: '排列组 (Line)', score: 95 },
                        { name: '测量组 (Survey)', score: 99 },
                        { name: '钻井组 (Drilling)', score: 92 },
                        { name: '营地后勤 (Camp)', score: 97 },
                        { name: '修理班 (Workshop)', score: 94 },
                      ]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={true} vertical={false} />
                        <XAxis type="number" domain={[0, 100]} stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis dataKey="name" type="category" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} width={100} />
                        <Tooltip 
                          cursor={{ fill: '#21262d', opacity: 0.4 }}
                          contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#c9d1d9', borderRadius: '8px' }}
                        />
                        <Bar dataKey="score" fill="#58a6ff" radius={[0, 4, 4, 0]} barSize={20}>
                          {
                            [98, 95, 99, 92, 97, 94].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry < 95 ? '#d29922' : '#58a6ff'} />
                            ))
                          }
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Radar Chart */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 flex flex-col shadow-sm">
                  <h3 className="text-[#c9d1d9] font-medium mb-6 flex items-center gap-2"><Zap className="w-4 h-4 text-[#a371f7]"/> 核心能力评估 (Capability)</h3>
                  <div className="flex-1 min-h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="65%" data={[
                        { subject: 'PTW执行', A: 95, fullMark: 100 },
                        { subject: 'JSA质量', A: 90, fullMark: 100 },
                        { subject: '应急演练', A: 98, fullMark: 100 },
                        { subject: '设备维保', A: 92, fullMark: 100 },
                        { subject: '人员培训', A: 96, fullMark: 100 },
                        { subject: '环保合规', A: 99, fullMark: 100 },
                      ]}>
                        <PolarGrid stroke="#30363d" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#8b949e', fontSize: 11 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="当前水平" dataKey="A" stroke="#a371f7" strokeWidth={2} fill="#a371f7" fillOpacity={0.3} />
                        <Tooltip contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#c9d1d9', borderRadius: '8px' }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-6 h-6 text-[#58a6ff]" />
              <h2 className="text-xl font-bold text-white">本地 HSE 数据库 (Knowledge Base)</h2>
            </div>
            <p className="text-sm text-[#8b949e] mb-4">
              在此处编辑 8615 队的核心数据。保存后，数据将永久存储在本地硬盘中，AI 将在后续对话中基于这些新数据进行分析和汇报。
            </p>
            <textarea 
              value={updateText}
              onChange={e => setUpdateText(e.target.value)}
              className="w-full h-64 bg-[#0d1117] border border-[#30363d] rounded-xl p-4 text-[#c9d1d9] font-mono text-sm placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] transition-all resize-none mb-6"
              placeholder="输入最新的小队数据或要求..."
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setShowUpdateModal(false);
                  setUpdateText(knowledgeBase); // 恢复未保存的修改
                }} 
                className="px-5 py-2.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-lg transition-colors font-medium"
              >
                取消
              </button>
              <button 
                onClick={async () => {
                  if (!updateText.trim()) return;
                  await saveKnowledgeBase(updateText);
                  setShowUpdateModal(false);
                  handleSend(`【系统指令：更新数据】我已经更新了本地数据库。请简短回复“本地数据库已同步，我的大脑已加载最新数据。”，并务必根据新的数据库内容，附带 [UPDATE_DASHBOARD: {"safeManHours": 数值, "ltif": 数值, "trir": 数值, "twlStatus": "状态", "ptwActive": 数值, "safetyScore": 数值, "trainingCount": 数值, "incidentCount": 数值, "riskResolved": 数值, "hiddenDangers": 数值}] 标签来更新全景看板（数值请根据最新的数据库合理推算，如果没有明确数值请保持合理默认值）。`);
                }} 
                className="flex items-center gap-2 px-5 py-2.5 bg-[#1f6feb] hover:bg-[#388bfd] text-white rounded-lg font-medium transition-colors shadow-[0_0_15px_rgba(31,111,235,0.3)]"
              >
                <Save className="w-4 h-4" />
                保存并更新 AI 大脑
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-[#30363d]">
                <h2 className="text-lg font-semibold text-white">语音设置 (Voice Settings)</h2>
                <button onClick={() => setShowSettings(false)} className="text-[#8b949e] hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#c9d1d9]">TTS 引擎 (Provider)</label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => setTtsProvider(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#58a6ff]"
                  >
                    <option value="gemini">Gemini TTS (默认/免费)</option>
                    <option value="elevenlabs">ElevenLabs (高音质/需API Key)</option>
                    <option value="browser">浏览器本地语音 (备用)</option>
                  </select>
                </div>

                {ttsProvider === 'gemini' && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-[#c9d1d9]">声音选择 (Gemini Voice)</label>
                    <select
                      value={geminiVoice}
                      onChange={(e) => setGeminiVoice(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#58a6ff]"
                    >
                      <option value="Zephyr">Zephyr (男声 - 稳重)</option>
                      <option value="Fenrir">Fenrir (男声 - 浑厚)</option>
                      <option value="Charon">Charon (男声 - 沉稳)</option>
                      <option value="Kore">Kore (女声 - 清晰)</option>
                      <option value="Puck">Puck (女声 - 活泼)</option>
                    </select>
                  </div>
                )}

                {ttsProvider === 'elevenlabs' && (
                  <>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-[#c9d1d9]">ElevenLabs API Key</label>
                      <input
                        type="password"
                        value={elKey}
                        onChange={(e) => setElKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#58a6ff]"
                      />
                      <p className="text-xs text-[#8b949e]">API Key 仅保存在您的浏览器本地。</p>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-[#c9d1d9]">声音 ID (Voice ID)</label>
                      <select
                        value={elVoice}
                        onChange={(e) => setElVoice(e.target.value)}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#58a6ff]"
                      >
                        <option value="21m00Tcm4TlvDq8ikWAM">Rachel (女声 - 自然)</option>
                        <option value="EXAVITQu4vr4xnSDxMaL">Bella (女声 - 柔和)</option>
                        <option value="2EiwWnXFnvU5JabPnv8n">Clyde (男声 - 战争/指挥官)</option>
                        <option value="ErXwobaYiN019PkySvjV">Antoni (男声 - 专业)</option>
                        <option value="pNInz6obpgDQGcFmaJgB">Adam (男声 - 深沉)</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="p-4 border-t border-[#30363d] bg-[#0d1117] flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-sm font-medium transition-colors"
                >
                  保存并关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}


