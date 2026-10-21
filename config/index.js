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
    defaultInstance: process.env.MAXIMO_DEFAULT_INSTANCE || 'ED',
    instances: {
      ED: {
        id: 'ED',
        name: process.env.MAXIMO_ED_NAME || 'Maximo Server',
        baseUrl: process.env.MAXIMO_ED_URL || process.env.MAXIMO_BASE_URL || 'http://172.16.128.18:9070/maximo',
        apiKey: process.env.MAXIMO_ED_API_KEY || process.env.MAXIMO_API_KEY || 'kr87423897l3fu7qhffrl3q662kd2uec4gfue60c',
        defaultSite: process.env.MAXIMO_ED_DEFAULT_SITE || process.env.MAXIMO_DEFAULT_SITE || 'TEST'
      },
      ...(process.env.MAXIMO_GEM_URL ? {
        GEM: {
          id: 'GEM',
          name: process.env.MAXIMO_GEM_NAME || 'Eden GEM',
          baseUrl: process.env.MAXIMO_GEM_URL,
          apiKey: process.env.MAXIMO_GEM_API_KEY,
          defaultSite: process.env.MAXIMO_GEM_DEFAULT_SITE || 'GEM'
        }
      } : {})
      /* Reserved for later use:
      , MD: {
        id: 'MD',
        name: process.env.MAXIMO_MD_NAME || 'Eden MD',
        baseUrl: process.env.MAXIMO_MD_URL || 'https://haedmaxmd.eden-fm.com/maximo',
        apiKey: process.env.MAXIMO_MD_API_KEY || '80r2e0ijjglbsecqm50sl7pmilcm44gr4ptf10se',
        defaultSite: process.env.MAXIMO_MD_DEFAULT_SITE || 'CAC'
      }
      */
    },
    // Backward compatibility getters
    baseUrl: process.env.MAXIMO_BASE_URL || 'https://haedmaxed.eden-fm.com/maximo',
    apiKey: process.env.MAXIMO_API_KEY,
    defaultSite: process.env.MAXIMO_DEFAULT_SITE || 'CAC'
  }
};
