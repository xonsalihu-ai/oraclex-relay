const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_URL = 'https://oraclex-python-backend-production.up.railway.app';
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
let marketState = { symbols: {}, timestamp: null };
// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', relay: 'V2.8', python_url: PYTHON_URL });
});
// Status endpoint
app.get('/status', (req, res) => {
  res.json({ 
    status: 'running',
    symbols: Object.keys(marketState.symbols).length,
    python_url: PYTHON_URL
  });
});
// Receive market data from EA
app.post('/update-market-state', async (req, res) => {
  try {
    const { market_data } = req.body;
    if (!market_data || !Array.isArray(market_data)) {
      return res.json({ error: 'Invalid data' });
    }
    for (const sym of market_data) {
      if (sym.symbol) {
        // Log the structure of what we're storing
        console.log(`📦 ${sym.symbol} structure:`, {
          hasTimeframes: !!sym.timeframes,
          timeframesType: typeof sym.timeframes,
          timeframesIsArray: Array.isArray(sym.timeframes),
          timeframesKeys: Array.isArray(sym.timeframes) ? 'is array with ' + sym.timeframes.length + ' items' : Object.keys(sym.timeframes || {})
        });
        
        marketState.symbols[sym.symbol] = sym;
      }
    }
    marketState.timestamp = Date.now();
    console.log(`✅ Relay stored ${market_data.length} symbols`);
    
    // Forward to Python
    try {
      const pythonResponse = await fetch(`${PYTHON_URL}/market-data-v1.6`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_time: Math.floor(Date.now() / 1000), market_data })
      });
      if (pythonResponse.ok) {
        console.log(`✅ Python accepted`);
      }
    } catch (err) {
      console.warn(`⚠️ Python error: ${err.message}`);
    }
    res.json({ success: true, symbols_stored: market_data.length });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
// Get market state
app.get('/get-market-state', (req, res) => {
  const symbols = Object.values(marketState.symbols);
  res.json({ market_data: symbols, timestamp: marketState.timestamp });
});
// Proxy analysis endpoint
app.get('/analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    console.log(`📡 /analysis/${symbol}`);
    
    // Check local cache first
    if (marketState.symbols[symbol]) {
      console.log(`  ✅ Found in relay cache`);
    }
    
    const response = await fetch(`${PYTHON_URL}/analysis/${symbol}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Got analysis for ${symbol}`);
      res.json(data);
    } else {
      console.error(`❌ Python returned ${response.status}`);
      res.status(response.status).json({ error: `Python error ${response.status}` });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});
// Proxy latest-analysis endpoint
app.get('/latest-analysis', async (req, res) => {
  try {
    console.log(`📡 /latest-analysis`);
    
    const response = await fetch(`${PYTHON_URL}/latest-analysis`);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.status(response.status).json({ analyses: [] });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ analyses: [] });
  }
});
console.log('\n' + '='.repeat(80));
console.log('✨ ORACLEX RELAY V2.8');
console.log('='.repeat(80));
console.log(`🚀 Port: ${PORT}`);
console.log(`📡 Python: ${PYTHON_URL}`);
console.log('Routes: /, /status, POST /update-market-state, /get-market-state, /analysis/:symbol, /latest-analysis');
console.log('='.repeat(80) + '\n');
app.listen(PORT, '0.0.0.0');
