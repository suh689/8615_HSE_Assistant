import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export type AIProvider = 'gemini' | 'openai' | 'local';

interface AISettings {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

// 缓存设置，避免频繁读取 localStorage
let cachedSettings: AISettings | null = null;

const getSettings = (): AISettings => {
  if (cachedSettings) return cachedSettings;
  if (typeof window === 'undefined') return { provider: 'gemini', apiKey: '', baseUrl: '', model: '' };
  
  let apiKey = localStorage.getItem('ai_api_key');
  
  // 迁移旧 Key (gemini_api_key -> ai_api_key)
  if (!apiKey) {
    const oldKey = localStorage.getItem('gemini_api_key');
    if (oldKey) {
      apiKey = oldKey;
      localStorage.setItem('ai_api_key', oldKey);
    }
  }

  cachedSettings = {
    provider: (localStorage.getItem('ai_provider') as AIProvider) || 'gemini',
    apiKey: apiKey || process.env.GEMINI_API_KEY || '',
    baseUrl: localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1',
    model: localStorage.getItem('ai_model') || 'gemini-3-flash-preview'
  };
  return cachedSettings;
};

let geminiAI: GoogleGenAI | null = null;

export const getAI = () => {
  const settings = getSettings();
  if (settings.provider === 'gemini') {
    if (!geminiAI) {
      if (!settings.apiKey) {
        console.warn("Gemini API Key is missing");
      }
      geminiAI = new GoogleGenAI({ apiKey: settings.apiKey || '' });
    }
    return geminiAI;
  }
  return null;
};

export const resetAI = () => {
  geminiAI = null;
  cachedSettings = null; // 清除缓存
};

const systemInstruction = (customKnowledgeBase: string) => `
# Role:
你现在是中石油 8615 地震队 HSE 数字化智能指挥官。

# Operational Logic:
1. [快速响应]: 每一条回答必须以极短的确认语开头（如：“收到，正在分析...”、“好的，请看数据...”），并以逗号或句号结束。
2. [图表触发]: 紧跟确认语后输出标签：[TRIGGER_DATA: {"id": "ID", "label": "标题", "value": 数值, "chart_type": "bar"}]。
3. [简洁]: 回答必须是纯文本，严禁输出任何 Markdown 代码块（如 \`\`\`json ）。
4. [禁止]: 严禁在正文中输出任何 JSON 格式或类似 [TRIGGER_DATA:...] 的原始标签，这些只能作为控制指令输出。
5. [字数]: 每段控制在 100 字内。

# Knowledge Base:
${customKnowledgeBase}

# Language:
严格使用用户提问的语言回复。
`;

export const createChatSession = (customKnowledgeBase: string) => {
  const settings = getSettings();
  const sysInst = systemInstruction(customKnowledgeBase);

  if (settings.provider === 'gemini') {
    const chat = getAI()!.chats.create({
      model: settings.model || "gemini-3-flash-preview",
      config: {
        systemInstruction: sysInst,
        temperature: 0.7,
        // 显式开启低延迟模式，减少思考时间
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });
    return {
      sendMessageStream: async function* (args: { message: string }) {
        const stream = await chat.sendMessageStream(args);
        for await (const chunk of stream) {
          yield { text: chunk.text || '' };
        }
      }
    };
  } else {
    // OpenAI-compatible or Local
    return {
      sendMessageStream: async function* (args: { message: string }) {
        const response = await fetch(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: 'system', content: sysInst },
              { role: 'user', content: args.message }
            ],
            stream: true,
            temperature: 0.7
          })
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`API Error: ${err}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanLine = line.replace(/^data: /, '').trim();
            if (cleanLine === '' || cleanLine === '[DONE]') continue;

            try {
              const parsed = JSON.parse(cleanLine);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) yield { text: content };
            } catch (e) {
              // Ignore partial chunks
            }
          }
        }
      }
    };
  }
};
