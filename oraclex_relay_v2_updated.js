const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Try multiple Python URL formats
const PYTHON_URLS = [
  process.env.PYTHON_URL, // Use env var if set
  'http://oraclex-python-backend:8080', // Service name
  'http://oraclex-python-backend.railway.internal:8080', // Private domain
  'https://oraclex-python-backend-production.up.railway.app' // Public URL fallback
].filter(Boolean);

let PYTHON_URL = PYTHON_URLS[0];

console.log(`\n${'='.repeat(80)}`);
console.log('🚀 ORACLEX RELAY - Starting');
console.log(`Trying Python URLs: ${PYTHON_URLS.join(' | ')}`);
console.log(`Currently using: ${PYTHON_URL}`);
console.log(`${'='.repeat(80)}\n`);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

let marketState = { symbols: {}, timestamp: null };

app.get('/', (req, res) => {
  res.json({ status: 'OK', relay: 'V3.0', python_url: PYTHON_URL });
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'running',
    symbols: Object.keys(marketState.symbols).length,
    python_url: PYTHON_URL
  });
});

app.post('/update-market-state', async (req, res) => {
  try {
    const { market_data } = req.body;
    if (!market_data || !Array.isArray(market_data)) {
      return res.json({ error: 'Invalid data' });
    }
    
    // Store in relay
    for (const sym of market_data) {
      if (sym.symbol) {
        marketState.symbols[sym.symbol] = sym;
      }
    }
    marketState.timestamp = Date.now();
    console.log(`✅ Relay stored ${market_data.length} symbols`);
    
    // Forward to Python
    try {
      console.log(`📤 Forwarding to Python at: ${PYTHON_URL}`);
      const pythonResponse = await fetch(`${PYTHON_URL}/market-data-v1.6`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_time: Math.floor(Date.now() / 1000), market_data }),
        timeout: 10000
      });
      
      if (pythonResponse.ok) {
        console.log(`✅ Python accepted`);
      } else {
        console.error(`⚠️ Python returned ${pythonResponse.status}`);
      }
    } catch (err) {
      console.error(`❌ Failed to reach Python: ${err.message}`);
    }
    
    res.json({ success: true, symbols_stored: market_data.length });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/get-market-state', (req, res) => {
  const symbols = Object.values(marketState.symbols);
  res.json({ market_data: symbols, timestamp: marketState.timestamp });
});

app.get('/analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const response = await fetch(`${PYTHON_URL}/analysis/${symbol}`, { timeout: 10000 });
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.status(response.status).json({ error: `Python error ${response.status}` });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/latest-analysis', async (req, res) => {
  try {
    const response = await fetch(`${PYTHON_URL}/latest-analysis`, { timeout: 10000 });
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.json({ analyses: [] });
    }
  } catch (error) {
    res.json({ analyses: [] });
  }
});

console.log('Routes ready\n');
app.listen(PORT, '0.0.0.0');
