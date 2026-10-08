import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const client = axios.create({
  baseURL: `${process.env.MAXIMO_BASE_URL}/oslc/os`,
  headers: {
    'apikey': process.env.MAXIMO_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 10000
});

async function testEndpoints() {
  console.log('Testing Maximo Site queries...');
  
  // Test 1: MXSITE
  try {
    const res1 = await client.get('/MXSITE', { params: { 'lean': 1, 'oslc.pageSize': 10 } });
    console.log('1. /MXSITE response members count:', res1.data?.member?.length);
    console.log('1. /MXSITE members sample:', JSON.stringify(res1.data?.member?.slice(0, 3)));
  } catch (err) {
    console.log('1. /MXSITE failed:', err.response?.status, err.response?.data?.Error?.message || err.message);
  }

  // Test 2: OSLC System Resource /oslc/members or site
  try {
    const res2 = await client.get('/MXWO', { params: { 'lean': 1, 'oslc.select': 'siteid', 'oslc.pageSize': 50 } });
    const sitesFromWO = [...new Set((res2.data?.member || []).map(m => m.siteid).filter(Boolean))];
    console.log('2. Distinct sites in /MXWO:', sitesFromWO);
  } catch (err) {
    console.log('2. /MXWO distinct site query failed:', err.message);
  }

  // Test 3: Assets distinct siteid
  try {
    const res3 = await client.get('/MXASSET', { params: { 'lean': 1, 'oslc.select': 'siteid', 'oslc.pageSize': 50 } });
    const sitesFromAsset = [...new Set((res3.data?.member || []).map(m => m.siteid).filter(Boolean))];
    console.log('3. Distinct sites in /MXASSET:', sitesFromAsset);
  } catch (err) {
    console.log('3. /MXASSET distinct site query failed:', err.message);
  }
}

testEndpoints();
