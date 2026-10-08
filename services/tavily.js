import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export async function searchTavily(query) {
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: process.env.TAVILY_API_KEY,
      query: query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 3
    });

    return {
      answer: response.data.answer || 'No direct summary found.',
      sources: (response.data.results || []).map(r => ({ title: r.title, url: r.url }))
    };
  } catch (err) {
    return { error: `Tavily search failed: ${err.message}` };
  }
}