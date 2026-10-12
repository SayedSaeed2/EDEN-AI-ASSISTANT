import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:3b'
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY
  },
  maximo: {
    baseUrl: process.env.MAXIMO_BASE_URL || 'https://haedmaxed.eden-fm.com/maximo',
    apiKey: process.env.MAXIMO_API_KEY,
    defaultSite: process.env.MAXIMO_DEFAULT_SITE || 'TEST'
  }
};
