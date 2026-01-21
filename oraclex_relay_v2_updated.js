const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Simple in-memory storage
let marketState = { symbols: {}, timestamp: null };

// ENDPOINTS
app.get('/', (req, res) => {
  res.json({ status: 'OK', relay: 'V2.1', uptime: process.uptime() });
});

app.get('/status', (req, res) => {
  const symbolCount = Object.keys(marketState.symbols).length;
  res.json({ status: 'running', symbols: symbolCount, timestamp: marketState.timestamp });
});

// Receive market data from EA
app.post('/update-market-state', async (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.json({ error: 'Invalid data' });
    }

    // Store in memory
    for (const sym of market_data) {
      const symbol = sym.symbol;
      if (symbol) {
        marketState.symbols[symbol] = sym;
      }
    }
    marketState.timestamp = Date.now();

    console.log(`✅ Relay stored ${market_data.length} symbols. Total: ${Object.keys(marketState.symbols).length}`);

    // Forward to Python on internal Railway network
    console.log(`📤 Forwarding to Python at: oraclex-python-backend.railway.internal`);
    
    try {
      const pythonResp = await fetch('http://oraclex-python-backend.railway.internal:8080/market-data-v1.6', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_time: Math.floor(Date.now() / 1000), market_data })
      });

      if (pythonResp.ok) {
        const pythonData = await pythonResp.json();
        console.log(`✅ Python accepted data`);
      } else {
        console.warn(`⚠️ Python returned ${pythonResp.status}`);
      }
    } catch (pythonErr) {
      console.warn(`⚠️ Python unreachable: ${pythonErr.message}`);
    }

    res.json({ success: true, symbols_stored: market_data.length, total_symbols: Object.keys(marketState.symbols).length });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get market state for dashboard
app.get('/get-market-state', (req, res) => {
  const symbols = Object.values(marketState.symbols);
  res.json({ market_data: symbols, timestamp: marketState.timestamp });
});

// Start server
console.log('\n' + '='.repeat(80));
console.log('✨ ORACLEX RELAY V2.1');
console.log('='.repeat(80));
console.log(`🚀 Listening on port ${PORT}`);
console.log(`📡 Python: oraclex-python-backend.railway.internal (private)`);
console.log('='.repeat(80) + '\n');

app.listen(PORT, '0.0.0.0');
